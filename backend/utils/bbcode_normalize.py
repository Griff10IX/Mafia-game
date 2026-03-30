"""Normalize common BBCode typos for [img] / [gif] before parsing or ImgBB resolution."""

from __future__ import annotations

import re


def normalize_bbcode_media_typos(text: str) -> str:
    """
    Fix mistakes like [img/] instead of [/img], extra spaces in tags, doubled opens/closes.
    Keeps behaviour conservative: only normalizes known media tag shapes.
    """
    if not text or ("[img" not in text.lower() and "[gif" not in text.lower()):
        return text
    t = text
    for tag in ("img", "gif"):
        t = re.sub(rf"\[\s*{tag}\s*/\s*\]", f"[/{tag}]", t, flags=re.I)
        t = re.sub(rf"\[\s*/\s*{tag}\s*/\s*\]", f"[/{tag}]", t, flags=re.I)
        t = re.sub(rf"\[\s*/\s*{tag}\s*\]", f"[/{tag}]", t, flags=re.I)
        t = re.sub(rf"\[\s*{tag}\s*\]", f"[{tag}]", t, flags=re.I)
    prev = None
    while prev != t:
        prev = t
        t = re.sub(r"\[img\]\s*\[img\]", "[img]", t, flags=re.I)
        t = re.sub(r"\[gif\]\s*\[gif\]", "[gif]", t, flags=re.I)
        t = re.sub(r"\[/img\]\s*\[/img\]", "[/img]", t, flags=re.I)
        t = re.sub(r"\[/gif\]\s*\[/gif\]", "[/gif]", t, flags=re.I)
    return t
