#!/usr/bin/env python3
"""Deterministic generator for the DEMO dataset: result.json (a byte-accurate
Telegram Desktop export) + demo-knowledge.json (the sidecar the FAKE agents
consult so the demo answers real questions without any model credentials).

THE PREMISE (openly fictional): "your" Telegram network is 15 famous tech
founders/billionaires. Every conversation here is INVENTED — none of these
people ever said any of this; the only real facts are their public company
affiliations, roles, and cities. Companies are real ON PURPOSE: 9 of them
have live, identity-verified public ATS feeds (data/ats-slugs.json), so the
job scout returns real current postings with warm paths through the demo
contacts — the product's core loop, demonstrable end-to-end with zero keys.

Regenerate anytime:  python3 sample-data/generate.py --now 2026-09-15T12:00:00
"""

from __future__ import annotations

import argparse
import json
import math
import random
from datetime import datetime, timedelta
from pathlib import Path

OWNER_ID = "user77000001"
OWNER_NAME = "Vlad"

ME, THEM = "me", "them"

# ---------------------------------------------------------------------------
# Filler pools — short exchanges; (who, text) with who in {ME, THEM}.
# Neutral professional small talk; real chats repeat themselves, so do these.
# ---------------------------------------------------------------------------

POOLS: dict[str, list[list[tuple[str, str]]]] = {
    "builder": [
        [(ME, "how's the week treating you"), (THEM, "shipping, meetings, repeat")],
        [(THEM, "ever feel like email is a full-time job"), (ME, "that's why we're here and not there")],
        [(ME, "conference season again"), (THEM, "i'm rationing my yes's this year")],
        [(THEM, "hiring is the whole job some weeks"), (ME, "the good weeks, honestly")],
        [(ME, "read anything good lately?"), (THEM, "mostly internal docs, sadly. one great biography though")],
        [(THEM, "gm"), (ME, "gm gm")],
        [(ME, "what's the biggest fire this week?"), (THEM, "if i tell you it stops being a metaphor")],
        [(THEM, "remind me the name of that espresso place you liked"), (ME, "sending the pin")],
        [(ME, "any advice for a busy quarter?"), (THEM, "fewer priorities, better ones")],
        [(THEM, "long day. worth it though"), (ME, "the best kind of tired")],
    ],
    "product": [
        [(ME, "launch went smoothly?"), (THEM, "smoother than the last one, that's the bar")],
        [(THEM, "we rewrote the onboarding again"), (ME, "third time's the charm?"), (THEM, "fifth. but who's counting")],
        [(ME, "how do you decide what NOT to build?"), (THEM, "painfully")],
        [(THEM, "demo day internally today"), (ME, "break a leg")],
        [(ME, "your latest release notes were a good read"), (THEM, "the team sweats those, i'll pass it on")],
        [(THEM, "roadmap review week"), (ME, "the hunger games of engineering")],
        [(ME, "users happy with the change?"), (THEM, "the loud ones aren't, the numbers are")],
    ],
    "markets": [
        [(ME, "wild market day huh"), (THEM, "i stopped watching the ticker years ago")],
        [(THEM, "rates chatter everywhere again"), (ME, "macro is everyone's hobby now")],
        [(ME, "earnings season — surviving?"), (THEM, "coffee is a food group this month")],
        [(THEM, "someone asked me for stock tips at dinner"), (ME, "the tax of the job")],
        [(ME, "long-term still the only game?"), (THEM, "the only one worth playing")],
    ],
    "frontier": [
        [(ME, "how fast is this AI wave really moving?"), (THEM, "faster than the last one, slower than twitter thinks")],
        [(THEM, "compute is the new oil, i keep saying it"), (ME, "and you keep being right, annoyingly")],
        [(ME, "hardware constraints easing at all?"), (THEM, "define easing")],
        [(THEM, "we ran an internal hackathon, the demos were unreal"), (ME, "the interns are coming for all of us")],
        [(ME, "regulation talk everywhere this month"), (THEM, "measured optimism, as always")],
    ],
    "personal": [
        [(ME, "padel saturday?"), (THEM, "if the schedule gods allow")],
        [(THEM, "kids talked me into a dog"), (ME, "the ceo of the household now")],
        [(ME, "you actually take vacations?"), (THEM, "i take airplanes with wifi")],
        [(THEM, "trying that sleep tracking thing"), (ME, "and? "), (THEM, "it confirms i don't sleep")],
        [(ME, "best burger in town, go"), (THEM, "strong opinions, DM only")],
    ],
}

# ---------------------------------------------------------------------------
# The roster — 15 public figures. Anchors are OPENLY fictional small talk;
# the factual part (company, role, city) is public knowledge and feeds the
# sidecar below. Nothing here puts real claims in real mouths.
# ---------------------------------------------------------------------------

PERSONAS: list[dict] = [
    {
        "tg_id": 100000001, "name": "Elon Musk", "pool": "frontier",
        "msgs": 420, "first_days": 900, "last_days": 1,
        "company": "SpaceX", "role": "Founder & CEO", "feed": True,
        "location": "Austin, Texas, US", "lat": 30.2672, "lng": -97.7431,
        "tags": ["aerospace", "defense", "AI", "manufacturing", "hardware"],
        "blurb": "Longest-running thread in the network; talks launch windows and factory floors.",
        "footprint": [
            "Founder & CEO of SpaceX; CEO of Tesla",
            "Co-founded PayPal, Neuralink, The Boring Company",
        ],
        "citations": [
            ("Wikipedia — Elon Musk", "https://en.wikipedia.org/wiki/Elon_Musk"),
            ("SpaceX", "https://www.spacex.com/"),
        ],
        "anchors": [
            (ME, "caught the launch stream — that landing never gets old"),
            (THEM, "sixth reuse on that booster. the team makes it look boring, which is the point"),
            (ME, "how's texas treating you?"),
            (THEM, "austin is home base now. factory, rockets, less rain than i'd like"),
            (ME, "if someone wanted to work on the ground systems side at SpaceX, where would they even start?"),
            (THEM, "careers page is real, we read everything. bias toward people who ship"),
            (THEM, "what are you building these days?"),
            (ME, "an agent that mines my own network for warm paths to work. you're in the test set, obviously"),
            (THEM, "ha. as long as it never sends anything on my behalf"),
            (ME, "hard rule of the product, actually"),
        ],
    },
    {
        "tg_id": 100000002, "name": "Sam Altman", "pool": "frontier",
        "msgs": 300, "first_days": 700, "last_days": 3,
        "company": "OpenAI", "role": "CEO", "feed": False,
        "location": "San Francisco, California, US", "lat": 37.7749, "lng": -122.4194,
        "tags": ["AI", "research", "startups", "investing"],
        "blurb": "AI-wave conversations; generous with startup advice.",
        "footprint": [
            "CEO of OpenAI",
            "Former president of Y Combinator",
        ],
        "citations": [
            ("Wikipedia — Sam Altman", "https://en.wikipedia.org/wiki/Sam_Altman"),
            ("OpenAI", "https://openai.com/"),
        ],
        "anchors": [
            (THEM, "how's the agent project coming?"),
            (ME, "distills a decade of chats into a contact graph, then answers questions over it"),
            (THEM, "the boring-sounding infra ones are usually the good ones"),
            (ME, "day job keeping you busy at OpenAI i assume"),
            (THEM, "every year i think it can't accelerate further. every year"),
            (ME, "SF for the fall or traveling?"),
            (THEM, "mostly SF, some DC. the usual circuit"),
        ],
    },
    {
        "tg_id": 100000003, "name": "Brian Armstrong", "pool": "markets",
        "msgs": 210, "first_days": 800, "last_days": 6,
        "company": "Coinbase", "role": "Co-founder & CEO", "feed": True,
        "location": "San Francisco, California, US", "lat": 37.7749, "lng": -122.4194,
        "tags": ["crypto", "exchanges", "payments", "fintech"],
        "blurb": "Crypto-rails talk; patient with regulation questions.",
        "footprint": [
            "Co-founder & CEO of Coinbase",
        ],
        "citations": [
            ("Wikipedia — Brian Armstrong", "https://en.wikipedia.org/wiki/Brian_Armstrong_(businessman)"),
            ("Coinbase", "https://www.coinbase.com/"),
        ],
        "anchors": [
            (ME, "the onchain payments thesis — still early or finally on time?"),
            (THEM, "finally on time. stablecoin volumes did the arguing for us"),
            (ME, "team growing on the institutional side at Coinbase?"),
            (THEM, "steadily. the careers page is honest about where"),
            (THEM, "your network-agent thing — does it do BD matching?"),
            (ME, "that's basically the core loop: contacts -> companies -> live openings -> warm path"),
            (THEM, "useful. cold outreach is dead anyway"),
        ],
    },
    {
        "tg_id": 100000004, "name": "Patrick Collison", "pool": "builder",
        "msgs": 260, "first_days": 850, "last_days": 10,
        "company": "Stripe", "role": "Co-founder & CEO", "feed": True,
        "location": "San Francisco, California, US", "lat": 37.7749, "lng": -122.4194,
        "tags": ["payments", "fintech", "infrastructure", "developer-tools"],
        "blurb": "Payments-infrastructure depth; sends reading lists unprompted.",
        "footprint": [
            "Co-founder & CEO of Stripe",
        ],
        "citations": [
            ("Wikipedia — Patrick Collison", "https://en.wikipedia.org/wiki/Patrick_Collison"),
            ("Stripe", "https://stripe.com/"),
        ],
        "anchors": [
            (THEM, "sent you three links about interchange economics, no context, enjoy"),
            (ME, "your reading lists are a public utility"),
            (ME, "how's Stripe's quarter?"),
            (THEM, "internet commerce keeps growing, so we keep building. boring and wonderful"),
            (ME, "any advice on hiring partnerships people?"),
            (THEM, "test for genuine curiosity about the counterparty's business. everything else is trainable"),
        ],
    },
    {
        "tg_id": 100000005, "name": "Brian Chesky", "pool": "product",
        "msgs": 150, "first_days": 600, "last_days": 15,
        "company": "Airbnb", "role": "Co-founder & CEO", "feed": True,
        "location": "San Francisco, California, US", "lat": 37.7749, "lng": -122.4194,
        "tags": ["travel", "marketplace", "design", "consumer"],
        "blurb": "Design-led product thinking; hotel-room sketches at 2am.",
        "footprint": [
            "Co-founder & CEO of Airbnb",
        ],
        "citations": [
            ("Wikipedia — Brian Chesky", "https://en.wikipedia.org/wiki/Brian_Chesky"),
            ("Airbnb", "https://www.airbnb.com/"),
        ],
        "anchors": [
            (THEM, "redesigning a flow tonight. hotel wifi, big dreams"),
            (ME, "the designer-CEO life never stops"),
            (ME, "is Airbnb hiring on the experiences side?"),
            (THEM, "we post what's real on the careers page — it moves with the roadmap"),
        ],
    },
    {
        "tg_id": 100000006, "name": "Ali Ghodsi", "pool": "frontier",
        "msgs": 120, "first_days": 500, "last_days": 20,
        "company": "Databricks", "role": "Co-founder & CEO", "feed": True,
        "location": "San Francisco, California, US", "lat": 37.7749, "lng": -122.4194,
        "tags": ["data", "AI", "enterprise", "infrastructure"],
        "blurb": "Data-platform pragmatist; explains lakehouses at dinner parties.",
        "footprint": [
            "Co-founder & CEO of Databricks",
            "Adjunct professor at UC Berkeley",
        ],
        "citations": [
            ("Wikipedia — Ali Ghodsi", "https://en.wikipedia.org/wiki/Ali_Ghodsi"),
            ("Databricks", "https://www.databricks.com/"),
        ],
        "anchors": [
            (ME, "every company i talk to is 'doing AI on their data' now"),
            (THEM, "and half of them are finally doing it properly. good decade to be Databricks"),
            (ME, "enterprise sales motions — art or science?"),
            (THEM, "science with good manners"),
        ],
    },
    {
        "tg_id": 100000007, "name": "Melanie Perkins", "pool": "product",
        "msgs": 90, "first_days": 550, "last_days": 45,
        "company": "Canva", "role": "Co-founder & CEO", "feed": False,
        "location": "Sydney, Australia", "lat": -33.8688, "lng": 151.2093,
        "tags": ["design", "consumer", "SaaS", "creator-economy"],
        "blurb": "Kindest ambition in tech; Sydney time zone gymnastics.",
        "footprint": [
            "Co-founder & CEO of Canva",
        ],
        "citations": [
            ("Wikipedia — Melanie Perkins", "https://en.wikipedia.org/wiki/Melanie_Perkins"),
            ("Canva", "https://www.canva.com/"),
        ],
        "anchors": [
            (THEM, "your morning is my midnight, replying anyway"),
            (ME, "sydney dedication. how's Canva's year?"),
            (THEM, "more teams design now than ever. the mission compounds"),
        ],
    },
    {
        "tg_id": 100000008, "name": "Alex Karp", "pool": "builder",
        "msgs": 160, "first_days": 650, "last_days": 12,
        "company": "Palantir", "role": "Co-founder & CEO", "feed": True,
        "location": "Denver, Colorado, US", "lat": 39.7392, "lng": -104.9903,
        "tags": ["defense", "enterprise", "data", "government"],
        "blurb": "Contrarian essays in chat form; cross-country ski updates.",
        "footprint": [
            "Co-founder & CEO of Palantir Technologies",
        ],
        "citations": [
            ("Wikipedia — Alex Karp", "https://en.wikipedia.org/wiki/Alex_Karp"),
            ("Palantir", "https://www.palantir.com/"),
        ],
        "anchors": [
            (THEM, "wrote 2000 words on software and statecraft before breakfast"),
            (ME, "your chats read like op-eds and i'm here for it"),
            (ME, "Palantir still hiring forward-deployed folks?"),
            (THEM, "the field teams are the company. postings say what's true"),
        ],
    },
    {
        "tg_id": 100000009, "name": "Palmer Luckey", "pool": "frontier",
        "msgs": 110, "first_days": 480, "last_days": 25,
        "company": "Anduril Industries", "role": "Founder", "feed": True,
        "location": "Costa Mesa, California, US", "lat": 33.6411, "lng": -117.9187,
        "tags": ["defense", "hardware", "robotics", "aerospace"],
        "blurb": "Hardware maximalist; explains autonomy stacks with props.",
        "footprint": [
            "Founder of Anduril Industries",
            "Founded Oculus VR",
        ],
        "citations": [
            ("Wikipedia — Palmer Luckey", "https://en.wikipedia.org/wiki/Palmer_Luckey"),
            ("Anduril", "https://www.anduril.com/"),
        ],
        "anchors": [
            (THEM, "built a thing this weekend. can't say what. it flies"),
            (ME, "your weekends stress me out"),
            (ME, "Anduril's growth looks vertical from outside"),
            (THEM, "defense tech stopped being a niche. we're hiring across the board"),
        ],
    },
    {
        "tg_id": 100000010, "name": "Dylan Field", "pool": "product",
        "msgs": 75, "first_days": 400, "last_days": 30,
        "company": "Figma", "role": "Co-founder & CEO", "feed": True,
        "location": "San Francisco, California, US", "lat": 37.7749, "lng": -122.4194,
        "tags": ["design", "collaboration", "SaaS", "developer-tools"],
        "blurb": "Multiplayer-everything believer; config talk turns philosophical.",
        "footprint": [
            "Co-founder & CEO of Figma",
        ],
        "citations": [
            ("Wikipedia — Dylan Field", "https://en.wikipedia.org/wiki/Dylan_Field"),
            ("Figma", "https://www.figma.com/"),
        ],
        "anchors": [
            (ME, "our whole team lives in Figma, thought you should know"),
            (THEM, "that's the dream, tell them thanks"),
            (ME, "what's next after design tools?"),
            (THEM, "wherever teams think together. vague on purpose"),
        ],
    },
    {
        "tg_id": 100000011, "name": "Tobi Lütke", "pool": "builder",
        "msgs": 100, "first_days": 700, "last_days": 60,
        "company": "Shopify", "role": "Co-founder & CEO", "feed": False,
        "location": "Ottawa, Canada", "lat": 45.4215, "lng": -75.6972,
        "tags": ["commerce", "SaaS", "engineering-culture"],
        "blurb": "Engineering-culture koans; occasionally reviews your code taste.",
        "footprint": [
            "Co-founder & CEO of Shopify",
        ],
        "citations": [
            ("Wikipedia — Tobias Lütke", "https://en.wikipedia.org/wiki/Tobias_L%C3%BCtke"),
            ("Shopify", "https://www.shopify.com/"),
        ],
        "anchors": [
            (THEM, "opinion: most dashboards are apologies for bad defaults"),
            (ME, "putting that on a poster"),
            (ME, "how's Shopify's dev culture holding at scale?"),
            (THEM, "we prune process like a bonsai. constantly, gently"),
        ],
    },
    {
        "tg_id": 100000012, "name": "Daniel Ek", "pool": "product",
        "msgs": 60, "first_days": 500, "last_days": 90,
        "company": "Spotify", "role": "Founder & Executive Chairman", "feed": True,
        "location": "Stockholm, Sweden", "lat": 59.3293, "lng": 18.0686,
        "tags": ["consumer", "audio", "media", "deep-tech"],
        "blurb": "Audio-first worldview; Stockholm calm about everything.",
        "footprint": [
            "Co-founder & CEO of Spotify",
        ],
        "citations": [
            ("Wikipedia — Daniel Ek", "https://en.wikipedia.org/wiki/Daniel_Ek"),
            ("Spotify", "https://www.spotify.com/"),
        ],
        "anchors": [
            (ME, "my year in audio was 80% podcasts, is that normal now"),
            (THEM, "normal and growing. spoken word ate the commute"),
            (ME, "Spotify hiring in Europe much?"),
            (THEM, "stockholm and beyond — the postings are current"),
        ],
    },
    {
        "tg_id": 100000013, "name": "Jensen Huang", "pool": "frontier",
        "msgs": 45, "first_days": 350, "last_days": 40,
        "company": "Nvidia", "role": "Founder & CEO", "feed": False,
        "location": "Santa Clara, California, US", "lat": 37.3541, "lng": -121.9552,
        "tags": ["semiconductors", "AI", "hardware", "compute"],
        "blurb": "Leather-jacket energy even in text; everything is about compute.",
        "footprint": [
            "Founder & CEO of Nvidia",
        ],
        "citations": [
            ("Wikipedia — Jensen Huang", "https://en.wikipedia.org/wiki/Jensen_Huang"),
            ("Nvidia", "https://www.nvidia.com/"),
        ],
        "anchors": [
            (THEM, "the more you buy, the more you save"),
            (ME, "you can't just say that in a private chat too"),
            (ME, "is the compute crunch real from where you sit at Nvidia?"),
            (THEM, "demand is a privilege. we build accordingly"),
        ],
    },
    {
        "tg_id": 100000014, "name": "Warren Buffett", "pool": "markets",
        "msgs": 25, "first_days": 400, "last_days": 150,
        "company": "Berkshire Hathaway", "role": "Chairman", "feed": False,
        "location": "Omaha, Nebraska, US", "lat": 41.2565, "lng": -95.9345,
        "tags": ["investing", "insurance", "value", "long-term"],
        "blurb": "Rare replies, each worth framing; cherry coke emoji once.",
        "footprint": [
            "Chairman of Berkshire Hathaway",
        ],
        "citations": [
            ("Wikipedia — Warren Buffett", "https://en.wikipedia.org/wiki/Warren_Buffett"),
            ("Berkshire Hathaway", "https://www.berkshirehathaway.com/"),
        ],
        "anchors": [
            (ME, "one question: what would you tell a builder picking between two good options?"),
            (THEM, "pick the one you'd be happy explaining in ten years"),
            (ME, "that's going in the company handbook"),
        ],
    },
    {
        "tg_id": 100000015, "name": "Mark Zuckerberg", "pool": "frontier",
        "msgs": 35, "first_days": 600, "last_days": 200,
        "company": "Meta", "role": "Founder & CEO", "feed": False,
        "location": "Palo Alto, California, US", "lat": 37.4419, "lng": -122.1430,
        "tags": ["social", "AI", "VR", "consumer"],
        "blurb": "Quiet thread; resurfaces around big launches and BJJ.",
        "footprint": [
            "Founder & CEO of Meta",
        ],
        "citations": [
            ("Wikipedia — Mark Zuckerberg", "https://en.wikipedia.org/wiki/Mark_Zuckerberg"),
            ("Meta", "https://www.meta.com/"),
        ],
        "anchors": [
            (THEM, "training camp week. texting between rounds"),
            (ME, "the only CEO with a submission game"),
            (ME, "how's the open-model strategy playing out at Meta?"),
            (THEM, "the ecosystem answers that better than i can"),
        ],
    },
]

# ---------------------------------------------------------------------------
# RICH sidecar layer (v2 feedback): real LinkedIn URLs (live-verified via web
# search 2026-08-30; null where the person famously has no public LinkedIn),
# current focus, how-they-can-help, work history, and chat-derived insights.
# History entries are public knowledge; chat_insights come from OUR (openly
# fictional) threads above.
# ---------------------------------------------------------------------------

RICH: dict[int, dict] = {
    100000001: {  # Elon Musk — no LinkedIn (famously); real X profile instead
        "linkedin": None,
        "links": [("X (Twitter)", "https://x.com/elonmusk")],
        "now": "Running SpaceX (Starship program, Starlink) and Tesla; xAI and Neuralink in parallel.",
        "useful": "Direct line into SpaceX hiring and the hard-tech/defense ecosystem; strongest warm path in your network (closeness 98).",
        "history": [
            "2002— SpaceX — Founder & CEO",
            "2008— Tesla — CEO",
            "2023— xAI — Founder",
            "1999-2002 — PayPal (X.com) — Co-founder",
        ],
        "chat_insights": "Recommended applying via the SpaceX careers page — 'we read everything, bias toward people who ship'. Knows about your agent project; firm that it must never send messages for him.",
    },
    100000002: {  # Sam Altman — no active public LinkedIn; real blog + X
        "linkedin": None,
        "links": [("X (Twitter)", "https://x.com/sama"), ("Blog", "https://blog.samaltman.com/")],
        "now": "CEO of OpenAI; frequent AI-policy conversations in SF and DC.",
        "useful": "Startup advice and AI-ecosystem introductions; asked about your agent project unprompted.",
        "history": [
            "2019— OpenAI — CEO",
            "2014-2019 — Y Combinator — President",
            "2005-2012 — Loopt — Co-founder & CEO",
        ],
        "chat_insights": "Called infra-flavored agent products 'usually the good ones' — a warm opener for a deeper product conversation.",
    },
    100000003: {
        "linkedin": "https://www.linkedin.com/in/barmstrong/",
        "links": [],
        "now": "CEO of Coinbase; pushing onchain payments and stablecoin rails.",
        "useful": "Institutional-crypto hiring intel; pointed you at Coinbase's careers page for the institutional side.",
        "history": [
            "2012— Coinbase — Co-founder & CEO",
            "2011-2012 — Airbnb — Software Engineer",
            "IBM / Deloitte — earlier engineering roles",
        ],
        "chat_insights": "Said the institutional team is growing 'steadily' and the careers page reflects it; interested in your BD-matching loop — 'cold outreach is dead anyway'.",
    },
    100000004: {
        "linkedin": "https://www.linkedin.com/in/patrickcollison/",
        "links": [],
        "now": "CEO of Stripe; internet-commerce infrastructure at global scale.",
        "useful": "Hiring philosophy for partnerships roles ('test for genuine curiosity'); payments-infra introductions.",
        "history": [
            "2010— Stripe — Co-founder & CEO",
            "2007-2008 — Auctomatic — Co-founder (acquired)",
        ],
        "chat_insights": "Gave you a concrete partnerships-hiring heuristic; sends unprompted reading lists — an easy relationship to warm up anytime.",
    },
    100000005: {
        "linkedin": "https://www.linkedin.com/in/brianchesky",
        "links": [],
        "now": "CEO of Airbnb; design-led product expansion beyond stays.",
        "useful": "Product-design leadership perspective; confirmed Airbnb posts what's real on the careers page.",
        "history": [
            "2008— Airbnb — Co-founder & CEO",
            "RISD — Industrial design background",
        ],
        "chat_insights": "Mentioned the experiences side moves with the roadmap — watch their board around launches.",
    },
    100000006: {
        "linkedin": "https://www.linkedin.com/in/alighodsi/",
        "links": [],
        "now": "CEO of Databricks; enterprise data+AI platform growth.",
        "useful": "Enterprise GTM wisdom ('science with good manners'); data/AI hiring ecosystem.",
        "history": [
            "2013— Databricks — Co-founder & CEO (CEO since 2016)",
            "UC Berkeley — Adjunct professor; Apache Spark co-creator circle",
        ],
        "chat_insights": "Bullish on 'AI on your data' era — a natural angle for a partnerships conversation.",
    },
    100000007: {
        "linkedin": "https://au.linkedin.com/in/melanieperkins",
        "links": [],
        "now": "CEO of Canva; global design platform, profitable and mission-driven.",
        "useful": "Founder-to-founder advice on patient ambition; APAC network reach.",
        "history": [
            "2013— Canva — Co-founder & CEO",
            "2007-2012 — Fusion Books — Co-founder",
        ],
        "chat_insights": "Replies across time zones — a reliably responsive thread despite distance.",
    },
    100000008: {  # Alex Karp — no public LinkedIn
        "linkedin": None,
        "links": [("Palantir leadership", "https://www.palantir.com/about/")],
        "now": "CEO of Palantir; forward-deployed software for defense and industry.",
        "useful": "Defense-tech worldview; confirmed field teams keep hiring ('the field teams are the company').",
        "history": [
            "2003— Palantir Technologies — Co-founder & CEO",
            "PhD — Goethe University Frankfurt (neoclassical social theory)",
        ],
        "chat_insights": "His 'postings say what's true' line — check the Palantir board for forward-deployed roles directly.",
    },
    100000009: {
        "linkedin": "https://www.linkedin.com/in/palmer-luckey-21a16959/",
        "links": [],
        "now": "Founder of Anduril; autonomous defense systems scaling fast.",
        "useful": "Defense/hardware hiring is 'across the board' per him — one of the widest boards in your network (2,000+ postings).",
        "history": [
            "2017— Anduril Industries — Founder",
            "2012-2017 — Oculus VR — Founder (acquired by Facebook)",
        ],
        "chat_insights": "Explicitly said they're hiring across the board — the strongest direct hiring signal in your chats.",
    },
    100000010: {
        "linkedin": "https://www.linkedin.com/in/dylanfield/",
        "links": [],
        "now": "CEO of Figma; collaborative design platform post-IPO era.",
        "useful": "Design-tools ecosystem; your team already uses Figma daily — a genuine user story to open with.",
        "history": [
            "2012— Figma — Co-founder & CEO",
            "Thiel Fellowship — dropped out of Brown to start Figma",
        ],
        "chat_insights": "Appreciated hearing your team lives in Figma — user-story goodwill already banked.",
    },
    100000011: {
        "linkedin": "https://ca.linkedin.com/in/tobiaslutke",
        "links": [],
        "now": "CEO of Shopify; commerce platform with an AI-first internal culture.",
        "useful": "Engineering-culture benchmarks; blunt product feedback if you dare ask.",
        "history": [
            "2006— Shopify — Co-founder & CEO",
            "Ruby on Rails — core team; Active Merchant, Liquid author",
        ],
        "chat_insights": "Enjoys aphorisms about defaults and dashboards — sharp, honest product feedback available on request.",
    },
    100000012: {
        "linkedin": "https://se.linkedin.com/in/daniel-ek-1b52093a",
        "links": [],
        "now": "Executive Chairman of Spotify; Chairman of Helsing (defense AI) and Neko Health; runs Prima Materia.",
        "useful": "European deep-tech and defense-AI network (Helsing); Stockholm hub; Spotify's board is active in Europe.",
        "history": [
            "2025— Spotify — Founder & Executive Chairman (CEO 2006-2025)",
            "2021— Helsing — Chairman & co-investor",
            "2023— Neko Health — Co-founder",
            "2020— Prima Materia — Co-founder",
        ],
        "chat_insights": "Confirmed Stockholm hiring is real; his move to Chairman means intros now route through his ventures too.",
    },
    100000013: {
        "linkedin": "https://www.linkedin.com/in/jenhsunhuang/",
        "links": [],
        "now": "CEO of Nvidia; the compute backbone of the AI wave.",
        "useful": "Semiconductor/AI-infrastructure perspective; 'demand is a privilege' — reads the compute market like nobody else.",
        "history": [
            "1993— Nvidia — Founder & CEO",
            "AMD / LSI Logic — earlier engineering roles",
        ],
        "chat_insights": "Light-hearted thread but responsive on compute-market questions.",
    },
    100000014: {  # Warren Buffett — no LinkedIn
        "linkedin": None,
        "links": [("Berkshire Hathaway", "https://www.berkshirehathaway.com/")],
        "now": "Chairman of Berkshire Hathaway; long-horizon capital allocation.",
        "useful": "One-line wisdom on big decisions — rare but framable replies.",
        "history": [
            "1965— Berkshire Hathaway — Chairman & CEO (CEO transition announced 2025)",
            "Buffett Partnership Ltd. — 1956-1969",
        ],
        "chat_insights": "His ten-year explainability test is already in your decision toolkit.",
    },
    100000015: {  # Mark Zuckerberg — no LinkedIn
        "linkedin": None,
        "links": [("Meta profile", "https://www.facebook.com/zuck")],
        "now": "CEO of Meta; open-weight AI models, smart glasses, and the long metaverse bet.",
        "useful": "Open-model ecosystem perspective; a dormant thread worth reviving around launches.",
        "history": [
            "2004— Meta (Facebook) — Founder & CEO",
        ],
        "chat_insights": "Thread goes quiet for months — time follow-ups to big Meta launches.",
    },
}

GROUP_LINES = [
    "who's going to the summit next month?",
    "in 🙋", "only if the panels are good", "same hotel as last year?",
    "someone book the big table", "sharing my notes from today, solid talks",
    "next one should be on hard tech imo", "+1",
    "the hallway track is the real conference", "who had the demo with the robot dog?",
]

SAVED_NOTES = [
    "intro template v2: shorter, one ask, no buzzwords",
    "warm paths beat cold apps 10:1 — the whole thesis",
    "companies to watch: launch systems, payments infra, data platforms",
    "book flights before prices jump",
    "gym: deload week next week",
    "draft: why your network is the best job board",
    "renew passport in september",
]


def fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def make_message(msg_id: int, dt: datetime, from_name: str | None, from_id: str, text: str) -> dict:
    return {
        "id": msg_id,
        "type": "message",
        "date": fmt(dt),
        "date_unixtime": str(int(dt.timestamp())),
        "from": from_name,
        "from_id": from_id,
        "text": text,
        "text_entities": [{"type": "plain", "text": text}],
    }


def timestamps(rng: random.Random, n: int, first: datetime, last: datetime) -> list[datetime]:
    """n timestamps in bursts ('sessions') between first and last; final one
    lands exactly on last."""
    if n == 1:
        return [last]
    sessions: list[int] = []
    remaining = n - 1
    while remaining > 0:
        size = min(remaining, rng.randint(2, 12))
        sessions.append(size)
        remaining -= size
    span = (last - timedelta(hours=3)) - first
    starts = sorted(first + span * rng.random() for _ in sessions)
    out: list[datetime] = []
    for start, size in zip(starts, sessions):
        t = start
        for _ in range(size):
            out.append(t)
            t += timedelta(seconds=rng.randint(40, 900))
    out.sort()
    out.append(last)
    return out[:n]


def build_personal_chat(persona: dict, rng: random.Random, now: datetime) -> dict:
    n = persona["msgs"]
    first = now - timedelta(days=persona["first_days"], hours=rng.randint(0, 9))
    last = now - timedelta(days=persona["last_days"], minutes=rng.randint(10, 500))
    anchors: list[tuple[str, str]] = list(persona["anchors"])
    pool = POOLS[persona["pool"]]

    positions = sorted(
        min(n - 1, max(0, int((i + 0.5) * n / len(anchors)) + rng.randint(-3, 3)))
        for i in range(len(anchors))
    )
    seq: list[tuple[str, str]] = []
    ai = 0
    buffer: list[tuple[str, str]] = []
    while len(seq) < n:
        if ai < len(anchors) and len(seq) >= positions[ai]:
            seq.append(anchors[ai])
            ai += 1
            continue
        if not buffer:
            buffer = list(rng.choice(pool))
        seq.append(buffer.pop(0))
    while ai < len(anchors):  # anchors must never be dropped
        seq.append(anchors[ai])
        ai += 1

    times = timestamps(rng, len(seq), first, last)
    peer_id = f"user{persona['tg_id']}"
    base_id = rng.randint(10_000, 900_000)
    messages = []
    for i, ((who, text), dt) in enumerate(zip(seq, times)):
        if who == ME:
            messages.append(make_message(base_id + i, dt, OWNER_NAME, OWNER_ID, text))
        else:
            messages.append(make_message(base_id + i, dt, persona["name"], peer_id, text))
    return {
        "name": persona["name"],
        "type": "personal_chat",
        "id": persona["tg_id"],
        "messages": messages,
    }


def build_saved_messages(rng: random.Random, now: datetime) -> dict:
    times = timestamps(rng, len(SAVED_NOTES), now - timedelta(days=400), now - timedelta(days=3))
    messages = [
        make_message(1000 + i, dt, OWNER_NAME, OWNER_ID, text)
        for i, (text, dt) in enumerate(zip(SAVED_NOTES, times))
    ]
    return {"name": None, "type": "saved_messages", "id": 77000001, "messages": messages}


def build_group(rng: random.Random, now: datetime) -> dict:
    members = [(f"user{p['tg_id']}", p["name"]) for p in PERSONAS[:5]] + [(OWNER_ID, OWNER_NAME)]
    times = timestamps(rng, 90, now - timedelta(days=500), now - timedelta(days=5))
    messages = []
    for i, dt in enumerate(times):
        from_id, from_name = rng.choice(members)
        messages.append(make_message(5000 + i, dt, from_name, from_id, rng.choice(GROUP_LINES)))
    return {"name": "Founders padel club 🎾", "type": "private_supergroup", "id": 1456789012, "messages": messages}


def build_bot_chat(rng: random.Random, now: datetime) -> dict:
    times = timestamps(rng, 30, now - timedelta(days=200), now - timedelta(days=9))
    messages = []
    for i, dt in enumerate(times):
        if i % 6 == 0:
            messages.append(make_message(8000 + i, dt, OWNER_NAME, OWNER_ID, "/rates"))
        else:
            messages.append(
                make_message(8000 + i, dt, "Rate Alert Bot", "user6100000001",
                             f"BTC/USD crossed {rng.randint(60, 140)}k threshold you set")
            )
    return {"name": "Rate Alert Bot", "type": "bot_chat", "id": 6100000001, "messages": messages}


def closeness(msg_count: int, last_iso: str, now: datetime) -> int:
    """Mirror of web/src/lib/closeness.ts — for the summary printout only."""
    volume = min(1.0, math.log10(1 + msg_count) / math.log10(501))
    days = max(0.0, (now - datetime.fromisoformat(last_iso)).total_seconds() / 86_400)
    return round(100 * (0.6 * volume + 0.4 * math.exp(-days / 180)))


def build_knowledge() -> dict:
    """The sidecar the FAKE agents consult (keyed by tg_id AND by name):
    real public facts only — company, role, city, coords, footprint,
    citations, tags. Fictional conversations; factual affiliations."""
    people = {}
    for p in PERSONAS:
        rich = RICH.get(p["tg_id"], {})
        extra_links = [{"title": t, "url": u} for t, u in rich.get("links", [])]
        people[str(p["tg_id"])] = {
            "name": p["name"],
            "company": p["company"],
            "role": p["role"],
            "location": p["location"],
            "lat": p["lat"],
            "lng": p["lng"],
            "tags": p["tags"],
            "blurb": p["blurb"],
            "has_verified_feed": p["feed"],
            "footprint": p["footprint"],
            "citations": [{"title": t, "url": u} for t, u in p["citations"]] + extra_links,
            "linkedin_url": rich.get("linkedin"),
            "current_focus": rich.get("now"),
            "how_useful": rich.get("useful"),
            "history": rich.get("history", []),
            "chat_insights": rich.get("chat_insights"),
        }
    return {
        "_note": (
            "Demo sidecar for FAKE mode: openly fictional conversations with "
            "real public figures; ONLY the public facts here (company, role, "
            "city) are real. Never shipped to any model — consumed by the "
            "deterministic FAKE agents so the demo answers real questions "
            "with zero credentials."
        ),
        "people": people,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--now", default="2026-08-29T18:00:00",
                        help="anchor 'now' (ISO, no tz); recency decays from here")
    parser.add_argument("--out", default=str(Path(__file__).parent / "result.json"))
    args = parser.parse_args()
    now = datetime.fromisoformat(args.now)
    rng = random.Random(42)

    chats = [build_saved_messages(rng, now)]
    chats += [build_personal_chat(p, rng, now) for p in PERSONAS]
    chats.append(build_group(rng, now))
    chats.append(build_bot_chat(rng, now))

    export = {
        "about": (
            "DEMO dataset — openly fictional conversations with real public "
            "figures (nothing here was actually said by them; company "
            "affiliations are public knowledge). Generated by "
            "sample-data/generate.py for product demonstration only."
        ),
        "chats": {"about": "This page lists all your chats.", "list": chats},
    }
    out_path = Path(args.out)
    out_path.write_text(json.dumps(export, ensure_ascii=False, indent=1), encoding="utf-8")

    knowledge_path = out_path.parent / "demo-knowledge.json"
    knowledge_path.write_text(
        json.dumps(build_knowledge(), ensure_ascii=False, indent=1), encoding="utf-8"
    )

    total = sum(len(c["messages"]) for c in chats)
    print(f"wrote {out_path} — {len(chats)} chats, {total} messages")
    print(f"wrote {knowledge_path} — {len(PERSONAS)} people")
    print(f"{'name':<20} {'company':<20} {'msgs':>5} {'last':>12} {'closeness':>9} {'feed':>5}")
    for p in PERSONAS:
        chat = next(c for c in chats if c["id"] == p["tg_id"])
        print(f"{p['name']:<20} {p['company']:<20} {len(chat['messages']):>5} "
              f"{chat['messages'][-1]['date'][:10]:>12} "
              f"{closeness(len(chat['messages']), chat['messages'][-1]['date'], now):>9} "
              f"{'yes' if p['feed'] else '—':>5}")


if __name__ == "__main__":
    main()
