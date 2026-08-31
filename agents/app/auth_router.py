"""Auth endpoints (v2) — simple email+password accounts, JWT sessions.

  POST /auth/signup {email, password} -> {token, uid, email}
  POST /auth/login  {email, password} -> {token, uid, email}
  GET  /auth/me                        -> {uid, email}   (Bearer session JWT)

The account IS the tenant: every other endpoint operates on the uid resolved
by the tenant middleware (session JWT, or X-User-Id from the trusted web
proxy). Sessions are HS256 JWTs signed with AUTH_SECRET (Secret Manager in
cloud; auto-generated and persisted under the local store dir in local mode).

Brute-force guard: per-email sliding window (10 failures / 5 min) — enough
for a single-instance deployment; swap for a shared limiter if scaled out.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from . import config
from .users import (
    MIN_PASSWORD_LEN,
    EmailTaken,
    get_users_store,
    hash_password,
    new_google_user,
    new_user,
    normalize_email,
    valid_email,
    verify_password,
)

router = APIRouter()

SESSION_TTL_DAYS = 30
_ALGO = "HS256"

_MAX_FAILURES = 10
_WINDOW_SECONDS = 300
_failures: dict[str, list[float]] = {}


class Credentials(BaseModel):
    email: str
    password: str


class SessionResponse(BaseModel):
    token: str
    uid: str
    email: str


def mint_token(uid: str, email: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": uid,
            "email": email,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(days=SESSION_TTL_DAYS)).timestamp()),
        },
        config.auth_secret(),
        algorithm=_ALGO,
    )


def verify_token(token: str) -> dict | None:
    """Returns the claims dict, or None for any invalid/expired token."""
    try:
        return jwt.decode(token, config.auth_secret(), algorithms=[_ALGO])
    except jwt.PyJWTError:
        return None


def _throttled(email: str) -> bool:
    now = time.monotonic()
    window = [t for t in _failures.get(email, []) if now - t < _WINDOW_SECONDS]
    _failures[email] = window
    return len(window) >= _MAX_FAILURES


def _record_failure(email: str) -> None:
    _failures.setdefault(email, []).append(time.monotonic())


@router.post("/auth/signup", response_model=SessionResponse)
def signup(body: Credentials) -> SessionResponse:
    email = normalize_email(body.email)
    if not valid_email(email):
        raise HTTPException(status_code=422, detail="invalid email address")
    if len(body.password) < MIN_PASSWORD_LEN:
        raise HTTPException(
            status_code=422, detail=f"password must be at least {MIN_PASSWORD_LEN} characters"
        )
    user = new_user(email, body.password)
    try:
        get_users_store().create(user)
    except EmailTaken as exc:
        raise HTTPException(status_code=409, detail="email already registered") from exc
    return SessionResponse(token=mint_token(user.uid, user.email), uid=user.uid, email=user.email)


@router.post("/auth/login", response_model=SessionResponse)
def login(body: Credentials) -> SessionResponse:
    email = normalize_email(body.email)
    if _throttled(email):
        raise HTTPException(status_code=429, detail="too many attempts, try again later")
    user = get_users_store().get_by_email(email)
    if user is None or not verify_password(body.password, user.password_salt, user.password_hash):
        _record_failure(email)
        # same message for unknown email and wrong password — no enumeration
        raise HTTPException(status_code=401, detail="invalid email or password")
    return SessionResponse(token=mint_token(user.uid, user.email), uid=user.uid, email=user.email)


@router.get("/auth/me")
def me(request: Request) -> dict:
    header = request.headers.get("authorization", "")
    claims = verify_token(header.removeprefix("Bearer ").strip()) if header else None
    if not claims:
        raise HTTPException(status_code=401, detail="invalid or expired session")
    return {"uid": claims["sub"], "email": claims.get("email", "")}


# ---- Google sign-in ---------------------------------------------------------


class GoogleCredential(BaseModel):
    credential: str  # the GIS ID token from the Sign in with Google button


def _verify_google_credential(credential: str) -> dict:
    """ID-token verification against Google's keys, audience-checked to OUR
    OAuth client id. Module-level so tests can monkeypatch it."""
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    return google_id_token.verify_oauth2_token(
        credential, google_requests.Request(), audience=config.GOOGLE_OAUTH_CLIENT_ID
    )


@router.post("/auth/google")
def google_signin(body: GoogleCredential) -> dict:
    """Login AND signup in one: a verified Google email either finds the
    existing account (password accounts link by their verified email) or
    creates a password-less one. Same JWT session as everything else."""
    if not config.GOOGLE_OAUTH_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured")
    try:
        info = _verify_google_credential(body.credential)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Google sign-in failed") from exc
    if not info.get("email_verified"):
        raise HTTPException(status_code=401, detail="Google account email is not verified")
    email = normalize_email(info.get("email", ""))
    if not valid_email(email):
        raise HTTPException(status_code=401, detail="Google account has no usable email")

    store = get_users_store()
    user = store.get_by_email(email)
    created = False
    if user is None:
        candidate = new_google_user(email)
        try:
            store.create(candidate)
            user, created = candidate, True
        except EmailTaken:
            # raced with a parallel signup — the account exists now, use it
            user = store.get_by_email(email)
    if user is None:  # defensive: the race lost AND the read missed
        raise HTTPException(status_code=500, detail="account lookup failed")
    return {
        "token": mint_token(user.uid, user.email),
        "uid": user.uid,
        "email": user.email,
        "created": created,
    }


# ---- password change (Privacy page) ----------------------------------------


class ChangePassword(BaseModel):
    old_password: str = ""
    new_password: str


@router.post("/auth/change-password")
def change_password(body: ChangePassword, request: Request) -> dict:
    """Authenticated password change. Accounts created via Google have no
    password yet — they SET one here (old password not required); password
    accounts must present the current one (throttled like login)."""
    header = request.headers.get("authorization", "")
    claims = verify_token(header.removeprefix("Bearer ").strip()) if header else None
    if not claims:
        raise HTTPException(status_code=401, detail="invalid or expired session")
    user = get_users_store().get_by_uid(claims["sub"])
    if user is None:
        raise HTTPException(status_code=401, detail="account not found")

    had_password = bool(user.password_hash)
    if had_password:
        if _throttled(user.email):
            raise HTTPException(status_code=429, detail="too many attempts, try again later")
        if not verify_password(body.old_password, user.password_salt, user.password_hash):
            _record_failure(user.email)
            raise HTTPException(status_code=401, detail="current password is wrong")
    if len(body.new_password) < MIN_PASSWORD_LEN:
        raise HTTPException(
            status_code=422, detail=f"password must be at least {MIN_PASSWORD_LEN} characters"
        )
    salt_hex, hash_hex = hash_password(body.new_password)
    get_users_store().set_password(user.uid, salt_hex, hash_hex)
    return {"ok": True, "had_password": had_password}
