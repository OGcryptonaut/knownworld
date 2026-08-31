# Knownworld — Build Roadmap (confirm each phase with the owner before building it)

## P0 · Scaffold
Next.js + TypeScript + SQLite (file in project dir, e.g. better-sqlite3), local-only.
`npm install && npm run dev` = the entire setup. Repo starts PRIVATE; goes public
at P5. .gitignore from commit 1: `data-local/`, `*.sqlite`, any real export.
Gate: clean clone runs; empty-state onboarding renders.

## P1 · Ingest + raw table
Parse Telegram Desktop JSON (`result.json`) → local chat store → the raw
spreadsheet page (every imported contact, message counts, nothing hidden).
Gate: owner's real export loads; counts match the export; zero network calls
during ingest (prove with devtools).

## P2 · Refine (copy-paste loop)
Batcher (~20 chats) → prompt renderer (SPEC prompt) → paste-back box → JSON
validator (rejects with reasons) → people table with company_definite /
company_inferred separated; closeness computed locally from volume+recency;
work-only filter; per-person summaries stored.
Gate: owner runs 3 real batches through his own assistant end-to-end;
malformed paste rejected gracefully; ≥80% of loaded rows need no manual fix.

## P3 · Enrich + verification cards
Search-client interface (pluggable: user search-API key OR manual
paste-of-results mode — both ship). Footprint search per person → evidence →
match / possible-mismatch verdict → review cards; owner approval writes DB;
`unverified` badge for non-resolving people.
Gate: 10 real contacts enriched; at least one deliberate mismatch case shows
the mismatch verdict instead of merging.

## P4 · Job run + pipeline
Company dedupe → ATS feed clients (Greenhouse, Lever, Ashby, Workable,
SmartRecruiters) using data/ats-slugs.json → keyword careers-search fallback →
role-fit filter from onboarding profile → results stream to dashboard with all
known contacts per company ranked by closeness → select → warm message drafted
per selected position+contact. Pipeline: lead → outreach → referred →
interview → offer/closed, follow-up dates, overdue flags.
Gate: one click on the owner's real network returns real openings; a selected
role produces a usable warm draft; a promoted lead moves through two stages.

## P5 · Release
Name + license finalized · docs walkthrough by a cold reader · privacy screen
("everything that leaves this machine") · history audit (no real data ever
committed) · repo flips public.
