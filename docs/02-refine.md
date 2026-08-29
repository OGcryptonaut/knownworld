# Step 2 · Refine with your own AI (guided copy-paste)

No API key needed. The app batches your chats and generates prompts; you paste them into the assistant you already use (Claude, ChatGPT, or a local model) and paste the reply back.

For each batch the app shows a prompt like:

```
You are cleaning a Telegram contact export. From the chats below, return ONLY
people I have a real relationship with who work in or around crypto/web3.
Judge by conversation depth, not politeness. Return strict JSON, an array of:
{
  "name": string,
  "tg_id": number,
  "company_definite": string|null,   // only if stated in the chats
  "company_inferred": string|null,   // your best inference; never copy into definite
  "role_guess": string|null,
  "why_relevant": string             // one line of evidence
}
Return [] if nobody qualifies. No prose, no markdown fences.
CHATS:
<batch>
```

Paste the reply into the app; it validates the JSON, rejects malformed rows with a reason, and loads the rest. Closeness is computed locally from message volume and recency — the AI never scores it. Definite vs inferred company stays visibly separate in the database forever.

Tips: batches of ~20 chats keep any assistant reliable; a full 5,000-chat account is typically 40–80 pastes over a coffee.

## Hackathon variant (governs the current build)
The copy-paste loop above is the future OSS mode. In this build the refine
agent does the pasting: the browser slices ~20-chat batches and streams them
to Gemini Flash with the same schema; batches are transient (nothing stored);
only distilled rows persist. Same output, zero manual work, runs in the
background with a progress bar and per-batch activity log.
