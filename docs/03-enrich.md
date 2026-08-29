# Step 3 · Light enrichment (web search only)

For each refined person, the app runs plain web searches to find three things:
LinkedIn profile URL (the link only — the app never opens LinkedIn logged-in),
location, current employer.

Rules baked in: no LinkedIn login, no session cookies, no scraping vendors,
no emails — you reach these people on Telegram, where you already talk.
People who don't resolve get an `unverified` badge instead of guessed data.

What leaves your machine in this step: the person's name + company hint, as a
search query. Nothing else.
