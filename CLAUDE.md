# Knownworld — build rules (HACKATHON BUILD: All Things Agentic, deadline Aug 31 2026 5pm PDT = Sep 1 01:00 Lisbon)

Read docs/SPEC-HACKATHON.md first — it governs this build. docs/SPEC.md (v1+v1.1)
defines the product flow; where they differ on runtime/storage, SPEC-HACKATHON wins.
docs/ROADMAP-HACKATHON.md is the schedule. The original local-first architecture
returns after the hackathon as the OSS version; do not delete its docs.

## Mandated stack (hackathon rules — all three, non-negotiable)
1. Gemini 3.5 Flash or newer via Gemini API (or Vertex AI)
2. Google ADK as the agent framework (agents: ingest, refine, enrich+verify,
   job scout, outreach drafter)
3. Google Cloud: Cloud Run (app + jobs) + Firestore (distilled state only)

## Privacy boundary (architecture, not promises — build exactly this)
1. The raw Telegram export NEVER leaves the browser: client-side parse,
   IndexedDB, raw table renders locally.
2. Refine streams transient ~20-chat batches to Gemini; nothing stored
   server-side; only distilled rows (name, tg_id, company_definite,
   company_inferred, role, closeness, 2-line summary) persist to Firestore.
3. Post-refine stages use distilled data only: searches get name+company,
   job feeds get company names, drafts use one contact's summary.
4. One-script self-deploy to the user's own GCP project (README documents it).
5. Privacy manifest screen: what leaves the browser, what's stored, what
   never is, plus a delete-everything switch.

## Product rules (unchanged from SPEC v1.1)
- company_definite and company_inferred never merge; unverified stays visible
- closeness computed in code from volume+recency, never by the model
- verification cards: user approval writes the DB; mismatches never auto-merge
- role-fit profile from onboarding filters the job run
- warm messages draft only for user-selected positions
- the app never sends messages anywhere, on any channel
- no LinkedIn login/cookies/scraping vendors/emails — search queries only
- pipeline: lead → outreach → referred → interview → offer/closed

## Engineering discipline (judged at 30%)
- Structured output (JSON schema) on every model call; malformed output
  rejected with reasons, never silently patched
- Per-run telemetry: agent, model, tokens, cost, duration → activity log UI
- Failure paths: batch retry with backoff; non-resolving people get
  `unverified`, never guesses
- Secrets in env/Secret Manager only; repo history must stay clean — the
  builder's real export lives in gitignored data-local/ and must never be
  committable (gitignore in the first commit)
- Keep GCP spend inside the $150 credit; log estimated spend per day

## Working style
Present the plan for each day, get explicit GO, evidence-gated report after.
Repo private; share with testing@devpost.com and cloudhackathons@google.com
before submission. Every commit inside the submission window — history is
our compliance proof.
