# Demo dataset: "what if your Telegram network was 15 famous founders?"

`result.json` is a byte-accurate Telegram Desktop export of an **openly
fictional** network: 15 real public figures (Musk, Altman, Buffett, …) whose
conversations here are entirely invented; nothing in these chats was ever
said by them. The only real facts are the public ones: who runs which
company, their role, their city. That's the point of the demo:

- **Refine** distills the chats into a contact database with their real
  companies and roles.
- **Research** attaches real public evidence (Wikipedia/company links, real
  cities with map coordinates).
- **Job scout hits REAL live feeds**: 9 of the 15 companies have public,
  identity-verified ATS boards (`data/ats-slugs.json`, probed live):
  SpaceX, Coinbase, Stripe, Airbnb, Databricks, Anduril, Figma, Spotify,
  Palantir. Thousands of current postings, each with a warm path through
  "your" contact. The other 6 (OpenAI/Nvidia/Meta/Canva/Shopify/Berkshire)
  demonstrate the honest no-verified-feed path.
- **Requests** answer real questions: "who should I meet at an AI
  conference in San Francisco?" ranks the right people with grounded
  reasons; "is there a BD job for me posted in the last 30 days?" returns
  live postings.

## FAKE mode (zero credentials) vs real model

`demo-knowledge.json` is a sidecar of those public facts. In FAKE mode
(`FAKE_LLM=1`, the local default) the deterministic agents consult it, so
the whole demo works **with no model, no keys, no network to any AI**; job
feeds are the only live calls. With a real model (Gemini deployed; the
Claude dev backend locally) the same dataset works even better: these
people are trivially findable by grounded search. Telemetry always shows
which mode ran (`fake:` model ids). The demo never lies about itself.

Generated deterministically (seed 42): `python3 sample-data/generate.py
--now 2026-09-15T12:00:00` regenerates both files with fresh recency.
`web/src/lib/__tests__/sample-data.test.ts` re-parses the export with the
real ingest code on every test run. `expected-people.json` is the golden
reference for a correct refine pass.

## Closeness spread (code-computed at ingest)

Musk 98 → Altman 94 → Collison 91 → Armstrong 90 → … → Buffett 49 →
Zuckerberg 48. Volume plus recency only; a model never scores closeness.

## How to run it

1. Both servers up (`.claude/launch.json`: web :3040, agents :8787).
2. Sign up → wizard → **Load dev corpus** (or drop `result.json`).
3. Distill → Research → Database (map/graph/table + inline editable cards)
   → Requests (try the example chips).
