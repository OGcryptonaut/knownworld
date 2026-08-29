# Knownworld — Hackathon Variant (All Things Agentic, Devpost, submit by Aug 31 2026)

This variant OVERRIDES SPEC.md's local-only architecture for the hackathon
build. The open-source local-first version remains the product's future; this
is the same product on the mandated Google stack. Same flow, same v1.1
amendments, different runtime.

## Track: The Taskmaster
"Find a messy, multi-step chore... build an agent that handles the details."
Our chore: the warm-network job search. The agent turns a raw Telegram export
into ranked warm paths and drafted outreach, autonomously, in the background.

## Mandatory stack (all three required by rules)
- **Gemini 3.5 Flash or newer** via Gemini API / Vertex AI — powers refine,
  enrich+verify (with Google Search grounding), and outreach drafting
- **Google ADK** (Agent Development Kit) as the agent framework
- **Google Cloud**: Cloud Run (app + background jobs) + Firestore (state)

## Agent architecture (ADK multi-agent pipeline)
1. **Ingest agent** — parses Telegram Desktop JSON, writes raw contacts to
   Firestore, renders the raw spreadsheet page
2. **Refine agent** — Gemini Flash, batched, structured output (JSON schema):
   name · tg_id · company_definite · company_inferred · role_guess ·
   work-only filter · per-person summary; closeness computed in code from
   volume+recency, never by the model. Runs async in the background over
   thousands of chats — the "heavy lifting" the brief asks for
3. **Enrich + Verify agent** — Google Search grounding per person: LinkedIn
   URL, location, current employer, footprint (articles/socials); compares
   evidence to the DB → match / possible-mismatch verdict → review cards;
   user approval writes Firestore
4. **Job Scout agent** — dedupes companies, hits public ATS feeds
   (Greenhouse/Lever/Ashby/Workable/SmartRecruiters), search fallback,
   filters against the user's role-fit profile from onboarding
5. **Outreach Drafter** — on user selection only: warm message per chosen
   position + contact, grounded in that person's summary and closeness

Dashboard (Next.js on Cloud Run): raw table → people → review cards →
job board → pipeline (lead → outreach → referred → interview → offer/closed).

## Judging map
- Innovation & Operational Utility 40%: autonomous multi-step pipeline over
  real personal data solving a real chore (getting hired through people)
- Architectural Discipline 30%: decoupled ADK agents, Firestore state,
  structured outputs, per-run cost/telemetry, failure paths (malformed model
  output rejected with reasons, unverified flags instead of guesses)
- Demo & Production Readiness 30%: live unedited run on a REAL 5,000-chat
  export, Cloud Run console on screen, reproducible README

## Submission checklist (Devpost)
- Hosted URL (Cloud Run) — auth-gated is fine
- Repo (private OK: share with testing@devpost.com and
  cloudhackathons@google.com) + spin-up README
- Architecture diagram (ADK agents ↔ Gemini ↔ Firestore ↔ Cloud Run ↔ UI)
- ~4-min demo video: problem → value prop → live run → GCP console proof
- Write-up: features, tech, data sources, findings
- BONUS (do all): LinkedIn + X post with #AllThingsAgenticHackathon; a
  Medium/dev.to build post stating it was created for this hackathon;
  optional Gemma integration = the local refine mode (privacy bonus + model
  bonus in one)

## Compliance notes
- Code written entirely within the submission window (repo history proves
  it); the pre-existing skeleton is docs/spec only — disclose it in the
  write-up as prior ideation
- Demo data = the builder's own export; no third-party private data
- Keep GCP spend inside the $150 credit; app need not stay live after
  judging proof is captured

## Data boundary (answers the "upload my private chats?!" objection — build exactly this)
Nobody uploads their chat archive. The boundary, enforced in architecture:
1. **The raw export never leaves the browser.** result.json is parsed
   client-side; the raw table page renders from browser memory/IndexedDB.
2. **Refine streams transient batches** to the Gemini API and keeps nothing:
   batch in → structured rows out → batch discarded. Only the distilled rows
   (name, tg_id, company, role, closeness, 2-line summary) are ever written
   to Firestore. Message content is never stored server-side, ever.
   Trust delta vs the original copy-paste plan is minimal: content transits
   a model API either way — Gemini paid/Cloud tier is not used for training
   per Google's API terms; cite this in the UI.
3. **Everything after refine uses distilled data only**: enrichment sends
   name + company as search queries; job scout sends company names to public
   feeds; drafts use the stored 2-line summary of the selected contact only.
4. **Self-deploy is the product**: the README's one-script deploy stands up
   the whole stack in THE USER'S OWN Google Cloud project. No shared server,
   no operator who can read anyone's data. The hackathon demo instance is
   the builder's own, auth-gated.
5. **Privacy manifest screen** in the app: "what leaves your browser: refine
   batches to the Gemini API (transient), names+companies as search queries,
   company names to job boards. What is stored: the distilled rows you can
   see and delete. What is never stored: your messages." One screen, always
   current — and it's a judging asset (production-minded, Model-Armor-adjacent
   thinking), not just reassurance.
