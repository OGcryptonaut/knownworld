# Demo dataset: 17 invented crypto/web3 contacts, real companies

`result.json` is a byte-accurate Telegram Desktop export of a **wholly
fictional** network. Every person in it is made up — the 15 names were
web-checked against notable people at the same companies and none exist;
two contacts have no name at all (handle only). Every message is invented.
The only real things are the **companies**, used purely as public facts:
Coinbase, Figma, Ripple, Stripe, Uniswap Labs, Alchemy, Nansen, Bitpanda,
Consensys, Fireblocks, Databricks, Phantom, Polygon Labs, Ledger,
Blockdaemon and Messari all publish a live, identity-verified ATS feed
(`data/ats-slugs.json`, probed live on 2026-09-26), so the job scout returns
**real, current postings** with a warm path through "your" demo contact —
the product's core loop, end-to-end, with zero credentials. One founder
(Harbor Guild DAO, fictional) has no feed and demonstrates the honest
no-feed path.

What the roster exercises on purpose:

- **Closeness bands** (`web/src/lib/closeness.ts`, computed in code, never by
  a model): C1 90+ (300–450 messages, last contact ≤ 3 days), C2 70–89,
  C3 50–69, C4 < 50 and quiet for months.
- **Definite vs inferred employer.** 13 contacts name their employer in the
  chats (`company_definite`); 4 only hint at it — "the vienna exchange",
  "the hardware wallet people" — and must land in `company_inferred`, never
  `company_definite`. One thread (Lucas) is ~90% life chat.
- **A same-name pair.** Two different Emil Lindebergs, one at Stripe, one at
  Databricks. Public research resolves the quieter one to his prominent
  namesake; the product must surface `possible_mismatch`, never merge them.
- **Two handle-only contacts** (Telegram `name: null`): `@rk_builds` resolves
  to a name from public sources (`resolved_name` auto-applies to blank rows
  only); `@anon_mm` stays honestly `unverified`.

## The three generated files

| file | what it is |
| --- | --- |
| `result.json` | the export; `web/public/demo-corpus.json` is a byte-identical copy served same-origin by the wizard (the vitest checks `cmp`) |
| `demo-knowledge.json` | the sidecar: each contact's invented profile plus the real company as a public fact. `evidence_*` fields are what research would return (only the namesake differs); `identified: false` marks the unresolvable contact; `linkedin_url` is always null (a fictional profile would 404); citations are company pages only |
| `expected-people.json` | golden reference for a correct refine pass (`ModelPerson` shape), derived from the same roster so it can never drift from the corpus |

## Offline mode vs a real model

With `FAKE_LLM=1` (the local default) the deterministic agents consult the
sidecar, so the whole demo works **with no model, no keys, no network to
any AI**; job feeds are the only live calls. With a real model the chats are
distilled by Gemini for real, but research would find nothing for invented
people — so contacts in the reserved demo id range (`100000001–100000099`,
`agents/app/demo_knowledge.DEMO_TG_ID_RANGE`) whose name matches the
sidecar resolve from it instead, labelled `demo-sidecar:<model>` in the
activity log. Telemetry always shows which path ran (`fake:` /
`demo-sidecar:` / the real model id). The demo never lies about itself, and
the sidecar path can never touch a real tenant's contacts: it needs both
the reserved id and the invented name.

## Regenerating

Deterministic (seed 42); `--now` anchors recency:

```
python3 sample-data/generate.py --now 2026-09-26T12:00:00
cp sample-data/result.json web/public/demo-corpus.json
```

That rewrites all three files. `web/src/lib/__tests__/sample-data.test.ts`
re-parses the export with the real ingest code on every test run and checks
every guarantee above; `agents/tests/test_demo_sidecar.py` checks the
research path against the committed sidecar.

To re-verify the job feeds (network, seed companies only, no store writes):

```
cd agents && .venv/bin/python scripts/probe_slugs.py --seed-only --no-firestore
cp data/ats-slugs.json agents/app/seed/ats-slugs.json
```

## Closeness spread (code-computed at ingest, now = 2026-09-26)

Priya 98 → Tomas 96 → Ines 94 → Emil (Stripe) 89 → Lucas 86 → Dmitri 85 →
Yuki 82 → Amara 75 → Sebastián 68 → Hana 66 → Mei-Lin 62 → Arjun 62 →
Emil (Databricks) 60 → Karolina 49 → Felix 48 → @rk_builds 43 → @anon_mm 32.
Volume plus recency only; a model never scores closeness.

## How to run it

1. Both servers up (`.claude/launch.json`: web :3040, agents :8787).
2. Sign up → wizard → **Try the demo network** (or drop `result.json`).
3. Distill → Research → Network (map/graph/table + inline editable cards)
   → Ask (try the example chips).
