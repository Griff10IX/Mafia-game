"""Redact Quick Trade counterparty names on transfer rows (hide_name / anonymous listings)."""

QT_ANONYMOUS = "[Anonymous]"


def redact_quicktrade_party_names(doc: dict, viewer_user_id: str) -> dict:
    """
    Shallow-copy doc and replace from_username / to_username when qt_anonymize_* applies
    and the viewer is not that party (they always see their own real name from DB).
    """
    out = dict(doc)
    uid = str(viewer_user_id or "")
    fid = str(doc.get("from_user_id") or "")
    tid = str(doc.get("to_user_id") or "")
    if doc.get("qt_anonymize_from") and fid and uid != fid:
        out["from_username"] = QT_ANONYMOUS
    if doc.get("qt_anonymize_to") and tid and uid != tid:
        out["to_username"] = QT_ANONYMOUS
    return out
