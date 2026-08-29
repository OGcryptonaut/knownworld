"""Task queue abstraction for background fan-out (enrich runs).

Two implementations behind one protocol — enqueue(path, payload):

- LocalTaskQueue (TASKS_MODE=local, default): invokes the handler coroutine
  registered for the path in-process via asyncio.create_task. Fine for local
  dev and tests; drain() awaits everything scheduled so far.
- CloudTasksQueue (TASKS_MODE=cloud): enqueues an HTTP POST task to Cloud
  Tasks targeting {SERVICE_URL}{path} — queue TASKS_QUEUE (default
  'knownworld-enrich'), location TASKS_LOCATION (us-central1), with an OIDC
  token for TASKS_SA_EMAIL when set. The task body is the JSON payload; the
  service's own /enrich/task endpoint is the receiving handler.

Handlers self-register at import time via register_local_handler(path, fn),
keeping this module free of router imports (no cycles).
"""

from __future__ import annotations

import asyncio
import json
from typing import Awaitable, Callable, Protocol

from . import config

LocalHandler = Callable[[dict], Awaitable[None]]

_local_handlers: dict[str, LocalHandler] = {}


def register_local_handler(path: str, handler: LocalHandler) -> None:
    """Register the coroutine LocalTaskQueue invokes for a path."""
    _local_handlers[path] = handler


class TaskQueue(Protocol):
    async def enqueue(self, path: str, payload: dict) -> None: ...


class LocalTaskQueue:
    """In-process queue: asyncio.create_task on the registered handler."""

    def __init__(self) -> None:
        self._tasks: list[asyncio.Task] = []

    async def enqueue(self, path: str, payload: dict) -> None:
        handler = _local_handlers.get(path)
        if handler is None:
            raise RuntimeError(f"no local task handler registered for {path}")
        self._tasks.append(asyncio.create_task(handler(dict(payload))))

    async def drain(self) -> None:
        """Await every task scheduled so far (tests / graceful local runs)."""
        pending, self._tasks = self._tasks, []
        if pending:
            await asyncio.gather(*pending)


class CloudTasksQueue:
    """Cloud Tasks HTTP queue. Instantiated lazily so local/FAKE modes never
    touch GCP credentials."""

    def __init__(
        self,
        project: str | None = None,
        location: str | None = None,
        queue: str | None = None,
    ) -> None:
        from google.cloud import tasks_v2  # imported here: local modes skip it

        self._tasks_v2 = tasks_v2
        self._client = tasks_v2.CloudTasksClient()
        self._parent = self._client.queue_path(
            project or config.GOOGLE_CLOUD_PROJECT,
            location or config.TASKS_LOCATION,
            queue or config.TASKS_QUEUE,
        )

    def _enqueue_sync(self, path: str, payload: dict) -> None:
        http_request: dict = {
            "http_method": self._tasks_v2.HttpMethod.POST,
            "url": f"{config.SERVICE_URL}{path}",
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(payload).encode("utf-8"),
        }
        if config.TASKS_SA_EMAIL:
            http_request["oidc_token"] = {"service_account_email": config.TASKS_SA_EMAIL}
        self._client.create_task(
            request={"parent": self._parent, "task": {"http_request": http_request}}
        )

    async def enqueue(self, path: str, payload: dict) -> None:
        await asyncio.to_thread(self._enqueue_sync, path, dict(payload))


_task_queue: TaskQueue | None = None


def get_task_queue() -> TaskQueue:
    """Factory: TASKS_MODE 'local' (default) or 'cloud'."""
    global _task_queue
    if _task_queue is None:
        _task_queue = CloudTasksQueue() if config.TASKS_MODE == "cloud" else LocalTaskQueue()
    return _task_queue


def set_task_queue(queue: TaskQueue | None) -> None:
    """Test hook / dependency injection."""
    global _task_queue
    _task_queue = queue
