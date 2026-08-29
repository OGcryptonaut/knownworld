"""Enrich + Verify agent (D2 stub).

Planned: per distilled person, Google Search grounding via Gemini to find a
LinkedIn URL, location, current employer, and public footprint; compare
evidence to the stored row and emit a match / possible-mismatch verdict for
the review-card UI. User approval writes Firestore; mismatches never
auto-merge, and non-resolving people are flagged `unverified`, never guessed.
Input is distilled data only (name + company as search queries) — never
message content.
"""
