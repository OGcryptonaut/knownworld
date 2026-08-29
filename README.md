# Knownworld

**Turns your own Telegram DMs into a personal warm-network contact database — for networking and warm-path job discovery.**

Open source. Self-hosted. Your chats never leave your machine except the prompts you yourself paste into the AI assistant you already use.

## How it works
1. **Export** your Telegram data (Telegram Desktop only) — [guide](docs/01-export.md)
2. **Refine** it into a clean people database using your own Claude/ChatGPT via guided copy-paste — no API key needed — [guide](docs/02-refine.md)
3. **Enrich** lightly by web search: LinkedIn URL, location, current employer. No logins, no scraping, no emails — [guide](docs/03-enrich.md)
4. **Run the job search**: one click finds open roles at the companies where your people work, shows everyone you know there ranked by closeness, and drafts a warm message — [guide](docs/04-job-run.md)
5. **Track it** on a pipeline: outreach → referred → interview → offer

## Privacy model, stated plainly
- Steps 1–2: fully local + whatever you paste into your own assistant
- Step 3–4: names and company names are sent to search engines / public job feeds. Nothing else, ever
- No telemetry, no accounts, no cloud database, no bots

## Quickstart
```
git clone <repo>
cd knownworld && npm install && npm run dev
# open http://localhost:3000 and follow onboarding
```

## Status
Spec-complete, pre-build. See [SPEC.md](SPEC.md) and [docs/architecture.md](docs/architecture.md).

License: MIT (placeholder — final call pending)
