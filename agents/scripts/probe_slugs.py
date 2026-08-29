#!/usr/bin/env python
"""Discover and live-verify ATS slugs for the network's companies.

Usage (from agents/):
  .venv/bin/python scripts/probe_slugs.py                  # people from the running service + seeds
  .venv/bin/python scripts/probe_slugs.py --from-json f    # people rows from a JSON file + seeds
  .venv/bin/python scripts/probe_slugs.py --seed-only      # only the owner's 7 seed companies
  .venv/bin/python scripts/probe_slugs.py --service URL    # non-default service URL

For each company, candidate_slugs x sources are probed (sequential per
company, ~4 companies concurrently, 0.2s politeness delay between probes)
until the FIRST verified hit. NO hand-invented slugs are ever written — only
live-verified entries land anywhere.

Writes:
  (a) repo data/ats-slugs.json — verified hits for the SEED companies ONLY
      (the owner's network companies never enter the committable file);
  (b) ALL verified hits -> 'ats_slugs' via the jobs store (Firestore when
      credentials are present) AND data-local/ats-slugs-network.json
      (gitignored backup).

Output prints COMPANY names only — never person names.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

AGENTS_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = AGENTS_DIR.parent
sys.path.insert(0, str(AGENTS_DIR))

from app.jobs import ats  # noqa: E402
from app.jobs.slugs import candidate_slugs, normalize_company  # noqa: E402
from app.jobs_store import AtsSlugRecord  # noqa: E402

SEED_COMPANIES = ["Circle", "Ripple", "Arbitrum", "Tether", "CoinMarketCap", "Rain", "Tron"]

REPO_SLUGS_FILE = REPO_ROOT / "data" / "ats-slugs.json"
NETWORK_SLUGS_FILE = REPO_ROOT / "data-local" / "ats-slugs-network.json"

COMPANY_CONCURRENCY = 4
POLITENESS_DELAY_S = 0.2


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_people_companies(service_url: str | None, from_json: Path | None) -> list[str]:
    """Company names (definite + inferred) from the running service or a JSON
    file of people rows. Person names are read but NEVER printed."""
    if from_json is not None:
        rows = json.loads(from_json.read_text())
    else:
        response = httpx.get(f"{service_url}/people", timeout=15)
        response.raise_for_status()
        rows = response.json()
    companies: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        for field in ("company_definite", "company_inferred"):
            value = row.get(field)
            if isinstance(value, str) and value.strip():
                companies.append(value.strip())
    return companies


def dedupe_companies(names: list[str]) -> dict[str, str]:
    """normalized -> first-seen display name, insertion-ordered."""
    out: dict[str, str] = {}
    for name in names:
        key = normalize_company(name)
        if key and key not in out:
            out[key] = name
    return out


async def probe_company(
    client: httpx.AsyncClient, display_name: str
) -> tuple[str, str] | None:
    """First live-verified (slug, source) for a company, else None.
    Sequential probes with a politeness delay."""
    from app.jobs.slugs import AMBIGUOUS_EXCLUDED, normalize_company
    if normalize_company(display_name) in AMBIGUOUS_EXCLUDED:
        print(f"    curator-excluded (ambiguous name): {display_name}")
        return None
    for slug in candidate_slugs(display_name):
        for source in ats.SOURCES:
            verified = await ats.probe(source, slug, client)
            await asyncio.sleep(POLITENESS_DELAY_S)
            if verified:
                # feed exists — now prove it belongs to THIS company
                ok, evidence = await ats.verify_identity(client, source, slug, display_name)
                await asyncio.sleep(POLITENESS_DELAY_S)
                if ok:
                    return slug, source
                print(f"    identity-rejected {display_name!r} ~ {source}:{slug} — {evidence}")
    return None


async def probe_all(companies: dict[str, str]) -> dict[str, AtsSlugRecord]:
    semaphore = asyncio.Semaphore(COMPANY_CONCURRENCY)
    hits: dict[str, AtsSlugRecord] = {}

    async def worker(key: str, display_name: str) -> None:
        async with semaphore:
            result = await probe_company(client, display_name)
        if result is not None:
            slug, source = result
            hits[key] = AtsSlugRecord(
                company=display_name, slug=slug, source=source, verified_at=_now_iso()
            )

    async with ats.make_client() as client:
        await asyncio.gather(*(worker(k, n) for k, n in companies.items()))
    return hits


def merge_write_json(path: Path, records: dict[str, AtsSlugRecord]) -> None:
    existing: dict = {}
    if path.exists():
        try:
            loaded = json.loads(path.read_text())
            if isinstance(loaded, dict):
                existing = loaded
        except ValueError:
            pass
    existing.update({key: record.model_dump() for key, record in records.items()})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(existing, indent=2, sort_keys=True) + "\n")


def write_firestore(records: dict[str, AtsSlugRecord]) -> str:
    """Best-effort Firestore write; returns a status line for the summary."""
    try:
        from app.jobs_store import FirestoreJobsStore

        store = FirestoreJobsStore()
        for key, record in records.items():
            store.upsert_slug(key, record)
        return f"firestore ats_slugs: wrote {len(records)} record(s)"
    except Exception as exc:  # noqa: BLE001 — script must not die on creds
        return f"firestore ats_slugs: SKIPPED ({type(exc).__name__}: {exc})"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", default="http://localhost:8080")
    parser.add_argument("--from-json", type=Path, default=None)
    parser.add_argument("--seed-only", action="store_true")
    args = parser.parse_args()

    network_names: list[str] = []
    if not args.seed_only:
        try:
            network_names = load_people_companies(args.service, args.from_json)
        except Exception as exc:  # noqa: BLE001
            print(f"could not load people ({type(exc).__name__}: {exc}); "
                  f"use --from-json or --seed-only", file=sys.stderr)
            return 1

    seed_keys = {normalize_company(name) for name in SEED_COMPANIES}
    companies = dedupe_companies(SEED_COMPANIES + network_names)
    print(f"probing {len(companies)} companies "
          f"({len(seed_keys)} seed, {len(companies) - len(seed_keys & set(companies))} network) "
          f"across {len(ats.SOURCES)} sources...")

    hits = asyncio.run(probe_all(companies))

    seed_hits = {k: v for k, v in hits.items() if k in seed_keys}
    merge_write_json(REPO_SLUGS_FILE, seed_hits)          # committable: seeds ONLY
    merge_write_json(NETWORK_SLUGS_FILE, hits)            # gitignored backup: all
    firestore_status = write_firestore(hits)

    print(f"\n{'company':<32} {'result':<40}")
    print("-" * 72)
    for key, display_name in companies.items():
        record = hits.get(key)
        result = f"{record.slug} / {record.source}" if record else "no-feed"
        print(f"{display_name:<32} {result:<40}")
    print("-" * 72)
    print(f"verified {len(hits)}/{len(companies)}  "
          f"(seed hits -> {REPO_SLUGS_FILE.relative_to(REPO_ROOT)}, "
          f"all hits -> {NETWORK_SLUGS_FILE.relative_to(REPO_ROOT)})")
    print(firestore_status)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
