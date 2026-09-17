"""Silent Video Poker audit: GhostFace, $100 bets, Jacks-or-Better strategy. Read-only report (no code changes)."""
from __future__ import annotations

import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import List, Tuple

import httpx
from jose import jwt
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
SECRET = (os.environ.get("JWT_SECRET_KEY") or "").strip()
BASE = "http://127.0.0.1:8000"
BET = 100
HANDS = 80  # enough for signal without huge noise; ~$8k max stake exposure
GF = "GhostFace"

RANK = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14}


def card_key(c) -> str:
    if isinstance(c, dict):
        return f"{c.get('value')}{c.get('suit')}"
    return str(c)


def parse_card(c) -> Tuple[str, str]:
    if isinstance(c, dict):
        return str(c.get("value")), str(c.get("suit"))
    s = str(c)
    if s.startswith("10"):
        return "10", s[2:]
    return s[0], s[1:]


def tok(uid, ver=0):
    t = jwt.encode(
        {"sub": uid, "exp": datetime.now(timezone.utc) + timedelta(hours=1), "v": int(ver or 0)},
        SECRET,
        algorithm="HS256",
    )
    return t.decode() if isinstance(t, bytes) else t


def job_holds(hand: List) -> List[int]:
    """Pragmatic Jacks-or-Better hold strategy (not full solver; solid for audit)."""
    cards = [parse_card(c) for c in hand]
    vals = [v for v, _ in cards]
    suits = [s for _, s in cards]
    ranks = [RANK[v] for v in vals]
    by_val = Counter(vals)
    by_suit = Counter(suits)
    counts = sorted(by_val.values(), reverse=True)

    if counts and counts[0] >= 4:
        v = next(v for v, n in by_val.items() if n >= 4)
        return [i for i, (vv, _) in enumerate(cards) if vv == v]
    if counts[:2] == [3, 2]:
        return list(range(5))
    if counts and counts[0] == 3:
        v = next(v for v, n in by_val.items() if n == 3)
        return [i for i, (vv, _) in enumerate(cards) if vv == v]
    if counts[:2] == [2, 2]:
        pair_vals = {v for v, n in by_val.items() if n == 2}
        return [i for i, (vv, _) in enumerate(cards) if vv in pair_vals]
    if counts and counts[0] == 2:
        v = next(v for v, n in by_val.items() if n == 2)
        return [i for i, (vv, _) in enumerate(cards) if vv == v]

    if max(by_suit.values()) == 5:
        return list(range(5))
    for suit, n in by_suit.items():
        if n == 4:
            return [i for i, (_, s) in enumerate(cards) if s == suit]

    uniq = sorted(set(ranks))
    if len(uniq) == 5 and (uniq[-1] - uniq[0] == 4 or set(uniq) == {14, 2, 3, 4, 5}):
        return list(range(5))

    high_idx = [i for i, (v, _) in enumerate(cards) if RANK[v] >= 11]
    if len(high_idx) >= 2:
        for i in high_idx:
            for j in high_idx:
                if i < j and cards[i][1] == cards[j][1]:
                    return [i, j]
        return high_idx[:2] if len(high_idx) > 2 else high_idx
    if len(high_idx) == 1:
        return high_idx
    return []


def main():
    user = db.users.find_one({"username": GF}, {"_id": 0, "id": 1, "token_version": 1, "money": 1, "current_state": 1, "in_jail": 1, "is_dead": 1})
    uid = user["id"]
    headers = {"Authorization": f"Bearer {tok(uid, user.get('token_version'))}"}
    city = user.get("current_state")
    money0 = float(user.get("money") or 0)

    findings = []
    print("=== SETUP ===")
    print(f"user={GF} city={city} money={money0:,.0f} jail={user.get('in_jail')} dead={user.get('is_dead')}")

    with httpx.Client(base_url=BASE, timeout=60.0) as h:
        # Clear stuck game if any (by finishing with hold-none would spend — instead report)
        g = h.get("/api/casino/videopoker/game", headers=headers)
        print("active_game", g.status_code, g.json() if g.status_code == 200 else g.text[:200])
        if g.status_code == 200 and g.json().get("status") == "deal":
            # Finish stuck hand hold-none so we can test cleanly (gameplay, not a code change)
            r = h.post("/api/casino/videopoker/draw", headers=headers, json={"holds": []})
            print("cleared_stuck", r.status_code, r.json().get("hand_name") or r.json().get("detail"))

        cfg = h.get("/api/casino/videopoker/config", headers=headers)
        own = h.get("/api/casino/videopoker/ownership", headers=headers)
        print("config", cfg.status_code)
        if cfg.status_code == 200:
            c = cfg.json()
            print("  default_preset", c.get("default_odds_preset") or c.get("default_preset"))
            print("  presets", list((c.get("pay_tables") or c.get("odds_presets") or {}).keys())[:8])
            print("  keys", list(c.keys()))
        print("ownership", own.status_code)
        o = own.json() if own.status_code == 200 else {}
        print("  city", o.get("city"), "owner", o.get("owner_username") or o.get("owner_id"), "is_owner", o.get("is_owner"), "max_bet", o.get("max_bet"), "preset", o.get("odds_preset"))
        if o.get("is_owner"):
            findings.append("BLOCKED: GhostFace owns this city's video poker table — cannot play own table.")
            print("ABORT: owns table")
            return

        # Probe invalid bets
        for bad in [0, -1, 999999999999]:
            r = h.post("/api/casino/videopoker/deal", headers=headers, json={"bet": bad})
            print(f"probe bet={bad}", r.status_code, r.json().get("detail") or r.json().get("message"))

        hand_counts = Counter()
        mult_sum = 0.0
        payout_sum = 0
        bet_sum = 0
        errors = []
        deal_eval_vs_draw = []
        hold_all_tests = []
        money_before = float(db.users.find_one({"id": uid}, {"money": 1})["money"])

        for n in range(HANDS):
            d = h.post("/api/casino/videopoker/deal", headers=headers, json={"bet": BET})
            if d.status_code != 200:
                errors.append(("deal", n, d.status_code, d.json()))
                # if unfinished game, try clear
                if "Finish" in str(d.json()):
                    h.post("/api/casino/videopoker/draw", headers=headers, json={"holds": []})
                continue
            dj = d.json()
            hand = dj.get("hand") or []
            if len(hand) != 5:
                errors.append(("deal_hand_len", n, len(hand), hand))
            # unique cards in hand
            if len(set(card_key(c) for c in hand)) != len(hand):
                errors.append(("deal_dup_cards", n, hand))
                findings.append(f"Duplicate cards on deal hand #{n}: {hand}")

            holds = job_holds(hand)
            # Spot-check: if deal already shows paying hand name and we hold all winners path
            w = h.post("/api/casino/videopoker/draw", headers=headers, json={"holds": holds})
            if w.status_code != 200:
                errors.append(("draw", n, w.status_code, w.json()))
                continue
            wj = w.json()
            hk = wj.get("hand_key") or "nothing"
            hand_counts[hk] += 1
            payout = int(wj.get("payout") or 0)
            mult = float(wj.get("multiplier") or 0)
            payout_sum += payout
            bet_sum += BET
            mult_sum += mult
            final_hand = wj.get("hand") or []
            # Held cards must survive
            for i in holds:
                if i < len(hand) and i < len(final_hand) and card_key(hand[i]) != card_key(final_hand[i]):
                    findings.append(f"HOLD BROKEN hand#{n} idx={i} {hand[i]}->{final_hand[i]}")
                    errors.append(("hold_broken", n, i, hand, final_hand))

            # Payout math check
            if abs(payout - int(round(BET * mult))) > 0 and mult > 0:
                findings.append(f"Payout math mismatch hand#{n}: payout={payout} bet*mult={round(BET*mult)} mult={mult}")

        # Hold-all when dealt a pat paying hand? Separate 10 deals: if deal eval pays, hold all and expect same mult (unless already nothing)
        for n in range(15):
            d = h.post("/api/casino/videopoker/deal", headers=headers, json={"bet": BET})
            if d.status_code != 200:
                continue
            dj = d.json()
            hand = dj.get("hand") or []
            dkey = dj.get("hand_key")
            dmult = float(dj.get("multiplier") or 0)
            if dmult > 0:
                w = h.post("/api/casino/videopoker/draw", headers=headers, json={"holds": [0, 1, 2, 3, 4]})
                wj = w.json() if w.status_code == 200 else {}
                hold_all_tests.append({
                    "deal": dkey,
                    "deal_mult": dmult,
                    "final": wj.get("hand_key"),
                    "final_mult": wj.get("multiplier"),
                    "payout": wj.get("payout"),
                    "hand_same": [card_key(x) for x in hand] == [card_key(x) for x in (wj.get("hand") or [])],
                })
            else:
                # still finish
                h.post("/api/casino/videopoker/draw", headers=headers, json={"holds": job_holds(hand)})

        money_after = float(db.users.find_one({"id": uid}, {"money": 1})["money"])
        delta = money_after - money_before
        hands_played = sum(hand_counts.values())
        rtp = (payout_sum / bet_sum) if bet_sum else 0

        print("\n=== SESSION ($100 bets) ===")
        print(f"strategy_hands={hands_played} stake={bet_sum:,} returned={payout_sum:,} net={payout_sum - bet_sum:,} RTP={rtp*100:.1f}%")
        print(f"wallet_delta={delta:,.0f} (includes hold-all probes)")
        print("hand_distribution:")
        for k, v in hand_counts.most_common():
            print(f"  {k:20} {v:4} ({100*v/max(1,hands_played):.1f}%)")

        print("\n=== HOLD-ALL PAT HANDS ===")
        for row in hold_all_tests:
            print(row)
            if row.get("deal_mult", 0) > 0 and not row.get("hand_same"):
                findings.append(f"Hold-all changed cards on pat {row}")
            if row.get("deal_mult", 0) > 0 and float(row.get("final_mult") or 0) != float(row["deal_mult"]):
                # Secret miss cannot fire when holding all — must match
                findings.append(f"Hold-all payout mismatch on pat hand: {row}")

        print("\n=== ERRORS ===")
        print(f"count={len(errors)}")
        for e in errors[:12]:
            print(e)

        # Theoretical notes from code
        print("\n=== CODE CONTRACT (from video_poker.py) ===")
        print("Game: Jacks or Better")
        print("Default odds preset: tight (8/5 JoB)")
        print("Deal: fair shuffle")
        print("Draw: optional post-draw calibration (admin); hold-all immune")
        print("House edge scrap: 0.05% of bet to state head on losses when owned")
        print("Payout = round(bet * multiplier); stake taken on deal")

        print("\n=== FINDINGS ===")
        if not findings and not errors:
            print("No functional defects observed in this silent session.")
        for f in findings:
            print("-", f)
        if errors:
            print(f"- {len(errors)} request/hand anomalies (see ERRORS)")

        # Ownership / bankroll sanity
        own2 = h.get("/api/casino/videopoker/ownership", headers=headers).json()
        print("\nownership_after_preset", own2.get("odds_preset"), "max_bet", own2.get("max_bet"))


if __name__ == "__main__":
    main()
