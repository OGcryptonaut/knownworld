# Sample dataset — fully fictional Telegram export for testing

`result.json` is a byte-accurate Telegram Desktop export (~900 KB, 18 chats,
~2,500 messages) of an invented personal network: **15 fictional people**
plus saved messages, one group, and one bot chat. Nobody in it exists; every
name was invented for this dataset. The **companies are real on purpose** —
so the job scout has live public feeds to hit (per `data/ats-slugs.json`,
the identity-verified feeds today are **CoinMarketCap** and **Ripple**;
Circle/Ledger/Kraken/etc. personas demonstrate the honest no-feed path).

Generated deterministically by `generate.py` (seed 42, anchored to
`--now 2026-08-29T18:00:00`). Regenerate with a fresh date anytime:

```bash
python3 sample-data/generate.py --now 2026-09-15T12:00:00
```

`web/src/lib/__tests__/sample-data.test.ts` parses this file with the real
ingest code on every test run, so it can never drift from the contract.

## Baked-in edge cases (SAMPLE-DATA spec)

| Persona | tg_id | Edge case |
|---|---|---|
| Marta Yezerska | 314159265 | Ripple (stated) — verified feed → live jobs + warm path |
| Tomas Keller | 428571428 | CoinMarketCap (stated) — verified feed → live jobs |
| Tomas Keller | 271828182 | **Same-name collision** — Ledger firmware; verify must flag, never merge |
| Nazar Hlibovych | 161803398 | Employer only **hinted** (zkEVM/POL/Amoy) → `company_inferred`, never definite |
| *(nameless)* | 599999999 | Handle-only (@degen_dolphin) — excluded from outreach until named |
| *(nameless)* | 588888888 | Handle-only (@block_mole) — excluded from outreach until named |
| Petro Malanchuk | 655555555 | ~90% gym/dinners → high closeness but **not work-relevant** |
| Yuriy Stotskyi | 499999998 | Talks shop, employer never named → must stay **unverified** |
| Lina Marchenko-Fedak | 355555554 | Non-crypto (bank UX) → refine must **exclude** her |

Everyone else: Iryna (Chainalysis, recruiter), Sofia (Circle), Andriy
(founder, Yieldbird Labs), Olena (Aave grants), Danylo (Kraken), Kateryna
(Fireblocks, dormant 8 months). Closeness spreads 52–98 via volume+recency —
computed in code at ingest, as always.

`expected-people.json` is the golden reference for what a correct refine
pass should distill (definite vs inferred split, exclusions, nameless rows).
Reference only — model wording will vary.

## How to test with it

1. Start both services (`web/README.md`): the app on :3040, agents on :8080.
2. Open the app → import `sample-data/result.json` on the ingest screen
   (or set `DEV_EXPORT_PATH=$PWD/sample-data/result.json` for the scripted
   dev-loader route).
3. Run **Refine**. 15 personal chats = 1 Gemini batch (cents on the real
   model). ⚠️ With `FAKE_LLM=1` the stub distills only one canned person
   per batch — use the real model to see the full table.
4. **People** → 13–14 distilled rows, closeness-ranked. **Verify** → the
   Tomas Keller mismatch, the unverified rows. **Jobs** → live postings at
   CoinMarketCap/Ripple with warm paths. **Draft/Pipeline** → nameless rows
   refused until named.

The raw export never leaves the browser — same boundary as a real import.
