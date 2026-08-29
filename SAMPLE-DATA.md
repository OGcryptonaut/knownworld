# Sample Dataset — Test Knownworld Without Uploading Anything Real

**TL;DR: You don't need to give us your chats to evaluate this project. We'd
actually prefer you didn't. Import the included sample export and you'll
exercise every feature in about five minutes — including live job matching
against real, current job feeds.**

## Why a sample dataset exists

Knownworld's core promise is that your private conversations are nobody's
business — not ours, not a server's, not even the AI's beyond transient
processing. It would be strange to ask judges to upload their real Telegram
history to test a privacy product. So we built the demo path we'd want as
users: a fully fictional network that behaves exactly like a real one.

We also simply think you shouldn't have to do homework (install Telegram
Desktop, run a data export, wait for it) to evaluate a hackathon project.

## What's in it

`sample-data/result.json` is a byte-accurate Telegram Desktop export
containing **15 fictional people** — a believable personal network of
ex-colleagues, classmates, recruiters, and friends, with realistic message
histories generated for this purpose (volume and recency vary the way real
relationships do). None of them exist. We verified every name resolves to no
real notable person, and no thread references any real individual.

**The companies are real, though — deliberately.** The personas "work" at
Stripe, Figma, Spotify, Notion, Cloudflare and others with public job
boards, so when you hit **Run job scout**, the openings you see are live,
current postings from real feeds. Fictional people, real payoff.

Baked-in edge cases so you can test the honest paths, not just the happy
one:
- one contact whose employer is only ever *hinted at* in conversation — watch
  the app keep "inferred" separate from "definite" instead of pretending
- a **same-name collision** (two different Tomas Kellers) — the verification
  agent flags the mismatch instead of merging, and you can correct it inline
- two **nameless contacts** (handle only) — excluded from outreach drafting
  until named
- one thread that's ~90% gym plans and dinners — filtered as not
  work-relevant

## One honest note on enrichment

The web-verification agent works by searching the public internet for each
person. Fictional people, by design, can't be found — so in sample mode the
enrichment cards come **pre-seeded** (clearly labeled in-app) rather than
live-searched. Everything downstream of them — correction, approval, job
scouting, closeness ranking, drafting, the pipeline — runs the real code
paths on the real services. On a real export, enrichment runs live with
grounded search citations; the demo video shows that end-to-end on a real
5,000-chat network.

## How to test (≈5 minutes)

1. Log into the deployed instance (credentials in our submission) → choose
   **Import sample dataset**
2. Watch the refine agent process the threads in the background (Gemini,
   batch by batch — the activity log shows model, tokens, and cost per batch)
3. Open **Review** → approve a card, then find the Tomas Keller mismatch and
   **correct it inline** — your correction writes the database, marked
   *verified by owner*
4. **Run job scout** → real current openings at the network's companies,
   filtered to the profile's target roles
5. Pick a role → **Draft** → a warm intro grounded only on the stored
   relationship summary → promote it and walk the pipeline
   (outreach → referred → interview)

Sample data is flagged and isolated — one click clears it, and it can never
mix with a real import.

## If you do want to run it on real data

That's what the product is for — your own instance, your own Google Cloud
project, one deploy script (see README). Your export parses in your browser
and never uploads; the AI reads transient batches and stores none of it;
only the distilled contact table persists, in infrastructure only you
control.

*Fifteen people in this dataset. Zero of them real. The jobs, though, are
live — go check.*
