"""User accounts (v2) — email+password, scrypt-hashed, behind the same
store-triad pattern as everything else (Firestore / local disk / in-memory).

Users are ROOT-level (not tenant-scoped): the account IS the tenant. Firestore
layout: 'users/{uid}' docs with an 'email_index/{email}' uniqueness map —
mirrored by users.json / email_index.json on disk and dicts in memory.

Passwords: scrypt (n=2^14, r=8, p=1), 16-byte random salt, constant-time
compare. Plaintext is never stored or logged anywhere.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import uuid
from datetime import datetime, timezone
from typing import Protocol

from pydantic import BaseModel

from . import config

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LEN = 8

_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


class UserRecord(BaseModel):
    uid: str
    email: str
    password_salt: str  # hex
    password_hash: str  # hex
    created_at: str


class EmailTaken(Exception):
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_email(email: str) -> str:
    return email.strip().lower()


def valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match(email))


def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P
    )
    return salt.hex(), digest.hex()


def verify_password(password: str, salt_hex: str, hash_hex: str) -> bool:
    try:
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=_SCRYPT_N,
            r=_SCRYPT_R,
            p=_SCRYPT_P,
        )
    except ValueError:
        return False
    return hmac.compare_digest(digest.hex(), hash_hex)


def new_user(email: str, password: str) -> UserRecord:
    salt_hex, hash_hex = hash_password(password)
    return UserRecord(
        uid=uuid.uuid4().hex,
        email=normalize_email(email),
        password_salt=salt_hex,
        password_hash=hash_hex,
        created_at=_now_iso(),
    )


# ---- Store triad ------------------------------------------------------------


class UsersStore(Protocol):
    def create(self, user: UserRecord) -> None:
        """Raises EmailTaken when the email is already registered."""
        ...

    def get_by_email(self, email: str) -> UserRecord | None: ...

    def get_by_uid(self, uid: str) -> UserRecord | None: ...


class FirestoreUsersStore:
    def __init__(self, project: str | None = None) -> None:
        from google.cloud import firestore

        self._db = firestore.Client(project=project or config.GOOGLE_CLOUD_PROJECT)
        self._users = self._db.collection("users")
        self._email_index = self._db.collection("email_index")

    def create(self, user: UserRecord) -> None:
        from google.cloud import firestore

        index_ref = self._email_index.document(user.email)
        user_ref = self._users.document(user.uid)

        @firestore.transactional
        def _txn(txn):
            if index_ref.get(transaction=txn).exists:
                raise EmailTaken(user.email)
            txn.set(index_ref, {"uid": user.uid})
            txn.set(user_ref, user.model_dump())

        _txn(self._db.transaction())

    def get_by_email(self, email: str) -> UserRecord | None:
        doc = self._email_index.document(normalize_email(email)).get()
        if not doc.exists:
            return None
        return self.get_by_uid(doc.to_dict()["uid"])

    def get_by_uid(self, uid: str) -> UserRecord | None:
        doc = self._users.document(uid).get()
        return UserRecord.model_validate(doc.to_dict()) if doc.exists else None


class LocalDiskUsersStore:
    def __init__(self) -> None:
        from . import localdisk

        self._disk = localdisk

    def _users_path(self):
        return self._disk.root_dir() / "users.json"

    def create(self, user: UserRecord) -> None:
        def _apply(users: dict) -> dict:
            if any(u["email"] == user.email for u in users.values()):
                raise EmailTaken(user.email)
            users[user.uid] = user.model_dump()
            return users

        self._disk.update_json(self._users_path(), {}, _apply)

    def get_by_email(self, email: str) -> UserRecord | None:
        email = normalize_email(email)
        users = self._disk.read_json(self._users_path(), {})
        for raw in users.values():
            if raw.get("email") == email:
                return UserRecord.model_validate(raw)
        return None

    def get_by_uid(self, uid: str) -> UserRecord | None:
        users = self._disk.read_json(self._users_path(), {})
        raw = users.get(uid)
        return UserRecord.model_validate(raw) if raw else None


class InMemoryUsersStore:
    def __init__(self) -> None:
        self._by_uid: dict[str, UserRecord] = {}

    def create(self, user: UserRecord) -> None:
        if any(u.email == user.email for u in self._by_uid.values()):
            raise EmailTaken(user.email)
        self._by_uid[user.uid] = user

    def get_by_email(self, email: str) -> UserRecord | None:
        email = normalize_email(email)
        return next((u for u in self._by_uid.values() if u.email == email), None)

    def get_by_uid(self, uid: str) -> UserRecord | None:
        return self._by_uid.get(uid)


_users_store: UsersStore | None = None


def get_users_store() -> UsersStore:
    global _users_store
    if _users_store is None:
        mode = config.STORE_MODE
        if mode == "memory":
            _users_store = InMemoryUsersStore()
        elif mode == "local":
            _users_store = LocalDiskUsersStore()
        else:
            _users_store = FirestoreUsersStore()
    return _users_store


def set_users_store(store: UsersStore | None) -> None:
    global _users_store
    _users_store = store
