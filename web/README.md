# Knownworld dashboard (Next.js)

See the [root README](../README.md) for the product, quickstart, and
architecture. Local dev:

```
npm install
npm run dev -- -p 3040
```

Pairs with the agents service on :8787 (`agents/run-local.sh` starts it
with the FAKE model, so everything works offline). Tests: `npm test`.
Typecheck: `npx next typegen && npx tsc --noEmit`.
