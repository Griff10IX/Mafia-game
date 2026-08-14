from utils.modkill_wipe import email_lineage_dead_wipe_targets


def test_email_lineage_dead_wipe_targets_skips_primary_living_and_already_wiped():
    primary_id = "piece"
    related = [
        {"id": "piece", "username": "Piece", "is_dead": True, "modkill_wipe": True},
        {"id": "moss", "username": "Moss", "is_dead": True, "modkill_wipe": False},
        {"id": "zug", "username": "Zugzwang", "is_dead": True, "modkill_wipe": False},
        {"id": "alive", "username": "NewAlt", "is_dead": False, "modkill_wipe": False},
        {"id": "staff", "username": "GhostFace", "is_dead": True, "modkill_wipe": False},
    ]
    names = [a["username"] for a in email_lineage_dead_wipe_targets(related, primary_id)]
    assert names == ["Moss", "Zugzwang"]
