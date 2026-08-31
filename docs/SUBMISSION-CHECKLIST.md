# Submission eligibility ledger (All Things Agentic — Devpost, Aug 31 5pm PDT)

## Mandatory stack (rules — all three)
| Requirement | Status | Proof |
|---|---|---|
| Gemini 3.5 Flash or newer | ✅ LIVE | `gemini-3.5-flash` via Vertex (`global`); resolved model id logged in all 62 activity rows |
| Google ADK agent framework | ✅ LIVE | ADK 2.8 `LlmAgent` + `output_schema` (refine); enrich/jobscout/drafter agents land D2 |
| Google Cloud | ✅ LIVE | Cloud Run ×2 + Firestore + Tasks + Secret Manager + Logging |

## Google Cloud services (owner directive 29 Aug — all must be in the build)
| Service | Use | Status |
|---|---|---|
| Cloud Run | backend (agents service) + dashboard, both deployed | ✅ LIVE (auth-gated) |
| Firestore | distilled people, activity_log, runs | ✅ LIVE (423 people, 62 activity docs) |
| Cloud Tasks | phase orchestration for the enrich pipeline (per-person enrich jobs queued → Cloud Run handler) | ✅ LIVE (proven on prod) |
| Secret Manager | dashboard auth secret + agents API token + app config (Tavily = optional fallback slot, not built — enrichment uses native Gemini grounding) | ✅ setup-gcp.sh creates all three; deploy.sh mounts via `--set-secrets` |
| Cloud Logging / Monitoring | structured per-batch logs + service metrics (proof-pack captures 2–3) | APIs enabled; log format lands D2, captures D3 |

## Devpost checklist
- [x] Hosted URL (Cloud Run, auth-gated) — LIVE
- [x] Private repo + gitignore-first history (all code inside window)
- [ ] Repo shared with testing@devpost.com + cloudhackathons@google.com — at submission, on owner GO (only the repo admin can share)
- [x] Publication README (31 Aug): walkthrough with live-instance screenshots, mermaid architecture, demo-contacts download link, video slot marked
- [x] Architecture diagram finalized (infra/architecture.mmd, v2 wording; rendered inline in README)
- [x] v2 promoted to main (fast-forward; old main preserved as branch v1); demo-corpus raw URL follows
- [ ] ~4-min video incl. Google Cloud Proof Pack (docs/PROOF-PACK.md) — paste the link into the README video slot
- [x] Write-up (WRITEUP.md; discloses doc-skeleton as prior ideation)
- [ ] BONUS: LinkedIn + X posts #AllThingsAgenticHackathon, build blog — D4, each publishes only on explicit owner GO
- [ ] BONUS optional: Gemma local-refine mode — only if clock allows (first scope cut)

## Compliance
- [x] All code within submission window (repo history is proof; first commit 29 Aug)
- [x] Demo data = builder's own export only
- [x] Spend inside credits — €20 budget alert live; refine full-run cost $0.17
- [x] Privacy: masking ON in all public artifacts; auth-gated URL; contacts' data never in repo
