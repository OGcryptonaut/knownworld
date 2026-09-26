#!/usr/bin/env python3
"""Deterministic generator for the DEMO dataset: result.json (a byte-accurate
Telegram Desktop export), demo-knowledge.json (the sidecar the offline agents
consult) and expected-people.json (the golden reference for a refine pass).

THE PREMISE (wholly fictional people, real companies as public facts):
"your" Telegram network is 17 invented crypto/web3 professionals. Every
person here is made up — the names were web-checked against notable people
at the same companies and none exist. Every message is invented. The ONLY
real things are the companies they are placed at (public companies, used
only as public facts) — real on purpose, because most of them publish a
live, identity-verified ATS feed (data/ats-slugs.json), so the job scout
returns real current postings with a warm path through a demo contact: the
product's core loop, demonstrable end-to-end with zero credentials.

What the roster exercises on purpose:
- closeness bands (web/src/lib/closeness.ts, computed in code): C1 90+
  (300-450 msgs, last <= 3 days), C2 70-89, C3 50-69, C4 < 50 (quiet for
  months);
- 4 contacts who only HINT at their employer (company_inferred, never
  company_definite) and one thread that is ~90% life chat;
- two DIFFERENT people who share a name at different companies — public
  research resolves the quieter one to his prominent namesake, which is
  exactly the `possible_mismatch` verdict the product must surface;
- two handle-only contacts (Telegram name null): one whose public footprint
  resolves to a name (resolved_name auto-applies to blank rows only), one
  that stays honestly `unverified`;
- one founder at a fictional startup with no job feed at all.

Regenerate anytime (deterministic, seed 42):
    python3 sample-data/generate.py --now 2026-09-26T12:00:00
    cp sample-data/result.json web/public/demo-corpus.json
"""

from __future__ import annotations

import argparse
import json
import math
import random
from datetime import timezone, datetime, timedelta
from pathlib import Path

OWNER_ID = "user77000001"
OWNER_NAME = "Vlad"

ME, THEM = "me", "them"

# Reserved tg_id block for demo personas — MUST stay inside
# agents/app/demo_knowledge.DEMO_TG_ID_RANGE, the guard that keeps the
# demo-sidecar research path from ever touching a real tenant's contacts.
DEMO_TG_ID_BASE = 100000000

# ---------------------------------------------------------------------------
# Filler pools — short exchanges; (who, text) with who in {ME, THEM}. Neutral
# small talk of the crypto/web3 crowd; real chats repeat themselves, so do
# these. NO company names anywhere in the pools — the employer-mention rule
# (definite vs hinted) is decided by the anchors alone.
# ---------------------------------------------------------------------------

POOLS: dict[str, list[list[tuple[str, str]]]] = {
    "builder": [
        [(ME, "how's the week treating you"), (THEM, "shipping, standups, repeat")],
        [(THEM, "gm"), (ME, "gm gm")],
        [(ME, "conference season again"), (THEM, "i'm rationing my yes's this year")],
        [(THEM, "hiring is the whole job some weeks"), (ME, "the good weeks, honestly")],
        [(ME, "read anything good lately?"), (THEM, "mostly audit reports, sadly. one great essay on incentives though")],
        [(ME, "what's the biggest fire this week?"), (THEM, "if i tell you it stops being a metaphor")],
        [(THEM, "remind me the name of that espresso place you liked"), (ME, "sending the pin")],
        [(ME, "any advice for a busy quarter?"), (THEM, "fewer priorities, better ones")],
        [(THEM, "long day. worth it though"), (ME, "the best kind of tired")],
        [(THEM, "the testnet is finally green"), (ME, "green is a lifestyle")],
        [(ME, "still doing the friday demo ritual?"), (THEM, "religiously. it's the only meeting people like")],
    ],
    "product": [
        [(ME, "launch went smoothly?"), (THEM, "smoother than the last one, that's the bar")],
        [(THEM, "we rewrote onboarding again"), (ME, "third time's the charm?"), (THEM, "fifth. but who's counting")],
        [(ME, "how do you decide what NOT to build?"), (THEM, "painfully")],
        [(THEM, "internal demo day today"), (ME, "break a leg")],
        [(ME, "your release notes were a good read"), (THEM, "the team sweats those, i'll pass it on")],
        [(THEM, "roadmap review week"), (ME, "the hunger games of engineering")],
        [(ME, "users happy with the change?"), (THEM, "the loud ones aren't, the numbers are")],
        [(THEM, "wallet connect flow is 2 taps shorter now"), (ME, "two taps is a whole quarter of work, i know")],
        [(ME, "design crit went ok?"), (THEM, "brutal and correct, the best kind")],
    ],
    "defi": [
        [(ME, "wild market day huh"), (THEM, "i stopped watching the ticker years ago")],
        [(THEM, "rates chatter everywhere again"), (ME, "macro is everyone's hobby now")],
        [(ME, "gas is cheap tonight, deploy something"), (THEM, "tempting. sleep is also cheap tonight")],
        [(THEM, "someone asked me for token tips at dinner"), (ME, "the tax of the job")],
        [(ME, "long-term still the only game?"), (THEM, "the only one worth playing")],
        [(THEM, "airdrop farmers found our test faucet"), (ME, "you're famous now")],
        [(ME, "how's the audit going?"), (THEM, "three findings, none scary, one embarrassing")],
        [(THEM, "liquidity is a mood"), (ME, "putting that on a mug")],
    ],
    "infra": [
        [(ME, "how fast is the agent wave really moving?"), (THEM, "faster than the last one, slower than the timeline thinks")],
        [(THEM, "rpc latency is the new oil, i keep saying it"), (ME, "and you keep being right, annoyingly")],
        [(ME, "node costs easing at all?"), (THEM, "define easing")],
        [(THEM, "we ran an internal hackathon, the demos were unreal"), (ME, "the interns are coming for all of us")],
        [(ME, "regulation talk everywhere this month"), (THEM, "measured optimism, as always")],
        [(THEM, "pager was quiet all weekend"), (ME, "don't say it out loud")],
        [(ME, "kubernetes or bare metal for the indexer?"), (THEM, "yes")],
        [(THEM, "migrated the last service off the old chain client"), (ME, "pour one out")],
    ],
    "personal": [
        [(ME, "padel saturday?"), (THEM, "if the schedule gods allow")],
        [(THEM, "kids talked me into a dog"), (ME, "the ceo of the household now")],
        [(ME, "you actually take vacations?"), (THEM, "i take airplanes with wifi")],
        [(THEM, "trying that sleep tracking thing"), (ME, "and?"), (THEM, "it confirms i don't sleep")],
        [(ME, "best pastel de nata in town, go"), (THEM, "strong opinions, DM only")],
        [(THEM, "long weekend, phone off"), (ME, "proud of you")],
    ],
    "life": [
        [(ME, "surf tomorrow 7am?"), (THEM, "7:30 and i bring the coffee")],
        [(THEM, "waves were tiny, vibes were huge"), (ME, "the correct ratio")],
        [(ME, "padel thursday, we need a fourth"), (THEM, "i'll drag my cousin")],
        [(THEM, "found a new tasca near the river, the octopus is unreal"), (ME, "booking us in")],
        [(ME, "you watched the match?"), (THEM, "watched. suffered. repeat")],
        [(THEM, "birthday dinner saturday, no gifts, bring wine"), (ME, "gift is wine then")],
        [(ME, "how's the knee?"), (THEM, "physio says padel is off for two weeks. physio is wrong")],
        [(THEM, "sunset at the miradouro, come"), (ME, "20 min")],
        [(ME, "your playlist from the road trip, send it"), (THEM, "sent. skip track 4, it was a phase")],
        [(THEM, "we should do the algarve weekend again"), (ME, "before the tourists, so, never")],
        [(ME, "coffee later?"), (THEM, "3pm, usual place")],
        [(THEM, "dog ate my charging cable"), (ME, "the dog has taste")],
        [(ME, "how was the wedding?"), (THEM, "danced until the DJ gave up")],
        [(THEM, "running the half in october, join?"), (ME, "cheering section, firmly")],
        [(ME, "movie night friday?"), (THEM, "only if i pick. last time was a war crime")],
    ],
}

# ---------------------------------------------------------------------------
# The roster — 17 invented people. `mention` decides whether the anchors NAME
# the employer ('definite') or only hint at it ('inferred'); expected-people
# and the sidecar both derive from it. `msgs` / `first_days` / `last_days`
# place each thread in a closeness band. Everything below is fiction.
# ---------------------------------------------------------------------------

PERSONAS: list[dict] = [
    {
        "tg_id": DEMO_TG_ID_BASE + 1, "name": "Priya Raghunathan", "pool": "product",
        "msgs": 420, "first_days": 900, "last_days": 1,
        "company": "Coinbase", "role": "Product Manager", "mention": "definite", "feed": True,
        "location": "San Francisco, California, US", "lat": 37.7749, "lng": -122.4194,
        "tags": ["product", "exchanges", "payments", "crypto"],
        "blurb": "Longest-running thread in the network; onchain payments product talk and launch-week venting.",
        "footprint": ["Product Manager, Coinbase (payments)"],
        "now": "Runs the onchain payments product line at Coinbase; shipping merchant checkout this quarter.",
        "useful": "Warm path into Coinbase's payments and platform teams; reads the internal hiring plan before the board updates.",
        "history": ["2023— Coinbase — Product Manager", "2019-2023 — a Series B payments startup — Product lead"],
        "insights": "Pointed you at the Coinbase careers page ('we read everything') and asked to be a test user of your agent project.",
        "anchors": [
            (ME, "caught the merchant checkout launch post, congrats"),
            (THEM, "eighth iteration of that flow. the team makes it look boring, which is the point"),
            (ME, "how's SF treating you?"),
            (THEM, "fog, rooftops, less rain than i'd like"),
            (ME, "if someone wanted to work on the payments side at Coinbase, where would they even start?"),
            (THEM, "the careers page is real, we read everything. bias toward people who ship"),
            (THEM, "what are you building these days?"),
            (ME, "an agent that mines my own network for warm paths to work. you're in the test set, obviously"),
            (THEM, "ha. as long as it never sends anything on my behalf"),
            (ME, "hard rule of the product, actually"),
        ],
    },
    {
        "tg_id": DEMO_TG_ID_BASE + 2, "name": "Tomas Vestergaard", "pool": "product",
        "msgs": 330, "first_days": 800, "last_days": 2,
        "company": "Figma", "role": "Design Lead", "mention": "definite", "feed": True,
        "location": "Copenhagen, Denmark", "lat": 55.6761, "lng": 12.5683,
        "tags": ["design", "collaboration", "SaaS", "design-systems"],
        "blurb": "Design-systems brain; sends 2am prototype links and asks for brutal feedback.",
        "footprint": ["Design Lead, Figma (design systems)"],
        "now": "Leads a design-systems team at Figma from Copenhagen; obsessed with multiplayer editing latency.",
        "useful": "Design leadership perspective and intros across the Nordic product-design scene; Figma's board is public and active.",
        "history": ["2022— Figma — Design Lead", "2017-2022 — a Copenhagen design agency — Senior product designer"],
        "insights": "Offered a portfolio review for anyone you send; mentioned the Figma board 'moves with the roadmap'.",
        "anchors": [
            (THEM, "prototype link incoming, tear it apart"),
            (ME, "the spacing on the third screen is a crime, otherwise lovely"),
            (ME, "is Figma hiring designers in europe much?"),
            (THEM, "we post what's real on the careers page, it moves with the roadmap"),
            (THEM, "send me anyone good, i'll do a portfolio review"),
            (ME, "you'll regret that offer"),
            (THEM, "copenhagen is grey and perfect today"),
        ],
    },
    {
        "tg_id": DEMO_TG_ID_BASE + 3, "name": "Ines Barbosa", "pool": "builder",
        "msgs": 300, "first_days": 700, "last_days": 3,
        "company": "Ripple", "role": "Technical Recruiter", "mention": "definite", "feed": True,
        "location": "London, UK", "lat": 51.5074, "lng": -0.1278,
        "tags": ["recruiting", "payments", "crypto", "hiring"],
        "blurb": "Recruiter who actually replies; trades hiring gossip for candidate intros.",
        "footprint": ["Technical Recruiter, Ripple (engineering hiring, EMEA)"],
        "now": "Runs EMEA engineering hiring at Ripple; building out the London payments-infrastructure team.",
        "useful": "A recruiter inside Ripple who owes you intros — the shortest warm path to any Ripple posting in the scout.",
        "history": ["2024— Ripple — Technical Recruiter", "2020-2024 — a London fintech — Talent partner"],
        "insights": "Asked for backend candidates twice; said the Ripple board is 'honest about where the headcount is'.",
        "anchors": [
            (THEM, "need two backend people for the london team, anyone?"),
            (ME, "sending you two names tonight"),
            (ME, "how's recruiting at Ripple these days, brutal?"),
            (THEM, "steady. the careers page is honest about where the headcount actually is"),
            (THEM, "your network-agent thing — does it do candidate matching?"),
            (ME, "the other direction: it finds who i know at the companies with openings"),
            (THEM, "useful. cold outreach is dead anyway"),
            (ME, "lisbon in november? there's a hiring meetup"),
            (THEM, "book me"),
        ],
    },
    {
        "tg_id": DEMO_TG_ID_BASE + 4, "name": "Emil Lindeberg", "pool": "infra",
        "msgs": 200, "first_days": 850, "last_days": 10,
        "company": "Stripe", "role": "Payments Engineer", "mention": "definite", "feed": True,
        "location": "Stockholm, Sweden", "lat": 59.3293, "lng": 18.0686,
        "tags": ["payments", "infrastructure", "stablecoins", "engineering"],
        "blurb": "Payments-rails engineer; explains settlement like a bedtime story. The better-known of your two Emils.",
        "footprint": ["Payments Engineer, Stripe (stablecoin settlement)", "Talks at Nordic fintech meetups on settlement rails"],
        "now": "Works on stablecoin settlement at Stripe out of Stockholm; speaks at Nordic payments meetups.",
        "useful": "Deep payments-infrastructure context and a warm path into Stripe's crypto-adjacent teams.",
        "history": ["2021— Stripe — Payments Engineer", "2016-2021 — a Swedish bank — Backend engineer"],
        "insights": "Gave you a settlement reading list unprompted; mentioned Stripe's board is where the real openings are.",
        "anchors": [
            (THEM, "sent you three links about settlement finality, no context, enjoy"),
            (ME, "your reading lists are a public utility"),
            (ME, "how's the stablecoin work at Stripe going?"),
            (THEM, "internet commerce keeps growing, so we keep building rails. boring and wonderful"),
            (ME, "any advice on hiring payments people?"),
            (THEM, "test for genuine curiosity about the counterparty's business. everything else is trainable"),
        ],
    },
    {
        "tg_id": DEMO_TG_ID_BASE + 5, "name": "Dmitri Ryabtsev", "pool": "defi",
        "msgs": 150, "first_days": 600, "last_days": 15,
        "company": "Uniswap Labs", "role": "Backend Engineer", "mention": "inferred", "feed": True,
        "location": "New York, New York, US", "lat": 40.7128, "lng": -74.0060,
        "tags": ["defi", "dex", "backend", "smart-contracts"],
        "blurb": "Backend engineer on a major DEX team; never names the employer, always names the bug.",
        "footprint": ["Backend Engineer, Uniswap Labs (routing infrastructure)"],
        "now": "Backend engineer at Uniswap Labs in New York; works on the swap router and hooks tooling.",
        "useful": "Inside view on DEX infrastructure hiring; a warm path into Uniswap Labs' engineering team.",
        "history": ["2023— Uniswap Labs — Backend Engineer", "2019-2023 — a DeFi analytics startup — Engineer"],
        "insights": "Only ever says 'the DEX' and 'the router' — the employer is inferred from context, never stated in the chats.",
        "anchors": [
            (THEM, "the router rewrite shipped. v4 hooks people are already breaking it in creative ways"),
            (ME, "the dex never sleeps"),
            (ME, "you still in new york?"),
            (THEM, "brooklyn. the office is a train and a coffee away"),
            (ME, "is the team hiring backend people?"),
            (THEM, "always. our board is public, the good roles are the boring-sounding ones"),
        ],
    },
    {
        "tg_id": DEMO_TG_ID_BASE + 6, "name": "Yuki Terashima", "pool": "infra",
        "msgs": 120, "first_days": 500, "last_days": 20,
        "company": "Alchemy", "role": "Developer Relations", "mention": "definite", "feed": True,
        "location": "Tokyo, Japan", "lat": 35.6762, "lng": 139.6503,
        "tags": ["devrel", "infrastructure", "developer-tools", "web3"],
        "blurb": "Devrel from Tokyo; runs the APAC workshops and knows every hackathon organizer.",
        "footprint": ["Developer Relations, Alchemy (APAC)"],
        "now": "Runs APAC developer relations for Alchemy from Tokyo; hackathon circuit most weekends.",
        "useful": "Hackathon and developer-community introductions across APAC; Alchemy hiring intel for devrel and infra roles.",
        "history": ["2024— Alchemy — Developer Relations", "2021-2024 — a Tokyo web3 studio — Developer advocate"],
        "insights": "Said Alchemy is hiring devrel in two regions; offered to co-host a Lisbon workshop.",
        "anchors": [
            (THEM, "tokyo workshop had 200 people, the demos were unreal"),
            (ME, "the apac builders are coming for all of us"),
            (ME, "is Alchemy still growing the devrel team?"),
            (THEM, "two regions hiring right now, the postings are current"),
            (THEM, "want to co-host something in lisbon?"),
            (ME, "yes. dates?"),
        ],
    },
    {
        "tg_id": DEMO_TG_ID_BASE + 7, "name": "Amara Osei", "pool": "defi",
        "msgs": 90, "first_days": 550, "last_days": 45,
        "company": "Nansen", "role": "Data Scientist", "mention": "definite", "feed": True,
        "location": "London, UK", "lat": 51.5074, "lng": -0.1278,
        "tags": ["data", "onchain-analytics", "research", "crypto"],
        "blurb": "Onchain-data scientist; will explain a wallet-labelling model at a party and make it fun.",
        "footprint": ["Data Scientist, Nansen (wallet labelling)"],
        "now": "Data scientist at Nansen in London working on wallet labelling and entity resolution.",
        "useful": "Onchain analytics expertise and a warm path into Nansen's small, senior data team.",
        "history": ["2023— Nansen — Data Scientist", "2020-2023 — a London bank — Quant analyst"],
        "insights": "Nansen's team is small; she flagged a senior data role opening before it was posted.",
        "anchors": [
            (ME, "every fund i talk to is 'doing onchain data' now"),
            (THEM, "and half of them are finally doing it properly. good decade to be at Nansen"),
            (ME, "your team hiring?"),
            (THEM, "small team, one senior data role coming up. the board will show it"),
        ],
    },
    {
        "tg_id": DEMO_TG_ID_BASE + 8, "name": "Lucas Ferrão", "pool": "life",
        "msgs": 160, "first_days": 650, "last_days": 12,
        "company": "Bitpanda", "role": "Growth Lead", "mention": "inferred", "feed": True,
        "location": "Lisbon, Portugal", "lat": 38.7223, "lng": -9.1393,
        "tags": ["growth", "marketing", "exchanges", "retail-crypto"],
        "blurb": "Surf and padel first, work a distant second; growth lead at a Vienna-based retail exchange, remote from Lisbon.",
        "footprint": ["Growth Lead, Bitpanda (remote, Lisbon)"],
        "now": "Growth lead at Bitpanda, remote from Lisbon; runs the southern-Europe acquisition funnel.",
        "useful": "Growth-marketing perspective and a warm path into Bitpanda; also your padel fourth.",
        "history": ["2022— Bitpanda — Growth Lead", "2018-2022 — a Lisbon travel startup — Growth manager"],
        "insights": "Ninety percent life chat. The employer is never named — 'the vienna exchange' and 'the savings launch' are the only work signals.",
        "anchors": [
            (THEM, "the vienna exchange finally shipped the savings product, i can sleep"),
            (ME, "growth lead sleeping, unheard of"),
            (ME, "wait so are you going to the vienna office at all?"),
            (THEM, "twice a quarter. the rest is remote and surf"),
            (THEM, "surf tomorrow? forecast is clean"),
            (ME, "7am. i bring the board, you bring the excuses"),
        ],
    },
    {
        "tg_id": DEMO_TG_ID_BASE + 9, "name": "Hana Zvěřinová", "pool": "builder",
        "msgs": 75, "first_days": 480, "last_days": 90,
        "company": "Consensys", "role": "Engineering Manager", "mention": "definite", "feed": True,
        "location": "Prague, Czechia", "lat": 50.0755, "lng": 14.4378,
        "tags": ["engineering-management", "wallets", "infrastructure", "ethereum"],
        "blurb": "Engineering manager with strong opinions on on-call rotations and stronger ones on Prague coffee.",
        "footprint": ["Engineering Manager, Consensys (wallet infrastructure)"],
        "now": "Engineering manager at Consensys, remote from Prague; runs a wallet-infrastructure team.",
        "useful": "Engineering-management intel and a warm path into Consensys' remote engineering org.",
        "history": ["2022— Consensys — Engineering Manager", "2017-2022 — a Prague software house — Tech lead"],
        "insights": "Said Consensys hires 'remote-first, europe-friendly'; open to referring senior engineers.",
        "anchors": [
            (THEM, "on-call redesign week. everyone hates it, everyone will thank me"),
            (ME, "the em life"),
            (ME, "is Consensys still remote-first for engineers?"),
            (THEM, "remote-first, europe-friendly. i can refer senior people if they're real"),
        ],
    },
    {
        "tg_id": DEMO_TG_ID_BASE + 10, "name": "Sebastián Aramburu", "pool": "infra",
        "msgs": 60, "first_days": 400, "last_days": 60,
        "company": "Fireblocks", "role": "Solutions Engineer", "mention": "definite", "feed": True,
        "location": "Madrid, Spain", "lat": 40.4168, "lng": -3.7038,
        "tags": ["solutions-engineering", "custody", "institutional", "security"],
        "blurb": "Solutions engineer for institutional custody; patient with dumb key-management questions.",
        "footprint": ["Solutions Engineer, Fireblocks (southern Europe)"],
        "now": "Solutions engineer at Fireblocks covering southern Europe from Madrid; bank and fintech integrations.",
        "useful": "Institutional-custody know-how and a warm path into Fireblocks' solutions and sales-engineering teams.",
        "history": ["2023— Fireblocks — Solutions Engineer", "2019-2023 — a Madrid bank — Integration engineer"],
        "insights": "Explained MPC custody to you twice; said Fireblocks posts field roles as they open.",
        "anchors": [
            (ME, "ok explain mpc custody to me like i'm five, again"),
            (THEM, "the key is never in one place. that's it, that's the product"),
            (ME, "Fireblocks hiring field people in europe?"),
            (THEM, "as roles open they go on the board, madrid is finally on the map"),
        ],
    },
    {
        "tg_id": DEMO_TG_ID_BASE + 11, "name": "Emil Lindeberg", "pool": "product",
        "msgs": 45, "first_days": 700, "last_days": 100,
        "company": "Databricks", "role": "Solutions Architect", "mention": "definite", "feed": True,
        "location": "Amsterdam, Netherlands", "lat": 52.3676, "lng": 4.9041,
        "tags": ["data", "enterprise", "solutions-architecture", "analytics"],
        "blurb": "The quieter Emil: solutions architect in Amsterdam, resurfaces around data conferences.",
        "footprint": ["Solutions Architect, Databricks (Benelux)"],
        "now": "Solutions architect at Databricks in Amsterdam; enterprise data platforms for Benelux customers.",
        "useful": "Enterprise data-platform context and a warm path into Databricks' Benelux field team.",
        "history": ["2024— Databricks — Solutions Architect", "2018-2024 — an Amsterdam consultancy — Data engineer"],
        "insights": "Same name as your Stockholm Emil — public research finds the prominent one, the product flags the mismatch instead of merging them.",
        # what a public search returns for this name is the OTHER Emil
        "evidence_employer": "Stripe",
        "evidence_location": ("Stockholm, Sweden", 59.3293, 18.0686),
        "evidence_footprint": ["Payments Engineer, Stripe (stablecoin settlement)", "Talks at Nordic fintech meetups on settlement rails"],
        "evidence_history": ["2021— Stripe — Payments Engineer", "2016-2021 — a Swedish bank — Backend engineer"],
        "evidence_citations": [("Stripe", "https://stripe.com/"), ("Stripe jobs", "https://stripe.com/jobs")],
        "anchors": [
            (THEM, "amsterdam data summit next month, you coming?"),
            (ME, "if the talks are good"),
            (ME, "still at Databricks on the architect side?"),
            (THEM, "yep, benelux enterprise accounts. the postings say what's true"),
        ],
    },
    {
        "tg_id": DEMO_TG_ID_BASE + 12, "name": "Mei-Lin Chou", "pool": "product",
        "msgs": 100, "first_days": 500, "last_days": 150,
        "company": "Phantom", "role": "Product Designer", "mention": "definite", "feed": True,
        "location": "San Francisco, California, US", "lat": 37.7749, "lng": -122.4194,
        "tags": ["design", "wallets", "consumer", "mobile"],
        "blurb": "Wallet product designer; config talk turns philosophical after 11pm.",
        "footprint": ["Product Designer, Phantom (mobile wallet)"],
        "now": "Product designer at Phantom in San Francisco; mobile wallet onboarding and multi-chain flows.",
        "useful": "Consumer-wallet design expertise and a warm path into Phantom's design and product teams.",
        "history": ["2023— Phantom — Product Designer", "2019-2023 — a mobile banking app — Product designer"],
        "insights": "Thread went quiet after the last launch — time follow-ups to their release cycle.",
        "anchors": [
            (ME, "our whole team lives in your wallet, thought you should know"),
            (THEM, "that's the dream, tell them thanks"),
            (ME, "what's next for design at Phantom?"),
            (THEM, "wherever wallets stop feeling like wallets. vague on purpose"),
        ],
    },
    {
        "tg_id": DEMO_TG_ID_BASE + 13, "name": "Arjun Chandrakumar", "pool": "builder",
        "msgs": 40, "first_days": 300, "last_days": 75,
        "company": "Harbor Guild DAO", "role": "Founder", "mention": "definite", "feed": False,
        "location": "Bengaluru, India", "lat": 12.9716, "lng": 77.5946,
        "tags": ["founder", "dao-tooling", "startups", "governance"],
        "blurb": "First-time founder building DAO treasury tooling; pitches in voice notes, apologizes in text.",
        "footprint": ["Founder, Harbor Guild DAO (treasury tooling)"],
        "now": "Founding Harbor Guild DAO in Bengaluru — treasury and governance tooling for small DAOs; pre-seed.",
        "useful": "Founder-to-founder trade of notes; no job feed (the honest no-feed path), but a live pipeline of early hires.",
        "history": ["2025— Harbor Guild DAO — Founder", "2021-2025 — a Bengaluru fintech — Product engineer"],
        "insights": "Pre-seed and hiring by referral only — no public board; asked you for a treasury-ops intro.",
        "anchors": [
            (THEM, "voice note incoming, sorry, it's a pitch"),
            (ME, "listened. the treasury angle is the whole company, cut the rest"),
            (ME, "so Harbor Guild DAO is real now?"),
            (THEM, "incorporated, pre-seed, two of us. hiring by referral only, no board yet"),
        ],
    },
    {
        "tg_id": DEMO_TG_ID_BASE + 14, "name": "Karolina Zięba", "pool": "personal",
        "msgs": 25, "first_days": 400, "last_days": 150,
        "company": "Polygon Labs", "role": "Community Lead", "mention": "inferred", "feed": True,
        "location": "Warsaw, Poland", "lat": 52.2297, "lng": 21.0122,
        "tags": ["community", "ecosystem", "events", "scaling"],
        "blurb": "Community lead on a big scaling team; met at a Warsaw meetup, mostly conference logistics since.",
        "footprint": ["Community Lead, Polygon Labs (EMEA ecosystem)"],
        "now": "Community lead at Polygon Labs for the EMEA ecosystem, based in Warsaw.",
        "useful": "Ecosystem and events introductions; a quiet but real warm path into Polygon Labs.",
        "history": ["2023— Polygon Labs — Community Lead", "2020-2023 — a Warsaw blockchain meetup — Organizer"],
        "insights": "Only hints at the employer ('the scaling team', 'our devcon booth') — inferred, never stated.",
        "anchors": [
            (THEM, "devcon booth duty all week, come say hi"),
            (ME, "the scaling team booth? the one with the good stickers"),
            (THEM, "the very one. warsaw meetup is back in spring too"),
        ],
    },
    {
        "tg_id": DEMO_TG_ID_BASE + 15, "name": "Felix Hasselbach", "pool": "builder",
        "msgs": 35, "first_days": 600, "last_days": 200,
        "company": "Ledger", "role": "Talent Partner", "mention": "inferred", "feed": True,
        "location": "Paris, France", "lat": 48.8566, "lng": 2.3522,
        "tags": ["recruiting", "hardware-wallets", "security", "hiring"],
        "blurb": "Talent partner at the hardware-wallet company in Paris; dormant thread, resurfaces around hiring pushes.",
        "footprint": ["Talent Partner, Ledger (Paris)"],
        "now": "Talent partner at Ledger in Paris; hiring for firmware and security teams.",
        "useful": "A recruiter inside Ledger — dormant, but the shortest path to their security and firmware roles.",
        "history": ["2024— Ledger — Talent Partner", "2019-2024 — a Berlin recruiting firm — Consultant"],
        "insights": "Never names the employer — 'the hardware wallet people' and 'the paris hq' are the only signals.",
        "anchors": [
            (THEM, "the hardware wallet people are on a hiring push again, firmware and security"),
            (ME, "you'll be busy then"),
            (ME, "you're at the paris hq full time now?"),
            (THEM, "three days a week. send me anyone who has shipped firmware"),
        ],
    },
    {
        # handle-only contact: Telegram name null; public footprint resolves it
        "tg_id": DEMO_TG_ID_BASE + 16, "name": "", "handle": "@rk_builds", "pool": "infra",
        "msgs": 20, "first_days": 240, "last_days": 200,
        "company": "Blockdaemon", "role": "Ecosystem Lead", "mention": "definite", "feed": True,
        "location": "Berlin, Germany", "lat": 52.5200, "lng": 13.4050,
        "tags": ["ecosystem", "node-infrastructure", "staking", "partnerships"],
        "blurb": "Handle-only contact from a Berlin infra meetup; public footprint resolves to a real name.",
        "footprint": ["Ecosystem Lead, Blockdaemon (Berlin)"],
        "now": "Ecosystem lead at Blockdaemon in Berlin; staking and node-infrastructure partnerships.",
        "useful": "Node-infrastructure partnerships and a warm path into Blockdaemon; the row was nameless until research resolved it.",
        "history": ["2024— Blockdaemon — Ecosystem Lead"],
        "insights": "Met once, exchanged handles only. Research resolves the blank name from public sources.",
        "resolved_name": "Ronja Kaltenbach",
        "anchors": [
            (THEM, "hey, @rk_builds from the berlin infra meetup — you asked about staking partnerships"),
            (ME, "yes! still at Blockdaemon on the ecosystem side?"),
            (THEM, "still there. ping me if you want the partnerships deck"),
        ],
    },
    {
        # handle-only contact that stays unresolved: honest 'unverified' path
        "tg_id": DEMO_TG_ID_BASE + 17, "name": "", "handle": "@anon_mm", "pool": "defi",
        "msgs": 12, "first_days": 320, "last_days": 300,
        "company": "Messari", "role": "Research Analyst", "mention": "definite", "feed": True,
        "location": "Singapore", "lat": 1.3521, "lng": 103.8198,
        "tags": ["research", "analytics", "crypto"],
        "blurb": "Anonymous research analyst; says where they work, never who they are.",
        "footprint": [],
        "now": None,
        "useful": None,
        "history": [],
        "insights": "No public footprint — research honestly returns unverified; the row stays nameless until you fill it in.",
        "identified": False,
        "anchors": [
            (THEM, "@anon_mm here, the research analyst you met at the singapore side event"),
            (ME, "the one who wouldn't tell me their name"),
            (THEM, "still won't. i'm at Messari, that's all you get"),
        ],
    },
]

GROUP_LINES = [
    "who's going to the summit next month?",
    "in 🙋", "only if the panels are good", "same hotel as last year?",
    "someone book the big table", "sharing my notes from today, solid talks",
    "next one should be on infra imo", "+1",
    "the hallway track is the real conference", "who had the demo with the robot dog?",
    "padel thursday, lisbon, 7pm, be there",
]

SAVED_NOTES = [
    "intro template v2: shorter, one ask, no buzzwords",
    "warm paths beat cold apps 10:1 — the whole thesis",
    "companies to watch: custody, payments rails, onchain data",
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
        "date_unixtime": str(int(dt.replace(tzinfo=timezone.utc).timestamp())),  # UTC-explicit: naive .timestamp() is machine-zone dependent
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
    peer_name = persona["name"] or None  # handle-only contacts export as null
    base_id = rng.randint(10_000, 900_000)
    messages = []
    for i, ((who, text), dt) in enumerate(zip(seq, times)):
        if who == ME:
            messages.append(make_message(base_id + i, dt, OWNER_NAME, OWNER_ID, text))
        else:
            messages.append(make_message(base_id + i, dt, peer_name, peer_id, text))
    return {
        "name": peer_name,
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
    return {"name": "Lisbon web3 padel 🎾", "type": "private_supergroup", "id": 1456789012, "messages": messages}


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


def company_citations(persona: dict) -> list[dict]:
    """Citations are COMPANY pages only — fictional people have no profile
    pages to cite (a made-up LinkedIn URL would 404). The namesake carries
    the pages research would actually find: the other person's employer."""
    if "evidence_citations" in persona:
        return [{"title": t, "url": u} for t, u in persona["evidence_citations"]]
    if not persona["feed"] and persona["company"] == "Harbor Guild DAO":
        return []  # fictional startup: nothing real to cite
    if not persona.get("identified", True):
        return []  # unresolved contact: no evidence at all
    company = persona["company"]
    return [{"title": t, "url": u} for t, u in COMPANY_PAGES[company]]


# Public company pages only (the companies are real; the people are not).
COMPANY_PAGES: dict[str, list[tuple[str, str]]] = {
    "Coinbase": [("Coinbase", "https://www.coinbase.com/"), ("Coinbase careers", "https://www.coinbase.com/careers")],
    "Figma": [("Figma", "https://www.figma.com/"), ("Figma careers", "https://www.figma.com/careers/")],
    "Ripple": [("Ripple", "https://ripple.com/"), ("Ripple careers", "https://ripple.com/careers/")],
    "Stripe": [("Stripe", "https://stripe.com/"), ("Stripe jobs", "https://stripe.com/jobs")],
    "Uniswap Labs": [("Uniswap Labs", "https://uniswap.org/"), ("Uniswap Labs careers", "https://jobs.ashbyhq.com/uniswap")],
    "Alchemy": [("Alchemy", "https://www.alchemy.com/"), ("Alchemy careers", "https://jobs.ashbyhq.com/alchemy")],
    "Nansen": [("Nansen", "https://www.nansen.ai/"), ("Nansen careers", "https://job-boards.greenhouse.io/nansen")],
    "Bitpanda": [("Bitpanda", "https://www.bitpanda.com/"), ("Bitpanda careers", "https://job-boards.eu.greenhouse.io/bitpanda")],
    "Consensys": [("Consensys", "https://consensys.io/"), ("Consensys careers", "https://jobs.ashbyhq.com/consensys")],
    "Fireblocks": [("Fireblocks", "https://www.fireblocks.com/"), ("Fireblocks careers", "https://www.fireblocks.com/careers")],
    "Databricks": [("Databricks", "https://www.databricks.com/"), ("Databricks careers", "https://www.databricks.com/company/careers")],
    "Phantom": [("Phantom", "https://phantom.com/"), ("Phantom careers", "https://jobs.ashbyhq.com/phantom")],
    "Polygon Labs": [("Polygon Labs", "https://polygon.technology/"), ("Polygon Labs careers", "https://jobs.ashbyhq.com/polygon-labs")],
    "Ledger": [("Ledger", "https://www.ledger.com/"), ("Ledger careers", "https://jobs.ashbyhq.com/ledger")],
    "Blockdaemon": [("Blockdaemon", "https://www.blockdaemon.com/"), ("Blockdaemon careers", "https://jobs.ashbyhq.com/blockdaemon")],
    "Messari": [("Messari", "https://messari.io/"), ("Messari careers", "https://job-boards.greenhouse.io/messari")],
}


def build_knowledge() -> dict:
    """The sidecar the offline agents consult (keyed by tg_id): the fictional
    person's INVENTED profile plus the real company as a public fact.
    `evidence_*` fields are what public research would return — identical
    to the profile for everyone except the namesake, whose evidence is the
    other person's. `identified: false` marks the contact research cannot
    resolve at all."""
    people = {}
    for p in PERSONAS:
        location, lat, lng = p.get("evidence_location", (p["location"], p["lat"], p["lng"]))
        people[str(p["tg_id"])] = {
            "name": p["name"],
            "handle": p.get("handle"),
            "company": p["company"],
            "role": p["role"],
            "company_mention": p["mention"],
            "location": location,
            "lat": lat,
            "lng": lng,
            "tags": p["tags"],
            "blurb": p["blurb"],
            "has_verified_feed": p["feed"],
            "footprint": p.get("evidence_footprint", p["footprint"]),
            "citations": company_citations(p),
            "linkedin_url": None,  # fictional people: a profile URL would 404
            "current_focus": p["now"],
            "how_useful": p["useful"],
            "history": p.get("evidence_history", p["history"]),
            "chat_insights": p["insights"],
            "identified": p.get("identified", True),
            "evidence_employer": p.get("evidence_employer", p["company"]) if p.get("identified", True) else None,
            "resolved_name": p.get("resolved_name"),
        }
    return {
        "_note": (
            "Demo sidecar: WHOLLY FICTIONAL people (invented names, web-checked "
            "against notable people at the same companies), invented "
            "conversations; only the companies are real, used as public facts "
            "for the live job feeds. Consumed by the deterministic offline "
            "agents and by the 'demo-sidecar:' research path for the reserved "
            "demo tg_id range — never shipped to any model."
        ),
        "people": people,
    }


def build_expected_people() -> dict:
    """Golden reference for a correct refine pass (ModelPerson shape) —
    derived from the roster so it can never drift from the corpus."""
    people = []
    for p in PERSONAS:
        definite = p["mention"] == "definite"
        people.append({
            "tg_id": p["tg_id"],
            "name": p["name"],
            "company_definite": p["company"] if definite else None,
            "company_inferred": None if definite else p["company"],
            "role_guess": p["role"],
            "summary": f"{p['blurb']}\n{p['role']}, {p['company']}.",
            "work_relevant": True,
            "why_relevant": (
                "Company and role stated in the conversation."
                if definite else
                "Employer hinted at, never named, in the conversation."
            ),
        })
    return {
        "_note": (
            "Golden REFERENCE for a correct refine pass over the DEMO dataset "
            "(ModelPerson shape), generated from sample-data/generate.py. "
            "Wholly fictional people; companies are public facts. Model "
            "wording will vary — the structural contract (definite only when "
            "the chats name the employer, inferred otherwise) is what matters."
        ),
        "people": people,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--now", default="2026-09-26T12:00:00",
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
            "DEMO dataset — wholly fictional people and invented conversations; "
            "the companies are real and appear only as public facts. Generated "
            "by sample-data/generate.py for product demonstration only."
        ),
        "chats": {"about": "This page lists all your chats.", "list": chats},
    }
    out_path = Path(args.out)
    out_path.write_text(json.dumps(export, ensure_ascii=False, indent=1), encoding="utf-8")

    knowledge_path = out_path.parent / "demo-knowledge.json"
    knowledge_path.write_text(
        json.dumps(build_knowledge(), ensure_ascii=False, indent=1), encoding="utf-8"
    )
    expected_path = out_path.parent / "expected-people.json"
    expected_path.write_text(
        json.dumps(build_expected_people(), ensure_ascii=False, indent=1), encoding="utf-8"
    )

    total = sum(len(c["messages"]) for c in chats)
    print(f"wrote {out_path} — {len(chats)} chats, {total} messages")
    print(f"wrote {knowledge_path} — {len(PERSONAS)} people")
    print(f"wrote {expected_path} — {len(PERSONAS)} people")
    print(f"{'name':<22} {'company':<16} {'mention':<9} {'msgs':>5} {'last':>12} {'closeness':>9} {'feed':>5}")
    for p in PERSONAS:
        chat = next(c for c in chats if c["id"] == p["tg_id"])
        label = p["name"] or f"(handle {p['handle']})"
        print(f"{label:<22} {p['company']:<16} {p['mention']:<9} {len(chat['messages']):>5} "
              f"{chat['messages'][-1]['date'][:10]:>12} "
              f"{closeness(len(chat['messages']), chat['messages'][-1]['date'], now):>9} "
              f"{'yes' if p['feed'] else '—':>5}")


if __name__ == "__main__":
    main()
