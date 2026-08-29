# Knownworld — demo video script (~4 min)

> SKELETON — beats + timing only. Owner drops in the narration lines
> (or replaces this file wholesale). Recording rules: prod .run.app URL,
> address bar visible, basic-auth login ON CAMERA, Privacy display mode ON,
> Firestore shown as collection counts only (docs/PROOF-PACK.md checklist).

## Beat sheet
| t | Beat | On screen |
|---|---|---|
| 0:00–0:25 | The chore: your network is your best way into a job — and it's unqueryable. 2,836 real DMs, a decade of relationships, zero structure. | [OWNER LINE] over Telegram Desktop + the export folder |
| 0:25–0:50 | The boundary up front: the export never leaves the browser. | Onboarding page; DevTools network tab open while the 878 MB file loads — zero chat content leaving; raw table renders |
| 0:50–1:30 | Autonomous refine: 62 batches, unattended. | /refine live run (or the completed activity log): per-batch model id, tokens, cost; people appearing; "only distilled rows persist" banner |
| 1:30–2:10 | Enrich + verify: grounded evidence, verdicts in code, human approves. | /verify: a match card → approve on camera; the MISMATCH card (evidence vs DB, red) — "it caught a contact who'd changed jobs" |
| 2:10–2:45 | The payoff: real openings where I already know someone. | /jobs: run scout, fit-filtered board, warm-path chips; open DraftModal → generate → the draft references real shared context; Copy ("the app never sends anything") |
| 2:45–3:00 | Pipeline: lead → outreach → referred → interview → offer. | /pipeline board, overdue flag visible |
| 3:00–3:45 | GOOGLE CLOUD PROOF PACK (mandatory): | Console tabs pre-opened: ① Cloud Run both green ② agents Metrics moving ③ log tail w/ `gemini-3.5-flash` ④ Vertex usage ⑤ Firestore counts only |
| 3:45–4:00 | Close: self-hostable thesis. | [OWNER LINE]: "this demo instance was deployed with the same one-script process any user runs — no shared server, nobody who can read your data." Repo + privacy manifest screen |

## Pre-flight checklist
- [ ] Privacy display mode ON (header toggle — defaults ON)
- [ ] Basic-auth password at hand (`gcloud secrets versions access latest --secret=dashboard-auth`)
- [ ] Console tabs pre-opened & logged in (the five captures)
- [ ] docs/PROOF-PACK.md open on second screen as the tick-list
- [ ] NEVER expand a person document in Firestore on camera
