"""Unit tests for Update Log entry parsing / unread counts."""
from utils.ensure_update_log_topic import (
    parse_update_log_entries,
    unread_update_log_count,
    current_update_log_hashes,
)


SAMPLE = """
[center][size=2][b]UPDATE LOG[/b][/size][/center]
[hr]
[size=1.5][b][color=#2ECC71]2026-07-22 00:25 UTC[/color][/b] — [b]Tonight's updates[/b][/size]
[quote]
[list]
[*][color=#888888][b]New:[/b] Thing A[/color]
[*][color=#888888][b]Changed:[/b] Thing B[/color]
[/list]
[/quote]
[hr]
[size=1.5][b][color=#2ECC71]2026-07-21 23:00 UTC[/color][/b] — [b]Store live[/b][/size]
[quote]
[list]
[*][color=#888888][b]New:[/b] Thing C[/color]
[/list]
[/quote]
"""


def test_parse_update_log_entries():
    entries = parse_update_log_entries(SAMPLE)
    assert len(entries) == 2
    assert entries[0]["id"] == "2026-07-22 00:25 UTC"
    assert entries[0]["title"] == "Tonight's updates"
    assert entries[0]["change_count"] == 2
    assert entries[1]["id"] == "2026-07-21 23:00 UTC"
    assert entries[1]["change_count"] == 1
    assert entries[0]["hash"] != entries[1]["hash"]


def test_unread_counts_new_and_modified():
    entries = parse_update_log_entries(SAMPLE)
    hashes = current_update_log_hashes(entries)
    assert unread_update_log_count(entries, None) == 0  # not seeded yet
    assert unread_update_log_count(entries, hashes) == 0
    assert unread_update_log_count(entries, []) == 3  # 2 + 1 bullets
    assert unread_update_log_count(entries, [hashes[1]]) == 2

    modified = [dict(entries[0], hash="deadbeef"), entries[1]]
    assert unread_update_log_count(modified, hashes) == 2
