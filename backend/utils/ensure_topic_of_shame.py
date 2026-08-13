"""
Create forum topic "Topic of Shame" from docs/TOPIC_OF_SHAME.md on backend startup (Motor async).

Insert-only on create: if the topic already exists, leave it unchanged so in-game staff edits survive deploys.
Wipe / IP-ban helpers prepend new automated entries without replacing the rest.
Disable with env TOPIC_OF_SHAME_SYNC=0.
"""
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from utils.faq_topic_author import resolve_faq_topic_author_async
from utils.ip_normalize import normalize_ip_string

logger = logging.getLogger(__name__)

TOPIC_TITLE = "Topic of Shame"
_TITLE_RE = {"$regex": r"^topic\s+of\s+shame$", "$options": "i"}
_TAG_RE = re.compile(r"[\[\]<>]")
_WS_RE = re.compile(r"\s+")
_INTRO_INNER_RE = re.compile(
    r"(\[quote\]\s*\[color=#AAAAAA\])(.*?)(\[/color\]\s*\[/quote\])",
    re.IGNORECASE | re.DOTALL,
)
_IPV4_IN_TEXT_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b")
_IPV6_IN_TEXT_RE = re.compile(
    r"\b(?:\[)?(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?:\].[^\s]*)?(?:\](?::\d{1,5})?)?\b",
    re.IGNORECASE,
)
SHAME_INTRO = (
    "Posts here are automated. Staff kills, wipes, and IP bans — duration and reason when given. "
    "Anyone caught playing with a banned user will be modkilled (wipe). "
    "Proof is summarized so it does not help anyone copy the method. Staff only — this topic is locked."
)


def _shame_path() -> Path:
    backend_dir = Path(__file__).resolve().parent.parent
    project_root = backend_dir.parent
    return project_root / "docs" / "TOPIC_OF_SHAME.md"


def _load_shame_body() -> Optional[str]:
    path = _shame_path()
    if not path.is_file():
        return None
    try:
        raw = path.read_text(encoding="utf-8").strip()
        return raw or None
    except OSError as e:
        logger.warning("ensure_topic_of_shame: could not read %s: %s", path, e)
        return None


async def ensure_topic_of_shame_forum_topic(db) -> None:
    if (os.environ.get("TOPIC_OF_SHAME_SYNC") or "").strip().lower() in ("0", "false", "no"):
        logger.info("ensure_topic_of_shame: skipped (TOPIC_OF_SHAME_SYNC=0)")
        return

    existing = await db.forum_topics.find_one({"title": _TITLE_RE}, {"_id": 1, "id": 1})
    if existing:
        logger.debug("ensure_topic_of_shame: '%s' already exists; not overwriting", TOPIC_TITLE)
        return

    body = _load_shame_body()
    if not body:
        logger.info("ensure_topic_of_shame: no docs/TOPIC_OF_SHAME.md found; skipping")
        return

    now = datetime.now(timezone.utc).isoformat()
    author_id, author_username = await resolve_faq_topic_author_async(db)
    doc = {
        "id": str(uuid.uuid4()),
        "title": TOPIC_TITLE,
        "content": body,
        "category": "general",
        "author_id": author_id,
        "author_username": author_username,
        "created_at": now,
        "updated_at": now,
        "views": 0,
        "is_sticky": True,
        "is_important": True,
        "is_locked": True,
        "prune_exempt": True,
    }
    await db.forum_topics.insert_one(doc)
    logger.info("ensure_topic_of_shame: created '%s' from docs/TOPIC_OF_SHAME.md", TOPIC_TITLE)


def _bbcode_safe(raw) -> str:
    s = str(raw or "")
    s = _TAG_RE.sub("", s)
    s = s.replace("\r", " ").replace("\n", " ")
    return _WS_RE.sub(" ", s).strip()


def _token_is_ip(token: str) -> bool:
    t = (token or "").strip().strip(".,;:()[]<>\"'")
    return bool(t and normalize_ip_string(t))


def strip_ips_from_text(raw: str) -> str:
    """Remove IPv4/IPv6 addresses from Shame text. Never post an IP on this topic."""
    s = str(raw or "")
    if not s:
        return ""

    def _drop_if_ip(m: re.Match) -> str:
        return "" if _token_is_ip(m.group(0)) else m.group(0)

    s = _IPV4_IN_TEXT_RE.sub(_drop_if_ip, s)
    s = _IPV6_IN_TEXT_RE.sub(_drop_if_ip, s)
    parts = re.split(r"(\s+)", s)
    kept = []
    for p in parts:
        if p.isspace() or not p:
            kept.append(p)
            continue
        if _token_is_ip(p):
            continue
        kept.append(p)
    return _WS_RE.sub(" ", "".join(kept)).strip()


def apply_shame_intro(body: str) -> str:
    text = body or ""
    if _INTRO_INNER_RE.search(text):
        return _INTRO_INNER_RE.sub(lambda m: m.group(1) + SHAME_INTRO + m.group(3), text, count=1)
    return text


def insert_shame_entry(body: str, entry: str) -> str:
    text = (body or "").rstrip()
    marker = "[hr]"
    idx = text.lower().find(marker.lower())
    if idx >= 0:
        split_at = idx + len(marker)
        head = text[:split_at].rstrip()
        tail = text[split_at:].lstrip()
        return f"{head}\n\n{entry.strip()}\n\n{tail}".rstrip() + "\n"
    return f"{text}\n\n{entry.strip()}\n"


async def prepend_topic_of_shame_bbcode(db, entry: str) -> bool:
    """Prepend a player-safe BBCode entry (no IPs) on the locked topic + docs if writable."""
    await ensure_topic_of_shame_forum_topic(db)
    topic = await db.forum_topics.find_one({"title": _TITLE_RE}, {"_id": 0, "id": 1, "content": 1})
    if not topic:
        logger.warning("topic of shame: missing after ensure")
        return False
    now = datetime.now(timezone.utc).isoformat()
    entry = strip_ips_from_text(entry)
    if not (entry or "").strip():
        return False
    new_content = apply_shame_intro(insert_shame_entry(topic.get("content") or "", entry))
    await db.forum_topics.update_one(
        {"id": topic["id"]},
        {"$set": {"content": new_content, "updated_at": now}},
    )
    try:
        path = _shame_path()
        if path.is_file():
            path.write_text(
                apply_shame_intro(insert_shame_entry(path.read_text(encoding="utf-8"), entry)),
                encoding="utf-8",
            )
    except OSError as e:
        logger.warning("topic of shame: could not update docs/TOPIC_OF_SHAME.md: %s", e)
    return True


def ip_ban_shame_bbcode(*, username: str, duration_label: str, reason: str = "") -> str:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    dur = strip_ips_from_text(_bbcode_safe(duration_label)) or "permanent"
    lines = [
        "[*][color=#888888][b]Action:[/b] IP ban.[/color]",
        f"[*][color=#888888][b]Duration:[/b] {dur}[/color]",
    ]
    why = strip_ips_from_text(_bbcode_safe(reason))
    if why:
        lines.append(f"[*][color=#888888][b]Reason:[/b] {why}[/color]")
    lines.append(
        "[*][color=#888888][b]Warning:[/b] Anyone caught playing with a banned user "
        "will be [b]modkilled[/b] (wipe).[/color]"
    )
    inner = "\n".join(lines)
    return (
        f"[size=1.5][b][color=#E74C3C]{day}[/color][/b] — [b]{_bbcode_safe(username)}[/b][/size]\n"
        "[quote]\n"
        "[list]\n"
        f"{inner}\n"
        "[/list]\n"
        "[/quote]\n"
    )


async def append_ip_ban_shame_entry(
    db,
    *,
    username: str,
    duration_label: str,
    reason: str = "",
) -> bool:
    """One automated Shame row per username IP-ban. Omits reason when blank. Never includes the IP."""
    uname = strip_ips_from_text(_bbcode_safe(username))
    if not uname or _token_is_ip(uname):
        return False
    ok = await prepend_topic_of_shame_bbcode(
        db,
        ip_ban_shame_bbcode(username=uname, duration_label=duration_label, reason=reason),
    )
    if ok:
        logger.info("topic of shame: IP ban entry for %s", uname)
    return ok
