# Google Cloud Proof Pack (D3 gate addition — mandatory pass/fail at judging)

Demo video runs entirely on the deployed .run.app URL — address bar visible,
auth login on camera. Captured DURING the live run:

1. Cloud Run services page — both services green (knownworld-web,
   knownworld-agents).
2. agents-service **Metrics** tab moving from the demo's own traffic.
3. Log tail showing refine batches with the **resolved Gemini model ID**.
4. Vertex AI usage page for project `knownworld`.
5. Firestore: collections + doc counts ONLY. **NEVER expand a person
   document on camera** — the console shows real names with no masking.

Deliverables: deploy.sh (exists) + DEPLOYMENT.md embedding the same
screenshots. D4 video script weaves these in (~45s total; owner cuts the
script separately).

## Capture checklist (tick during recording)
- [ ] .run.app address bar + auth login on camera
- [ ] Cloud Run services list, both green
- [ ] Metrics tab, live traffic
- [ ] Log tail w/ model ID visible
- [ ] Vertex usage page
- [ ] Firestore counts only — no person doc expanded
