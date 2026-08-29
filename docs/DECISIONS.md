# Decision log (hackathon build)

Every entry dated. Privacy absolutes at top — they bind every later decision.

## Privacy absolutes (owner directive, 29 Aug)
- Nothing publishes online without the owner's explicit word. Repo private;
  shared ONLY with testing@devpost.com + cloudhackathons@google.com, at
  submission, on a separate GO.
- Contacts' details never appear in any public artifact. Dashboard has a
  privacy display mode masking surnames + Telegram handles at render
  (first name + last initial + company). Demo video recorded with masking ON.
  Screenshots for reports: masking ON. Masking defaults ON.
- Deployed URL stays auth-gated; no public access ever.
- GCP billing alert at $20 (budget on project `knownworld`).
- Raw export lives in gitignored data-local/ only; gitignore landed in
  commit 1 before any other file.

## 29 Aug — D0
- **Corpus**: data-local/result.json, byte-identical copy (md5
  43a45b0c7d1d86f3ab293aa823043383) of the owner's real Telegram Desktop
  export `~/Downloads/Telegram Desktop/DataExport_2026-08-18/result.json`
  (878 MB, exported 18 Aug). Source untouched.
- **Vertex AI over Gemini API key**: judges see request logs/metrics in the
  GCP console; spend lands on the project's credits; ADK defaults to Vertex
  (GOOGLE_GENAI_USE_VERTEXAI=TRUE). Owner approved.
- **Two services**: `web/` Next.js dashboard + `agents/` Python ADK service,
  both Cloud Run. ADK is Python-first; fighting that costs hours and weakens
  the Architectural Discipline story. Owner approved.
- **Streaming ingest is mandatory**: 878 MB > V8's max string length, so
  File.text()+JSON.parse cannot work. Web Worker + @streamparser/json over
  File.stream(), chats emitted one at a time into IndexedDB. Raw export
  never leaves the browser.
- **Firestore access only via the agents service.** The dashboard reads
  people/runs through the service API — one place to audit what's stored.
- **Model pin**: model id comes from env (GEMINI_MODEL), resolved id logged
  in per-batch telemetry — provable "Gemini 3.5 Flash or newer" compliance.
- **Closeness computed in code** (browser, at ingest): volume (log-scaled
  message count) + recency (exponential decay, 180-day half-life-ish),
  never by the model. Model output carries no closeness field at all.
- **Dev-load harness**: dev-only route (development builds only, reads
  data-local/ path from env) lets the app load the corpus without the OS
  file picker so verification is scriptable. Production build: route absent.
  All traffic localhost-only; the real flow uses the file picker.
- **ATS slugs (D2)**: generated candidates probed live against
  Greenhouse/Lever/Ashby endpoints; only verified hits enter the dict. No
  hand-invented slugs. Seed list: refined network + Circle, Ripple,
  Arbitrum, Tether, CoinMarketCap, Rain, Tron.
- **Scope-cut order if the clock bites**: Gemma bonus → footprint depth
  (LinkedIn URL + employer + location only) → review-card polish. Never
  cut: zero-network browser proofs, autonomous refine over the full corpus,
  the real job run, the live unedited video.

## 29 Aug — D0 gate evidence (verified live)
- Ingest of the real 878 MB corpus in-browser: 3,638 chats / 2,836 personal /
  864,444 text messages (908,104 minus service entries) — matches the
  independent Python ground-truth scan exactly. ~50s streaming parse.
- Network audit during ingest + raw table render: every request localhost:3040
  (Next assets, self-hosted fonts, dev-corpus load). Zero external hosts.
- Refine plumbing (FAKE_LLM service, localhost only): 62/62 batches
  autonomous, per-batch telemetry logged, resume state persisted. Closeness
  in storage = code-computed payload value in 62/62 rows; the fake model's
  deliberately sneaked closeness:99 reached storage 0 times.
- Coverage: 1,221 personal chats carry exportable text → 62 batches; 37
  chats with only service/media entries correctly excluded.

## 29 Aug — D3 gate addition (owner directive)
- Google Cloud Proof Pack is mandatory pass/fail: see docs/PROOF-PACK.md.
  Video runs on the deployed .run.app URL (address bar + auth login on
  camera); five console captures during the live run; Firestore shown as
  collections + counts ONLY — person documents never expanded on camera
  (console has no masking). DEPLOYMENT.md will embed the same screenshots.

## 29 Aug — model resolution (verified live)
- gemini-3.5-flash serves from Vertex location `global` (404 in
  us-central1). GOOGLE_CLOUD_LOCATION=global for model calls; Cloud Run +
  Firestore stay us-central1. Budget is €20 (billing account currency).

## 29 Aug — D2 gate evidence (verified live)
- Enrich: 17 real contacts enriched, ALL with grounding citations (7 match,
  6 possible_mismatch, 4 unverified — no guesses). Deliberate mismatch test
  (override Mintbase vs evidence Babylon Labs) rendered the mismatch card;
  a NATURAL stale-entry mismatch also surfaced (DB: TON Foundation →
  evidence: The Spawn, "Ex-TON Foundation" in footprint).
- Approval wrote the DB: company_definite 'TON' → 'TON (The Open Network)',
  linkedin/location/verified merged (Firestore inspected).
- Job scout: 283 network companies deduped, 26/290 live-verified ATS slugs
  (repo seed keeps only the 7 owner-named companies: Circle/ashby,
  Ripple/greenhouse, CoinMarketCap/lever, Rain/ashby verified; Arbitrum/
  Tether/Tron no-feed — nothing invented), 697 real postings fetched, 4
  role-fit after the bare-"partner" people-ops noise guard.
- Security before deploy: bearer-token middleware on the agents service
  (401 without token; /healthz open), token attached by Cloud Tasks pushes,
  and a server-side /agents proxy in the web app so the token NEVER reaches
  the browser. Dashboard basic-auth middleware + Secret Manager wiring in
  deploy.sh (transient .env.production.local + .gcloudignore re-include).
- Cost to date, all agents on Vertex: $0.18.

## 29 Aug (night) — D3 deploy evidence (verified live on Cloud Run)
- Both services live: knownworld-web (basic-auth gate: 401 bare / 200 with
  login) + knownworld-agents (bearer/X-Agents-Token; /health open).
- Dashboard reaches the service ONLY via the server-side /agents proxy —
  the API token never enters the browser.
- Cloud Tasks loop proven on prod: enqueue via dashboard proxy → Cloud
  Tasks (OIDC) → /enrich/task → real grounded enrichment → card written
  (run enrich-d428120f, match, 11 citations).
- Two real integration bugs found+fixed live: (1) Cloud Tasks OVERWRITES
  the Authorization header when OIDC is set — app token moved to
  X-Agents-Token; (2) Google's frontend intercepts the literal /healthz
  path on run.app — /health alias added. Both in tests now (86 green).
- New-project Cloud Build IAM gotcha fixed + documented in DEPLOYMENT.md.
- Pipeline live on prod (draft → outreach → referred walk); drafter
  grounded on stored summaries only, $0.00007/draft.
