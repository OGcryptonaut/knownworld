# Evaluating Knownworld: five minutes, nothing to upload

**TL;DR: open the [live instance](https://knownworld-web-ncr73a6xhq-uc.a.run.app),
create an account, press "Try the demo network", and walk the three pages.
The demo network is 17 wholly fictional crypto/web3 professionals (invented
people and chats; only their companies are real), so the job scout returns
real, current postings from live identity-verified feeds, each with a warm
path through "your" contact.**

## The flow (about 5 minutes)

1. **Create an account.** Email plus password, or the Google button (that
   one loads Google's sign-in script on the login page; password sign-in
   loads nothing external). The account is the data boundary: every contact
   row lives in your own tenant, another account sees nothing, and the
   Privacy switch wipes only yours.
2. **Onboarding wizard.** Press "Try the demo network", or load your own
   Telegram export (the file parses in the browser and is never uploaded).
   - *Distill*: chats stream to the model in transient batches, through the
     web service's same-origin proxy and the agents service in memory, and
     only distilled rows persist. The run log shows model, tokens, and cost
     per batch. Closeness is computed in code, never by a model.
   - *Research*: a grounded lookup per contact, with evidence, citations,
     and coordinates. The match or mismatch verdict is computed in code.
3. **Database.** Map and network graph on top, the contact table below.
   Click a row and the card expands inline with the evidence. Edit it: an
   owner correction is definitive (verified by owner), and a possible
   mismatch can never be merged without your explicit say.
4. **Requests.** Ask in plain language:
   - *"Is there a BD or partnerships job for me, posted in the last 30
     days?"* returns live postings from the SpaceX, Stripe, Coinbase,
     Airbnb, Databricks, Anduril, Figma, Spotify and Palantir feeds (9 of
     the 15 companies have public identity-verified boards; the run's stats
     say honestly which don't), each with warm-path contacts ranked by
     closeness.
   - *"I'm going to an AI conference in San Francisco, who should I meet
     there?"* returns grounded matches with reasons.

   Ask again next week. Feeds and the network move, and every request is a
   stored snapshot.

## What's real and what's mocked, honestly

- The **conversations are invented**; the dataset says so in its own
  metadata. The **companies, roles, and cities are real public facts**.
- The **job feeds are 100% live**: real current postings fetched at run
  time from public ATS boards. Slugs are only ever live-verified with
  board-identity checks, never guessed.
- In no-credentials mode the model layer is a deterministic stub reading a
  fact sidecar, and telemetry labels it `fake:` on every row. The app never
  pretends a model ran when it didn't. The deployed instance runs the real
  mandated stack: **Gemini via ADK on Vertex AI**, Cloud Run and Firestore
  (the deploy tooling refuses any other model backend).

## Running it locally (zero cloud, zero keys)

```
cd web && npm install && npm run dev -- -p 3040
```

```
cd agents && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && ./run-local.sh
```

Open http://localhost:3040, sign up, load the corpus, walk the flow. State
lives in gitignored JSON on disk (`STORE_MODE=local`); switching to
Firestore and Vertex is an env change (`deploy.sh`). The same 152 service
and 34 web tests run either way: `pytest` / `vitest`.

## Data boundary (architecture, not promises)

The raw export parses in the browser and is never uploaded. Distill sends
~20-chat batches through the web service's same-origin `/agents/*` proxy to
the agents service and on to Gemini, in memory at every hop, never written
or logged; only the distilled rows come back and persist. So the honest
claim is "we never store a message", not "messages never leave the
browser": on the hosted instance the operator could observe a batch in
flight, on a self-deploy nobody is in the loop. Research queries carry a
name plus a company. Requests send your question to the planner, the
question plus candidate rows, cards and owner notes to the matcher and
composer, and the question plus up to 8 name/company pairs to Google Search
grounding; an intro draft sends the contact's first name, stored summary,
closeness and your ask. Stored per account: distilled rows (with the
model-written summary and your note), research cards, the activity log, job
postings and runs, tracked leads with drafts, and every request verbatim
with its result snapshot; plus the account record (email, scrypt hash). The
Privacy page lists the same inventory and deletes all of it except the
account. The app never sends messages anywhere, on any channel. Signing in
with Google loads Google's GIS script on the login page; password sign-in
loads nothing external.
