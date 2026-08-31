# SPEC v1 (locked 22 Aug 2026)

## Product
Self-hosted desktop/web app (runs locally). Dashboard-only: no Telegram bot, no notifications channel, no cloud.

## Flow
1. Onboarding points to Telegram Desktop → Settings → Advanced → Export Telegram Data → **JSON** (machine-readable). Phone/web clients cannot export; docs say so explicitly.
2. Refine = guided copy-paste: the app batches chats, renders a prompt per batch, the user pastes into their own assistant and pastes the JSON reply back. The app validates and loads. Output per person: name · tg_id · company_definite · company_inferred (kept separate, never merged) · closeness score derived from message volume + recency.
3. Enrichment = web search only: LinkedIn profile URL (found via search, never visited logged-in), location, current employer. Unresolved people get an `unverified` flag. No emails collected. No cookies, no vendors, no burner accounts.
4. Job run = **per company, not per person**: dedupe the network's employers, hit public ATS feeds first (Greenhouse `boards-api.greenhouse.io/v1/boards/{slug}/jobs`, Lever `api.lever.co/v0/postings/{slug}`, Ashby posting API, Workable, SmartRecruiters), web-search fallback for the rest. Results populate the dashboard live.
5. Every matched role shows **all contacts at that company**, ranked by closeness, each with a drafted warm outreach message (template + person context; user copies it into Telegram themselves — the app never sends anything).
6. Pipeline stages: `lead → outreach → referred → interview → offer | closed`. Kanban-style, per thread, with follow-up dates and overdue flags.

## Non-goals (v1)
No messaging/sending of any kind · no LinkedIn login or scraping · no email collection · no cloud sync · no mobile app · no multi-user.

## Open items
- Working name + license final call
- Refine quality benchmark: ≥80% usable extraction on a real 5k-chat corpus before v1 tag
- Company-name → ATS-slug mapping dictionary (seeded for crypto companies, community-extendable)

## v1.1 amendments (owner flow review, 22 Aug)
1. **Raw table first.** After upload, all imported contacts render as a
   spreadsheet page BEFORE any refine — the user sees exactly what came in.
2. **Per-person summaries.** Refine also produces a short conversation
   summary per contact (stored locally), which feeds keyword generation.
3. **Work-only filter.** Life/personal-only threads are excluded at refine.
4. **Footprint enrichment + identity verification.** Keyword search goes
   beyond the LinkedIn URL: articles, mentions, Medium, socials. Found
   evidence is compared against the database and the app renders a verdict
   per person: match / possible mismatch, with the evidence shown. Nothing
   auto-merges on a mismatch.
5. **Review cards.** Enrichment results appear as one card per person; each
   user approval/correction writes the database. Human confirms, app records.
6. **Role-fit profile.** Onboarding captures the user's target roles (e.g.
   BD, product, community). The job run filters positions against this
   profile — not every opening, the relevant ones.
7. **Select, then draft.** Warm messages are generated only for the
   positions the user selects, per chosen contact, with an introduction —
   not pre-drafted for everything.
8. Job discovery order stands: public ATS feeds first, keyword search of
   careers pages ("<company> careers/jobs/positions") as the fallback for
   companies not on a known ATS. Same result, faster and free where feeds
   exist.
