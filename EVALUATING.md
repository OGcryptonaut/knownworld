# Evaluating Knownworld v2 — five minutes, nothing to upload

**TL;DR: create an account, click "Load dev corpus", and walk the three
pages. The demo network is 15 famous founders (openly fictional chats, real
public companies) — so the job scout returns thousands of REAL, current
postings from live identity-verified feeds, each with a warm path through
"your" contact.**

## The flow (≈5 minutes)

1. **Create an account** — email + password. The account IS the data
   boundary: every contact row lives in your own tenant; another account
   sees nothing; the Privacy switch wipes only yours.
2. **Onboarding wizard** — load the demo corpus (or your own Telegram
   export: it parses IN the browser and never uploads).
   - *Distill*: chats stream to the model in transient batches; only
     distilled rows persist. The activity feed shows model, tokens, cost
     per batch. Closeness is computed in code — never by a model.
   - *Research*: per-contact grounded lookup — evidence, citations,
     coordinates; the match/mismatch verdict is computed in code.
3. **Database** — map + network graph on top, the contact table below.
   Click a row: the card expands inline with the evidence; edit it — an
   owner correction is definitive (`verified by owner`), and a
   possible-mismatch can never be merged without your explicit choice.
4. **Requests** — ask in plain language:
   - *"Is there a BD or partnerships job for me — posted in the last 30
     days?"* → live postings from SpaceX / Stripe / Coinbase / Airbnb /
     Databricks / Anduril / Figma / Spotify / Palantir feeds (9 of the 15
     companies have public identity-verified boards; the run's stats say
     honestly which don't), each with warm-path contacts ranked by
     closeness.
   - *"I'm going to an AI conference in San Francisco — who should I meet
     there?"* → grounded matches with reasons.
   Ask again next week — feeds and the network move; every request is a
   stored snapshot.

## What's real and what's mocked — honestly

- The **conversations are invented** (the dataset says so in its own
  metadata); the **companies, roles, and cities are real public facts**.
- The **job feeds are 100% live** — real current postings fetched at run
  time from public ATS boards; slugs are only ever live-verified with
  board-identity checks, never guessed.
- In no-credentials mode the model layer is a deterministic stub reading a
  fact sidecar; telemetry labels it `fake:` on every row — the app never
  pretends a model ran when it didn't. The deployed instance runs the real
  mandated stack: **Gemini via ADK on Vertex AI**, Cloud Run + Firestore
  (deploy tooling refuses any other model backend).

## Running it locally (zero cloud, zero keys)

```
cd web && npm install && npm run dev -- -p 3040
```

```
cd agents && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && ./run-local.sh
```

Open http://localhost:3040 — sign up, load the corpus, walk the flow.
State lives in gitignored JSON on disk (`STORE_MODE=local`); switching to
Firestore/Vertex is an env change (`deploy.sh`). 107 service + 29 web tests
run the same way: `pytest` / `vitest`.

## Privacy boundary (architecture, not promises)

Raw exports parse in the browser and never reach a server; refine batches
are transient; only distilled rows + telemetry persist, per-account;
enrichment queries carry name+company only; the app never sends messages
anywhere, on any channel.
