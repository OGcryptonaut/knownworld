# Architecture (v1)

Local web app: Next.js (or equivalent) + SQLite in the project folder. No
cloud services required. Optional pieces are pluggable:

- ingest/: parses Telegram Desktop JSON export → raw chat store (local only)
- refine/: batcher + prompt renderer + JSON validator → people table
- enrich/: search client (pluggable: user-supplied search API key or manual
  paste of search results) → enrichment fields + unverified flags
- jobs/: ATS feed clients (Greenhouse/Lever/Ashby/Workable/SmartRecruiters)
  + company→slug dictionary (data/ats-slugs.json, community-extendable)
- ui/: dashboard (People, Job Run, Pipeline) — dashboard is the entire
  product surface

Design principles: park features, never delete data; definite vs inferred
never merged; everything that leaves the machine is enumerable on one screen.

## Hackathon variant (governs the current build)
Browser (client-side export parse, IndexedDB, raw table) → ADK agent pipeline
on Cloud Run: refine (Gemini Flash, transient batches) → enrich+verify
(Search grounding, citations) → job scout (ATS feeds + slug dict) → outreach
drafter (selection-only) → Firestore (distilled rows, runs, pipeline) →
Next.js dashboard (Cloud Run, auth-gated). Self-deploy script targets the
user's own GCP project. SQLite/local-first returns post-hackathon as OSS mode.
