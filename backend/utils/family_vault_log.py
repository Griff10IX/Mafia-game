"""Append-only ledger rows for family treasury (vault) movements — deposits, melts, raids, etc."""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


async def log_family_vault_tx(
    db,
    family_id: str,
    kind: str,
    actor_user_id: str,
    actor_username: str,
    *,
    cash_delta: int = 0,
    bullets_delta: int = 0,
    points_delta: int = 0,
    loot_delta: int = 0,
    target_user_id: Optional[str] = None,
    target_username: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    """Record a vault change. Deltas are from the vault's perspective (positive = in, negative = out)."""
    if not family_id or not kind:
        return
    doc: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "family_id": family_id,
        "at": datetime.now(timezone.utc).isoformat(),
        "kind": kind,
        "actor_user_id": actor_user_id or "",
        "actor_username": (actor_username or "?").strip() or "?",
        "cash_delta": int(cash_delta),
        "bullets_delta": int(bullets_delta),
        "points_delta": int(points_delta),
        "loot_delta": int(loot_delta),
    }
    if target_user_id:
        doc["target_user_id"] = target_user_id
    if target_username:
        doc["target_username"] = target_username
    if meta:
        doc["meta"] = meta
    try:
        await db.family_vault_transactions.insert_one(doc)
    except Exception:
        logger.exception("family_vault_transactions insert failed family_id=%s kind=%s", family_id, kind)
