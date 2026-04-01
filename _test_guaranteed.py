import math

MAX_MICRO_TIER = 100
GAMMA = 1.45

def tier_progress_mult(t):
    tt = max(1, min(MAX_MICRO_TIER, int(t)))
    return (tt / MAX_MICRO_TIER) ** (GAMMA - 1)

def reward_weight(t, base_tier):
    return (t / base_tier) * tier_progress_mult(t)

def test_total(target):
    base_tier = 100
    weights = [reward_weight(t, base_tier) for t in range(1, 101)]

    # Normalize: find base so sum(ceil(base * w)) ≈ target
    base = target / sum(weights) if sum(weights) else 1
    for _ in range(8):
        s = sum(math.ceil(base * w) for w in weights)
        if s <= 0:
            break
        base *= target / s

    amounts = [math.ceil(base * reward_weight(t, base_tier)) for t in range(1, 101)]
    total = sum(amounts)

    print(f"\n=== TARGET = {target} (actual total: {total}) ===")
    print(f"  Tier  1: {amounts[0]}    Tier 10: {amounts[9]}    Tier 20: {amounts[19]}    Tier 30: {amounts[29]}")
    print(f"  Tier 40: {amounts[39]}    Tier 50: {amounts[49]}    Tier 60: {amounts[59]}    Tier 70: {amounts[69]}")
    print(f"  Tier 80: {amounts[79]}    Tier 90: {amounts[89]}    Tier 95: {amounts[94]}   Tier 100: {amounts[99]}")
    print(f"  Total hours of auto-rank: {total * 2}h = {total * 2 / 24:.1f} days")

    # Show all
    bands = {}
    for i in range(10):
        band_sum = sum(amounts[i*10:(i+1)*10])
        bands[f"{i*10+1}-{(i+1)*10}"] = band_sum
    print(f"  Band totals: {bands}")

for t in [100, 150, 200, 250, 300]:
    test_total(t)
