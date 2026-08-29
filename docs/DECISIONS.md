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
