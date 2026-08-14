"""Tests for illegal-business takeover mission merge (anti double-dip income_mult)."""
from utils.ibm_takeover_merge import merge_ibm_baseline_maps, merge_ibm_completion_rows


def test_merge_completions_union_by_id():
    killer = [{"mission_id": "ibm_1", "completed_at": "a"}]
    victim = [
        {"mission_id": "ibm_1", "completed_at": "b"},
        {"mission_id": "ibm_2", "completed_at": "c"},
    ]
    merged = merge_ibm_completion_rows(killer, victim)
    by_id = {r["mission_id"]: r for r in merged}
    assert set(by_id) == {"ibm_1", "ibm_2"}
    assert by_id["ibm_1"]["completed_at"] == "a"  # killer wins
    assert by_id["ibm_2"].get("via_takeover") is True


def test_merge_baselines_keeps_killer_only():
    killer = {"ibm_3": {"guards_hired": 1}}
    victim = {"ibm_3": {"guards_hired": 9}, "ibm_4": {"crimes_in_state": 2000}}
    merged = merge_ibm_baseline_maps(killer, victim)
    assert merged == {"ibm_3": {"guards_hired": 1}}
    assert "ibm_4" not in merged
