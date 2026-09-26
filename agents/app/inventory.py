"""The data inventory — every collection this service writes, as data.

This is the server half of the privacy truth (the web half is
web/src/lib/boundary.ts). It lists EVERY Firestore collection the store
triads touch, what each holds, why, and which switch wipes it:

  scope 'tenant'  — lives under users/{uid}/…; wiped by DELETE /data
  scope 'account' — the account record itself; wiped by delete-account
  scope 'global'  — cross-tenant public knowledge, no personal data; never

Field lists are DERIVED from the pydantic models the stores persist, so a
new field on a model shows up here without anyone remembering to edit a
manifest. tests/test_inventory.py asserts the inventory names exactly the
collections the store modules use, and that every tenant-scoped one is
actually emptied by the real DELETE /data endpoint.

GET /privacy/inventory (main.py) returns this list verbatim. It is public
metadata — no personal data, no tenant lookup — so the endpoint is exempt
from both the service token and the session.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from .agents.enrich import EnrichmentCard
from .jobs_store import AtsSlugRecord, JobPosting, JobsRunSummary
from .pipeline_store import PipelineItem
from .requests_store import UserRequest
from .schemas import ActivityEntry, DistilledPerson
from .users import UserRecord

Scope = Literal["tenant", "account", "global"]
WipedBy = Literal["DELETE /data", "delete-account", "never"]


class InventoryEntry(BaseModel):
    collection: str
    scope: Scope
    fields: list[str]
    purpose: str
    wiped_by: WipedBy


def _fields(model: type[BaseModel], *extra: str) -> list[str]:
    return [*model.model_fields, *extra]


DATA_INVENTORY: list[InventoryEntry] = [
    # ---- tenant-scoped: users/{uid}/<collection> — DELETE /data -------------
    InventoryEntry(
        collection="people",
        scope="tenant",
        fields=_fields(DistilledPerson, "location_lat", "location_lng",
                       "current_focus", "how_useful", "history"),
        purpose=(
            "One distilled row per contact: name, company (definite and inferred, "
            "never merged), role guess, the model-written two-line summary, "
            "code-computed closeness and message volume, plus the research-applied "
            "evidence fields and your own edits and note. Never a message."
        ),
        wiped_by="DELETE /data",
    ),
    InventoryEntry(
        collection="activity_log",
        scope="tenant",
        fields=_fields(ActivityEntry),
        purpose=(
            "Per-call telemetry for every agent step: which agent, the resolved "
            "model id, tokens, estimated cost, duration, status and a one-line "
            "detail. Counts and ids only — no prompt or message content."
        ),
        wiped_by="DELETE /data",
    ),
    InventoryEntry(
        collection="enrichments",
        scope="tenant",
        fields=_fields(EnrichmentCard),
        purpose=(
            "The research card per contact, built from public evidence: current "
            "employer, location (with map coordinates), links, focus, history, "
            "footprint, tags, the citations behind it, the code-computed verdict, "
            "and a dated changelog of what re-research changed."
        ),
        wiped_by="DELETE /data",
    ),
    InventoryEntry(
        collection="jobs",
        scope="tenant",
        fields=_fields(JobPosting),
        purpose=(
            "Public job postings fetched from ATS feeds for the companies in your "
            "network, each joined in code to the contacts you know there (tg_id, "
            "name, closeness) and flagged for role fit."
        ),
        wiped_by="DELETE /data",
    ),
    InventoryEntry(
        collection="job_runs",
        scope="tenant",
        fields=_fields(JobsRunSummary, "no_feed"),
        purpose=(
            "One summary per job-scout run: how many companies were scanned, how "
            "many had a live feed, posting counts, and which companies had no feed."
        ),
        wiped_by="DELETE /data",
    ),
    InventoryEntry(
        collection="pipeline",
        scope="tenant",
        fields=_fields(PipelineItem),
        purpose=(
            "Leads you chose to track: the contact, company, the posting (if any), "
            "stage, follow-up date, your note, and the copy-out draft message. "
            "The app never sends the draft anywhere."
        ),
        wiped_by="DELETE /data",
    ),
    InventoryEntry(
        collection="requests",
        scope="tenant",
        fields=_fields(UserRequest),
        purpose=(
            "Every question you asked, verbatim, with the planner's parsed intent "
            "and a snapshot of the answer at that time: matched contacts, postings, "
            "web findings with sources, brief sections, or the drafted intro."
        ),
        wiped_by="DELETE /data",
    ),
    # ---- account-scoped: root users/{uid} + email_index — delete-account ----
    InventoryEntry(
        collection="users",
        scope="account",
        fields=_fields(UserRecord),
        purpose=(
            "The account record: uid, email, scrypt password hash and salt (empty "
            "for Google-created accounts until a password is set), created_at. "
            "It is also the parent document of every tenant collection above."
        ),
        wiped_by="delete-account",
    ),
    InventoryEntry(
        collection="email_index",
        scope="account",
        fields=["email", "uid"],
        purpose=(
            "Uniqueness map from normalized email to uid so signup and Google "
            "sign-in resolve one email to exactly one account."
        ),
        wiped_by="delete-account",
    ),
    # ---- global: shared public knowledge — never wiped ----------------------
    InventoryEntry(
        collection="ats_slugs",
        scope="global",
        fields=_fields(AtsSlugRecord),
        purpose=(
            "Live-verified company to ATS-feed mapping (which public job board a "
            "company publishes on). Public knowledge with no personal data, shared "
            "across accounts so probing is not repeated."
        ),
        wiped_by="never",
    ),
]


def tenant_collections() -> list[str]:
    return [e.collection for e in DATA_INVENTORY if e.scope == "tenant"]


def account_collections() -> list[str]:
    return [e.collection for e in DATA_INVENTORY if e.scope == "account"]
