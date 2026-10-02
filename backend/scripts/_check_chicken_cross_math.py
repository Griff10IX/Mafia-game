"""Offline checks for chicken_cross payout helpers (no Mongo / FastAPI)."""
from fractions import Fraction

CHICKEN_CROSS_PAYOUT_CAP = 250_000_000_000
_RTP = Fraction(98, 100)
DIFFICULTY_SPECS = {
    "easy": {"survive_num": 7, "survive_den": 8},
    "medium": {"survive_num": 73, "survive_den": 100},
    "hard": {"survive_num": 57, "survive_den": 100},
    "expert": {"survive_num": 445, "survive_den": 1000},
}


def build():
    tables = {}
    for key, spec in DIFFICULTY_SPECS.items():
        reached = Fraction(1)
        survival = Fraction(int(spec["survive_num"]), int(spec["survive_den"]))
        cents_rows = []
        while True:
            reached *= survival
            cents = int((_RTP / reached) * 100)
            assert Fraction(cents, 100) * reached <= _RTP, key
            cents_rows.append(cents)
            if cents // 100 > CHICKEN_CROSS_PAYOUT_CAP:
                break
        tables[key] = tuple(cents_rows)
    return tables


def payout(bet, cents):
    if bet < 1 or cents < 1:
        return 0
    return min(CHICKEN_CROSS_PAYOUT_CAP, (int(bet) * int(cents)) // 100)


def offered(difficulty, bet, tables):
    rows = []
    for lane, cents in enumerate(tables[difficulty], start=1):
        p = payout(bet, cents)
        rows.append((lane, p))
        if p >= CHICKEN_CROSS_PAYOUT_CAP:
            break
    return rows


def main():
    tables = build()
    for diff in tables:
        for bet in (1, 100_000, 2_000_000_000):
            o = offered(diff, bet, tables)
            assert o, (diff, bet)
            assert o[-1][1] == CHICKEN_CROSS_PAYOUT_CAP, (diff, bet, o[-1])
            assert all(p < CHICKEN_CROSS_PAYOUT_CAP for _, p in o[:-1])
            print(f"{diff:7} bet {bet:>13,}: road ends lane {o[-1][0]:>3} paying ${o[-1][1]:,}")
    assert payout(100_000, tables["easy"][0]) == 112000
    print("ok", {k: len(v) for k, v in tables.items()})


if __name__ == "__main__":
    main()
