#!/usr/bin/env python3
"""Deterministic generator for sample-data/result.json — a byte-accurate
Telegram Desktop export of a FULLY FICTIONAL network (SAMPLE-DATA.md spec).

Every person is invented; none resolves to a real notable individual. The
companies are real on purpose: job-scout hits against live public ATS feeds
(only identity-verified feeds in data/ats-slugs.json actually match — today
CoinMarketCap and Ripple). Regenerate with a fresh "now" anytime:

    python3 sample-data/generate.py --now 2026-08-29T18:00:00

Baked-in edge cases (mirrors the SAMPLE-DATA.md spec):
  - employer only ever HINTED at (Nazar) -> company_inferred, never definite
  - same-name collision: two different "Tomas Keller"
  - two nameless contacts (chat name null; handle only inside the text)
  - one ~90% personal thread (Petro) -> not work-relevant
  - one non-crypto contact (Lina) -> refine should exclude her
  - two non-resolving people (no company ever stated) -> stay 'unverified'
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
# Real chats repeat themselves; so do these, deliberately.
# ---------------------------------------------------------------------------

POOLS: dict[str, list[list[tuple[str, str]]]] = {
    "market": [
        [(ME, "did you see btc this morning"), (THEM, "yeah wild candle, desks repositioning again")],
        [(THEM, "funding rates are getting silly"), (ME, "everything is levered long, classic")],
        [(ME, "eth/btc looking heavy"), (THEM, "rotation season, same as every cycle")],
        [(THEM, "another ETF inflow day"), (ME, "tradfi just keeps buying, unreal")],
        [(ME, "alts bleeding again"), (THEM, "liquidity only cares about majors rn")],
        [(THEM, "gm"), (ME, "gm gm")],
        [(ME, "you at token2049 this year?"), (THEM, "probably, if the panels are decent")],
        [(THEM, "did that chain halt again?"), (ME, "lol yes, validators are furious")],
        [(ME, "stables volume printing new highs"), (THEM, "payments is quietly the real bull case")],
        [(THEM, "watching the unlock schedule this week"), (ME, "supply overhang gonna hurt")],
    ],
    "work": [
        [(ME, "how's the quarter closing?"), (THEM, "brutal but we'll land it")],
        [(THEM, "back to back calls all day"), (ME, "calendar tetris, i know it well")],
        [(ME, "any luck with that partner deal?"), (THEM, "redlines went back friday, fingers crossed")],
        [(THEM, "legal is sitting on the contract again"), (ME, "pour one out for bd everywhere")],
        [(ME, "offsite good?"), (THEM, "too many workshops, decent tapas")],
        [(THEM, "shipping the deck tonight"), (ME, "send it over if you want a second pair of eyes")],
        [(ME, "conference next month?"), (THEM, "booth duty, pray for me")],
        [(THEM, "new head of growth started today"), (ME, "reorg number four this year?")],
        [(ME, "pipeline review went ok?"), (THEM, "two deals slipped to next quarter, story of my life")],
        [(THEM, "hiring freeze lifted finally"), (ME, "good sign, budgets are back")],
    ],
    "tech": [
        [(ME, "rpc latency any better?"), (THEM, "moved two nodes to bare metal, way better p99")],
        [(THEM, "indexer fell over again last night"), (ME, "reorgs or oom?"), (THEM, "oom, of course")],
        [(ME, "you on the new client release?"), (THEM, "waiting for the patch, first cut was buggy")],
        [(THEM, "gas spiked hard during the mint"), (ME, "saw it, mempool was a warzone")],
        [(ME, "how big is your archive node now?"), (THEM, "don't ask. bought more disks")],
        [(THEM, "audit report came back"), (ME, "anything scary?"), (THEM, "two mediums, fixable")],
        [(ME, "testnet faucet dry again"), (THEM, "i'll send you some, one sec")],
        [(THEM, "ci is red on the fork tests"), (ME, "flaky or real?"), (THEM, "real unfortunately")],
    ],
    "trading": [
        [(THEM, "aped the new perp listing"), (ME, "size or dust?"), (THEM, "dust, i learned my lesson")],
        [(ME, "you farming that new points program?"), (THEM, "obviously, it's a job at this point")],
        [(THEM, "got liqed on the wick"), (ME, "f"), (THEM, "we go again")],
        [(ME, "airdrop hit your wallet?"), (THEM, "claimed and rotated, not proud")],
        [(THEM, "basis trade is printing"), (ME, "until it isn't, be careful")],
        [(ME, "which dex has depth for that pair?"), (THEM, "honestly cex, sad but true")],
        [(THEM, "gm ser"), (ME, "gm")],
        [(ME, "new vault strategy live?"), (THEM, "capped deposits, filled in an hour")],
    ],
    "personal": [
        [(ME, "gym at 7?"), (THEM, "make it 8, dying today")],
        [(THEM, "padel saturday?"), (ME, "in. loser buys pastéis")],
        [(ME, "that new ramen place?"), (THEM, "yes finally, thursday?")],
        [(THEM, "leg day destroyed me"), (ME, "stairs are the enemy now")],
        [(ME, "you watching the match tonight?"), (THEM, "at joão's place, come by")],
        [(THEM, "beach on sunday, forecast is perfect"), (ME, "caparica or guincho?"), (THEM, "guincho, windy but worth it")],
        [(ME, "protein pancakes recipe pls"), (THEM, "sending, don't skip the banana")],
        [(THEM, "5k run tomorrow morning?"), (ME, "only if coffee after")],
        [(ME, "happy bday brother 🎉"), (THEM, "obrigado!! dinner next week on me")],
        [(THEM, "sauna after gym?"), (ME, "always")],
    ],
    "recruiting": [
        [(THEM, "quick nudge on that role — any thoughts?"), (ME, "still mulling, comp range first?")],
        [(ME, "is the team remote-friendly?"), (THEM, "hybrid, but emea remote works for senior hires")],
        [(THEM, "hiring manager liked your background"), (ME, "good to hear, what's the next step?")],
        [(ME, "what's the interview loop like?"), (THEM, "four rounds, one case study, no take-home")],
        [(THEM, "sharing two more openings, no pressure"), (ME, "appreciate it, will look tonight")],
    ],
}

# ---------------------------------------------------------------------------
# Personas — 15 fictional people. Anchors carry the facts refine/enrich need;
# they are injected in order at proportional positions in the thread.
# ---------------------------------------------------------------------------

PERSONAS: list[dict] = [
    {
        "tg_id": 314159265, "name": "Marta Yezerska", "pool": "work",
        "msgs": 420, "first_days": 700, "last_days": 2,
        "anchors": [
            (THEM, "big news — i signed! third week at Ripple now and i already own EMEA corridor partnerships"),
            (ME, "knew you'd land it. BD lead title?"),
            (THEM, "senior bd lead, payments corridors. basically the job we dreamed up back at the startup"),
            (ME, "miss those days. our little payments startup taught us everything the hard way"),
            (THEM, "ODL volumes this quarter are honestly wild, can't share numbers but wild"),
            (THEM, "we're hiring on my team btw — partnerships manager, EMEA. you'd be great"),
            (ME, "tempting. send me the posting?"),
            (THEM, "careers page, ripple, search corridor. or i just refer you, easier"),
            (THEM, "in lisbon for web summit week, dinner is mandatory"),
            (ME, "mandatory accepted. bairro alto?"),
        ],
    },
    {
        "tg_id": 428571428, "name": "Tomas Keller", "pool": "work",
        "msgs": 260, "first_days": 500, "last_days": 10,
        "anchors": [
            (THEM, "since i moved to CoinMarketCap i basically live in listing calls"),
            (ME, "partnerships side or data side?"),
            (THEM, "partnerships — exchanges and data distribution deals mostly"),
            (ME, "you were the best partnerships guy at the conference circuit, CMC is lucky"),
            (THEM, "flattery accepted. come by our booth in november"),
            (THEM, "if you ever want an intro to our bd director, say the word"),
        ],
    },
    {
        "tg_id": 271828182, "name": "Tomas Keller", "pool": "tech",
        "msgs": 48, "first_days": 400, "last_days": 150,
        "anchors": [
            (ME, "hey! tomas from the lisbon hackathon right? the hardware wallet table"),
            (THEM, "that's me. still recovering from that 4am demo"),
            (THEM, "day job is firmware at Ledger — shipping the new signer firmware this quarter"),
            (ME, "embedded rust?"), (THEM, "mostly c with rust creeping in, as everywhere"),
            (THEM, "if you're ever in paris, office tour on me"),
        ],
    },
    {
        "tg_id": 161803398, "name": "Nazar Hlibovych", "pool": "tech",
        "msgs": 210, "first_days": 900, "last_days": 5,
        # Employer only ever HINTED — never named. Hints point at Polygon.
        "anchors": [
            (THEM, "prover costs on our zkEVM are finally sane after the last release"),
            (ME, "you still can't tell me where you work, can you"),
            (THEM, "nda brain, sorry 😅 let's say 'a big L2 you've definitely used'"),
            (THEM, "the POL migration all-hands ran three hours today. THREE"),
            (ME, "that narrows it down considerably you know"),
            (THEM, "the amoy testnet cutover broke half my scripts, mumbai forever in our hearts"),
            (THEM, "offsite was in goa this year, whole chain team flew in"),
            (ME, "one day you'll just say the name"), (THEM, "one day 🟣"),
        ],
    },
    {
        # Nameless contact #1 — handle only, deep DeFi. No employer ever.
        "tg_id": 599999999, "name": None, "pool": "trading",
        "msgs": 140, "first_days": 300, "last_days": 30,
        "anchors": [
            (THEM, "it's @degen_dolphin from the tg alpha group btw, adding you here"),
            (ME, "the dolphin himself. your curve war threads are required reading"),
            (THEM, "full time onchain since 2021, no boss no mercy"),
            (ME, "ever think about joining a fund?"), (THEM, "and give up the aquarium? never"),
        ],
    },
    {
        # Nameless contact #2 — handle only, infra. No employer ever.
        "tg_id": 588888888, "name": None, "pool": "tech",
        "msgs": 35, "first_days": 250, "last_days": 60,
        "anchors": [
            (THEM, "hey, @block_mole here — you asked about our rpc setup in the infra chat"),
            (ME, "yes! the failover config you posted was exactly what i needed"),
            (THEM, "we run everything on bare metal in frankfurt, happy to share the ansible roles"),
        ],
    },
    {
        "tg_id": 733333333, "name": "Iryna Dovbush", "pool": "recruiting",
        "msgs": 26, "first_days": 90, "last_days": 45,
        "anchors": [
            (THEM, "hi Vlad! Iryna here — i'm a talent partner at Chainalysis, we met at the kyiv web3 meetup years ago"),
            (ME, "of course, hi Iryna! congrats on the role"),
            (THEM, "we're growing the EMEA gtm org — a partnerships lead and two bd roles open right now"),
            (ME, "interesting timing. send details?"),
            (THEM, "sent to your email. the partnerships one screams your name honestly"),
        ],
    },
    {
        # ~90% personal thread — gym and dinners; not work-relevant.
        "tg_id": 655555555, "name": "Petro Malanchuk", "pool": "personal",
        "msgs": 380, "first_days": 1000, "last_days": 1,
        "anchors": [
            (THEM, "new gym program starts monday, you're in"),
            (ME, "my bench says no but ok"),
            (THEM, "how's the job hunt going btw?"), (ME, "slow but moving, tell you at dinner"),
            (THEM, "mama's borshch on sunday, non-negotiable"),
            (ME, "wouldn't miss it for anything"),
        ],
    },
    {
        "tg_id": 866666666, "name": "Sofia Anhelina Reyes", "pool": "work",
        "msgs": 120, "first_days": 450, "last_days": 20,
        "anchors": [
            (THEM, "officially a PM at Circle now — cross-border USDC rails, exactly my thing"),
            (ME, "stablecoin payments person achieves final form"),
            (THEM, "the LATAM corridor numbers would melt your brain"),
            (ME, "we should compare notes, i lived that corridor pain at the startup"),
            (THEM, "yes! also our gtm team keeps poaching pms, there may be openings soon 👀"),
        ],
    },
    {
        "tg_id": 944444444, "name": "Andriy Tkachuk-Vovk", "pool": "trading",
        "msgs": 310, "first_days": 1200, "last_days": 7,
        "anchors": [
            (THEM, "ok it's real — i quit and founded Yieldbird Labs. structured vaults, boring on purpose"),
            (ME, "the deck you showed me at the office was NOT boring. congrats man"),
            (THEM, "pre-seed closed last month, tiny round, good angels"),
            (ME, "from cubicle neighbors to this. proud of you"),
            (THEM, "when we raise the seed i want you running bd, i'm serious"),
            (ME, "get the term sheet first, then we talk 😄"),
        ],
    },
    {
        "tg_id": 377777777, "name": "Olena Pryimak", "pool": "work",
        "msgs": 75, "first_days": 600, "last_days": 90,
        "anchors": [
            (THEM, "the grants committee at Aave approved my favorite proposal today, good day"),
            (ME, "ecosystem grants suit you. how big is the program now?"),
            (THEM, "can't say exactly but we funded 40+ teams this year"),
            (ME, "if a payments-adjacent team applies, flag me, i'll help them with gtm"),
        ],
    },
    {
        "tg_id": 211111111, "name": "Danylo Shulha", "pool": "market",
        "msgs": 160, "first_days": 550, "last_days": 14,
        "anchors": [
            (THEM, "listings life at Kraken is 50% legal review 50% telegram groups like this one"),
            (ME, "and 100% people asking you for listings"),
            (THEM, "you joke but three today already"),
            (ME, "ok but hypothetically, if a friend had a token—"), (THEM, "blocked. unblocked. warned"),
        ],
    },
    {
        "tg_id": 122222222, "name": "Kateryna Bilokin", "pool": "work",
        "msgs": 90, "first_days": 800, "last_days": 240,
        "anchors": [
            (THEM, "guess who's doing marketing at Fireblocks now — this uni degree finally pays off"),
            (ME, "kateryna!! from student newspaper to custody marketing, iconic arc"),
            (THEM, "class reunion next spring btw, you're coming"),
        ],
    },
    {
        # Non-resolving: talks shop constantly, employer never stated.
        "tg_id": 499999998, "name": "Yuriy Stotskyi", "pool": "tech",
        "msgs": 55, "first_days": 700, "last_days": 200,
        "anchors": [
            (THEM, "our little node shop crossed 30 validators this month"),
            (ME, "you ever going to give the shop a name and a website?"),
            (THEM, "names are marketing, uptime is truth"),
            (THEM, "we run delegated stake for two foundations now, word of mouth only"),
        ],
    },
    {
        # Non-crypto contact — refine should EXCLUDE her.
        "tg_id": 355555554, "name": "Lina Marchenko-Fedak", "pool": "personal",
        "msgs": 40, "first_days": 350, "last_days": 120,
        "anchors": [
            (THEM, "redesigning the mobile onboarding at the bank, month three of button debates"),
            (ME, "corporate design life. any chance they let you ship the good version?"),
            (THEM, "the beige version won, as always"),
            (ME, "come to one of the web3 meetups, we have worse buttons but more fun"),
            (THEM, "hard pass on the crypto stuff, but drinks yes"),
        ],
    },
]

GROUP_MEMBERS = [
    ("user314159265", "Marta Yezerska"),
    ("user944444444", "Andriy Tkachuk-Vovk"),
    ("user211111111", "Danylo Shulha"),
    ("user161803398", "Nazar Hlibovych"),
    (OWNER_ID, OWNER_NAME),
]

GROUP_LINES = [
    "who's going to the meetup thursday?",
    "in 🙋", "can't, calls until 8", "same place as last time?",
    "someone bring the good stickers", "panel lineup looks strong this time",
    "afterparty intel appreciated", "i'll be late, save me a seat",
    "sharing the slides from tonight, solid talk", "next one should be on payments imo",
    "+1", "who was the speaker with the zk demo? want to connect",
]

SAVED_NOTES = [
    "read: modular thesis vs appchain thesis — form an opinion",
    "intro template v2: shorter, one ask, no buzzwords",
    "companies to watch: corridor payments, custody, listings infra",
    "book flights before prices jump",
    "grants angle — offer gtm help to funded teams",
    "gym: deload week next week",
    "draft: why warm intros beat cold apps 10:1",
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

    # Anchor positions: evenly spaced with jitter, kept in order.
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
    seq = seq[: max(n, len(seq))]

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
    n = 120
    times = timestamps(rng, n, now - timedelta(days=600), now - timedelta(days=4))
    messages = []
    for i, dt in enumerate(times):
        from_id, from_name = rng.choice(GROUP_MEMBERS)
        messages.append(make_message(5000 + i, dt, from_name, from_id, rng.choice(GROUP_LINES)))
    return {"name": "Lisbon Web3 Drinks 🍷", "type": "private_supergroup", "id": 1456789012, "messages": messages}


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
        "about": "This page lists all messages and chats from your Telegram account. (Fictional sample dataset — see sample-data/README.md)",
        "chats": {"about": "This page lists all your chats.", "list": chats},
    }
    out_path = Path(args.out)
    out_path.write_text(json.dumps(export, ensure_ascii=False, indent=1), encoding="utf-8")

    total = sum(len(c["messages"]) for c in chats)
    print(f"wrote {out_path} — {len(chats)} chats, {total} messages")
    print(f"{'name':<28} {'msgs':>5} {'last':>12} {'closeness':>9}")
    for p in PERSONAS:
        chat = next(c for c in chats if c["id"] == p["tg_id"])
        label = p["name"] or "(nameless)"
        print(f"{label:<28} {len(chat['messages']):>5} "
              f"{chat['messages'][-1]['date'][:10]:>12} "
              f"{closeness(len(chat['messages']), chat['messages'][-1]['date'], now):>9}")


if __name__ == "__main__":
    main()
