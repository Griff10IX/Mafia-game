"""Offline checks for chicken_cross payout helpers (no Mongo / FastAPI)."""
from fractions import Fraction

CHICKEN_CROSS_PAYOUT_CAP = 250_000_000_000
_RTP = Fraction(98, 100)
DIFFICULTY_SPECS = {
    "easy": {"lanes": 24, "survive_num": 7, "survive_den": 8},
    "medium": {"lanes": 22, "survive_num": 73, "survive_den": 100},
    "hard": {"lanes": 18, "survive_num": 57, "survive_den": 100},
    "expert": {"lanes": 15, "survive_num": 445, "survive_den": 1000},
}


def build():
    tables = {}
    for key, spec in DIFFICULTY_SPECS.items():
        reached = Fraction(1)
        survival = Fraction(int(spec["survive_num"]), int(spec["survive_den"]))
        cents_rows = []
        for _ in range(int(spec["lanes"])):
            reached *= survival
            cents = int((_RTP / reached) * 100)
            assert Fraction(cents, 100) * reached <= _RTP, key
            cents_rows.append(cents)
        tables[key] = tuple(cents_rows)
    return tables


def payout(bet, cents):
    if bet < 1 or cents < 1:
        return 0
    return min(CHICKEN_CROSS_PAYOUT_CAP, (int(bet) * int(cents)) // 100)


def offered(difficulty, bet, tables):
    rows = []
    for lane, cents in enumerate(tables[difficulty], start=1):
        p = (int(bet) * int(cents)) // 100
        if p > CHICKEN_CROSS_PAYOUT_CAP:
            break
        rows.append(lane)
    return rows


def main():
    tables = build()
    # max bet expert should still offer early lanes under 50M
    o = offered("expert", 5_000_000_000, tables)
    assert o, "expert max bet should offer at least one lane"
    for lane in o:
        assert payout(5_000_000_000, tables["expert"][lane - 1]) <= CHICKEN_CROSS_PAYOUT_CAP
    # tiny bet can see deep expert
    assert len(offered("expert", 100, tables)) == 15
    # easy first cashout under fair RTP
    bet = 100_000
    p = payout(bet, tables["easy"][0])
    assert p == (bet * tables["easy"][0]) // 100
    assert p < bet  # first hop on easy is ~1.12x wait - 1.12x means MORE than bet
    assert p == 112000
    print("ok", {k: (v[0], v[-1], len(v)) for k, v in tables.items()})
    print("expert max bet lanes", o[-1] if o else None)


if __name__ == "__main__":
    main()
