"""Test setup: FAKE_LLM + in-memory store, no GCP anywhere.

Env must be set before app.config is imported (it reads env at import time).
All test data is synthetic — invented names only.
"""

import os

os.environ.setdefault("FAKE_LLM", "1")
os.environ.setdefault("FAKE_FIRESTORE", "1")

import pytest
from fastapi.testclient import TestClient

from app import store as store_module
from app.main import app
from app.store import InMemoryStore


@pytest.fixture()
def store() -> InMemoryStore:
    fresh = InMemoryStore()
    store_module.set_store(fresh)
    yield fresh
    store_module.set_store(None)


@pytest.fixture()
def client(store: InMemoryStore) -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


def make_batch_request(closeness: float = 73.0) -> dict:
    """A synthetic RefineBatchRequest with one invented contact."""
    return {
        "run_id": "run-test-1",
        "batch_index": 0,
        "batch_count": 1,
        "chats": [
            {
                "tg_id": 42,
                "name": "Testy McTestface",
                "my_msg_count": 120,
                "their_msg_count": 80,
                "last_message_iso": "2026-08-01T12:00:00+00:00",
                "closeness": closeness,
                "messages": [
                    {
                        "from_me": True,
                        "date": "2026-07-30T10:00:00+00:00",
                        "text": "hey, how is the new gig going?",
                    },
                    {
                        "from_me": False,
                        "date": "2026-07-30T10:05:00+00:00",
                        "text": "great! busy with the protocol launch",
                    },
                ],
            }
        ],
    }
