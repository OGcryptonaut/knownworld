# 4-day build plan (GO gate per day)

## D0 · Tonight (Thu 27) — scaffold
Next.js app + ADK project + Firestore + Cloud Run deploy pipeline; client-side
export parser + raw table page (IndexedDB); repo private, gitignore-first.
Gate: raw table renders the builder's real export fully client-side — network
tab shows ZERO chat content leaving the browser.

## D1 · Fri 28 — refine agent
Batching (~20 chats), Gemini Flash structured output, transient batches,
distilled rows to Firestore; closeness computed in code; work-only filter;
background run with progress UI + activity log entries.
Gate: full 5k-chat corpus refined autonomously; spot-check 20 rows ≥80%
usable; Firestore contains distilled rows ONLY (no message content — prove
by inspection).

## D2 · Sat 29 — enrich+verify + job scout
Search-grounded enrichment per person (LinkedIn URL, location, employer,
footprint) with citations; match/mismatch verdicts; review cards writing on
approval; company dedupe; ATS feed clients + slug dictionary; role-fit
filter from onboarding; job board UI.
Gate: 15 real contacts enriched with citations; one deliberate mismatch
shows the mismatch card; job run returns real openings for the builder's
real network.

## D3 · Sun 30 — pipeline + polish + deploy proof
Outreach drafter (selection-only); pipeline board with stages incl.
referred; privacy manifest screen; auth gate; architecture diagram; README
spin-up instructions tested from a clean clone; Cloud Run production deploy.
Gate: full flow end-to-end on production URL; diagram + README done.

## D4 · Mon 31 (deadline 01:00 Tue Lisbon — submit by evening) — submission
~4-min video: problem → value prop → LIVE unedited run on the real export →
Cloud Run console + Vertex logs on screen. Write-up (features, tech, data
sources, findings). Submit on Devpost with hours of buffer. Then bonus:
LinkedIn + X posts with #AllThingsAgenticHackathon, build blog on
Medium/dev.to stating it was created for this hackathon. Optional if time:
Gemma local-refine mode (double bonus).
