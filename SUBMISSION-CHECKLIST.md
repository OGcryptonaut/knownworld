# Submission eligibility ledger (All Things Agentic — Devpost, Aug 31 5pm PDT)

## Mandatory stack (rules — all three)
| Requirement | Status | Proof |
|---|---|---|
| Gemini 3.5 Flash or newer | ✅ LIVE | `gemini-3.5-flash` via Vertex (`global`); resolved model id logged in all 62 activity rows |
| Google ADK agent framework | ✅ LIVE | ADK 2.8 `LlmAgent` + `output_schema` (refine); enrich/jobscout/drafter agents land D2 |
| Google Cloud | ✅ partial | Firestore live; Cloud Run deploy = D3 |

## Google Cloud services (owner directive 29 Aug — all must be in the build)
| Service | Use | Status |
|---|---|---|
| Cloud Run | backend (agents service) + dashboard, both deployed | D3 |
| Firestore | distilled people, activity_log, runs | ✅ LIVE (423 people, 62 activity docs) |
| Cloud Tasks | phase orchestration for the enrich pipeline (per-person enrich jobs queued → Cloud Run handler) | D2 — API enabled |
| Secret Manager | search API key (e.g. Tavily) for enrichment | D2 — API enabled |
| Cloud Logging / Monitoring | structured per-batch logs + service metrics (proof-pack captures 2–3) | APIs enabled; log format lands D2, captures D3 |

## Devpost checklist
- [ ] Hosted URL (Cloud Run, auth-gated) — D3
- [x] Private repo + gitignore-first history (all code inside window)
- [ ] Repo shared with testing@devpost.com + cloudhackathons@google.com — at submission, on owner GO
- [ ] README spin-up tested from clean clone — D3
- [x] Architecture diagram draft (infra/architecture.mmd) — finalize D3
- [ ] ~4-min video incl. Google Cloud Proof Pack (docs/PROOF-PACK.md) — D4
- [ ] Write-up (features, tech, data sources, findings; discloses doc-skeleton as prior ideation) — D4
- [ ] BONUS: LinkedIn + X posts #AllThingsAgenticHackathon, build blog — D4, each publishes only on explicit owner GO
- [ ] BONUS optional: Gemma local-refine mode — only if clock allows (first scope cut)

## Compliance
- [x] All code within submission window (repo history is proof; first commit 29 Aug)
- [x] Demo data = builder's own export only
- [x] Spend inside credits — €20 budget alert live; refine full-run cost $0.17
- [x] Privacy: masking ON in all public artifacts; auth-gated URL; contacts' data never in repo
