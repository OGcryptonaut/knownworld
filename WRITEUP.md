# Knownworld — turn a decade of Telegram DMs into warm paths to your next job

*All Things Agentic — The Taskmaster track*

## The chore

Everyone gives job seekers the same advice: your network is your best way in. Nobody explains how to query a network. Mine lives in Telegram — 2,836 personal DM threads accumulated over roughly a decade of working in crypto — and as data it is useless: an 878 MB JSON export full of names I half-remember, companies people left years ago, and no index at all. The actual chore is a messy, multi-step slog: figure out who each person is now, where they really work, which of those companies are hiring for roles that fit me, who I'm genuinely close enough to message, and what to say that doesn't sound like a template. Done by hand, that's weeks of tab-hopping. I built an agent that does it in the background.

## What it does

Knownworld is a five-agent pipeline (Google ADK) behind a Next.js dashboard:

1. **Ingest** parses the raw 878 MB Telegram export entirely in the browser — the file is larger than V8's maximum string length, so it's a streaming parser in a Web Worker feeding IndexedDB. 3,638 chats, 2,836 of them personal, parsed in about 50 seconds. Nothing uploaded.
2. **Refine** (Gemini 3.5 Flash, structured output) ran **62 batches unattended** over every chat with exportable text and distilled **423 people, 412 of them work-relevant** — company, role guess, work-only filter, and a two-line summary per person. It resumes from persisted state if interrupted; I started it and walked away.
3. **Enrich + Verify** fans out per-person jobs through **Cloud Tasks** to a Cloud Run handler. Each job runs Google Search grounding on name + company and compares evidence against the database. 17 contacts enriched so far, every one with grounding citations: **7 match, 6 possible mismatch, 4 unverified** — no guesses.
4. **Job Scout** dedupes the network's companies and probes public ATS feeds (Greenhouse, Lever, Ashby, Workable, SmartRecruiters). **26 of 290** companies answered with a live feed — and then feed-identity verification (board-name and description checks, computed in code) kept only **5**: generic slugs collide with same-named companies constantly, and a warm intro pointed at the wrong company's job would be worse than none. The verified feeds yielded **120 real postings**, filtered against my role profile down to **3 role-fit openings with warm paths** into them.
5. **Outreach Drafter** writes a warm intro only when I select a posting + contact, grounded solely in that person's stored two-line summary and code-computed closeness. **$0.00007 per draft.**

The dashboard tracks everything on a pipeline board: lead → outreach → referred → interview → offer.

## The privacy boundary

Nobody sane uploads a decade of private conversations to someone's hackathon project. So the boundary is built as architecture, not promises:

- **What leaves the browser:** transient refine batches to the Gemini API (batch in, structured rows out, batch discarded); name + company as search queries during enrichment; company names to public job boards. That's the complete list.
- **What is stored:** distilled rows only — name, company, role, closeness, a two-line summary — visible in the app and deletable.
- **What is never stored:** message content. Anywhere. Ever. The raw export is parsed client-side and lives in browser storage only.

On top of that: masking at render (first name + last initial + company) defaults on, and the deployed URL is auth-gated. But the deepest guarantee is the deployment model itself: this demo instance was deployed with the same one-script process any user runs — there is no shared server, no operator who can read anyone's data.

## How it's built

The mandated stack, used honestly: **Gemini 3.5 Flash** on Vertex AI with structured output on every single model call, and the resolved model id logged per batch in the activity telemetry so compliance is provable from the logs, not claimed. **Google ADK** `LlmAgent` + `output_schema` for the agents — with one tradeoff worth naming: `output_schema` disables tools, so grounded enrichment is a two-step pipeline — a `google_search`-grounded call gathers evidence with citations, then a schema-constrained extract call structures it. **Cloud Run** ×2 (dashboard + Python agents service), **Firestore** for distilled state, **Cloud Tasks** for enrichment fan-out, **Secret Manager** for every credential, **Cloud Logging** for the per-batch telemetry.

Discipline rules I held to throughout: verify verdicts (match / possible-mismatch / unverified) are computed in code by comparing evidence to the database — never asked of the model. Closeness is computed in code from message volume + recency; the model's schema has no closeness field to smuggle one through (a hostile fake model in tests tried — it reached storage 0 of 62 times). Malformed model output is rejected with logged reasons. Thin evidence produces "unverified," never a guess. Every call logs its cost: total model spend for the entire build, full-corpus runs included, is **~$0.19**. 86 agent tests + 21 web tests, all green.

## Two bugs worth telling

**Cloud Tasks ate my auth header.** The agents service authenticates callers with an app token, and Cloud Tasks pushes enrichment jobs to it — which kept arriving as 401s despite the token being configured on the task. It turns out that when OIDC is enabled on a Cloud Tasks push, Cloud Tasks *overwrites* the `Authorization` header with its own OIDC token, silently discarding whatever you put there. The fix: let OIDC keep `Authorization`, and move the app token to a custom `X-Agents-Token` header verified alongside it. Both paths are pinned by tests now.

**The health check that never arrived.** After deploy, `/healthz` failed — while working perfectly locally, and with the container logs showing *nothing*. The nothing was the clue: requests weren't reaching the container at all. Google's frontend intercepts the literal `/healthz` path on `*.run.app` domains and answers it itself. I added a `/health` alias, pointed all checks at it, and wrote the regression test so future me doesn't rediscover this at 2am.

## Findings

Running this on a real corpus taught me things no synthetic demo would:

- **The median DM thread is 1 message.** Most of a "network" is drive-by contact — which is exactly why the work-only filter matters (412 of 423 distilled people survived it).
- **1,578 of 2,836 personal chats contained zero exportable text** — media, stickers, service messages. Real exports are mostly noise.
- **Stale networks are the norm.** 6 of 17 enrichments surfaced possible mismatches — including a natural catch where the database said TON Foundation and the grounded evidence showed a new employer with "Ex-TON Foundation" in the footprint. Verification isn't a nice-to-have; it's the product.
- **Only 26 of 290 network companies answered on a public ATS feed — and identity checks cut that to 5.** A feed existing at a plausible slug proves nothing: my network's "NCC" matched NCC Group's board, "Juno" matched a student-loan company, "Proof of Vibes" matched a court-filings firm. Verifying feed *identity*, not just existence, was the difference between a demo and a database of confidently wrong warm paths. The fallback-discovery problem is real, not an edge case.

## Data sources & compliance

The only data in the system is my own Telegram Desktop export; no third-party private data anywhere. The repo's pre-window skeleton was docs and spec only — disclosed here as prior ideation; all code was authored inside the submission window, provable from the commit history (the gitignore protecting the raw export landed in commit 1). Spend stayed comfortably inside credits.

## What's next

This cloud build is one variant of a local-first product. Next: an open-source local mode — SQLite instead of Firestore, guided copy-paste refine so nothing transits any API you didn't explicitly choose — and an optional Gemma local-refine path so distillation can run entirely on your own machine.
