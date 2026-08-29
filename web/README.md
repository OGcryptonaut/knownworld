# Knownworld — dashboard (Next.js)

See the [root README](../README.md) for the product, quickstart, and
architecture. Local dev:

```
npm install
npm run dev -- -p 3040
```

Pairs with the agents service on :8080 (`FAKE_LLM=1` for offline dev).
Tests: `npm test` · typecheck: `npx next typegen && npx tsc --noEmit`.
