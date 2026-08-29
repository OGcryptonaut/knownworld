# Evaluating Knownworld — Without Uploading Anything

**TL;DR: You don't need to give this project your chats to judge it — you
never need to. The deployed instance (credentials in our submission) runs on
the builder's own real 3,600-chat network with privacy masking on. Walk the
five-step flow below against real data, live feeds and all, in about five
minutes.**

## Why there's nothing to upload

Knownworld's core promise is that your private conversations are nobody's
business — not ours, not a server's, not even the AI's beyond transient
processing. It would be strange to ask judges to upload their real Telegram
history to test a privacy product. So the demo instance is the builder's own:
real relationships, real distilled data, rendered behind an auth gate with
**privacy display mode on** (surnames and handles masked at render — the
stored data is never altered, the screen just refuses to show it).

## How to evaluate (≈5 minutes, deployed instance)

1. **Log in** (URL + credentials in the submission) — the basic-auth gate is
   part of the product: no public access, ever.
2. **Raw Table + Refine** — 2,836 personal chats distilled by the refine
   agent in 62 unattended Gemini batches; the activity log shows the resolved
   model id, tokens, and cost per batch. The raw export itself parsed in the
   builder's browser and never reached a server.
3. **Verify** — grounded enrichment cards with citations: approve one, then
   find a **possible-mismatch** card (the agent caught a contact who had
   changed jobs) and note it was **corrected inline** — the correction wrote
   the database, marked *verified by owner*.
4. **Jobs** — real, current openings from public ATS feeds at companies where
   the builder actually knows someone, each with its warm path ranked by
   closeness. Every feed passed identity verification (a plausible slug is
   not proof — see the write-up).
5. **Draft + Pipeline** — pick a role, draft a warm intro grounded only on
   the stored two-line relationship summary, promote it, and walk the stages
   (lead → outreach → referred → interview → offer/closed).

## One honest note on enrichment

The web-verification agent runs **live Google-Search-grounded Gemini** per
person and cites its sources; verdicts (match / possible-mismatch /
unverified) are computed in code from evidence-vs-database comparison, never
by the model, and non-resolving people stay *unverified* rather than guessed.
The demo video shows this end-to-end on the real network.

## Running the code yourself, without any cloud

Clone the repo and use the no-cloud path — no GCP project, no API keys:

```
cd web && npm install && npm run dev -- -p 3040
```

```
cd agents && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && FAKE_LLM=1 .venv/bin/uvicorn app.main:app --port 8080
```

`FAKE_LLM=1` swaps the model for a deterministic stub: ingest your own (or
any synthetic) Telegram export fully in-browser, run refine end-to-end, and
inspect every code path — 90 service tests + 21 web tests run the same way.
The README covers the full local setup.

## If you want to run it on real data

That's what the product is for — your own instance, your own Google Cloud
project, one deploy script (see README and infra/README-DEPLOY.md). Your
export parses in your browser and never uploads; the AI reads transient
batches and stores none of them; only the distilled contact table persists,
in infrastructure only you control. **This demo instance was deployed with
the same one-script process any user runs** — no shared server, no operator
who can read anyone's data.
