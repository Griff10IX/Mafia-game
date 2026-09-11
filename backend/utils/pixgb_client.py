"""Server-side PixGB API client for Mafia Wars image-host uploads.

Uses one shared Free-plan account (PIXGB_API_TOKEN). Per-player caps stay in image_host.py.
Never expose the token to the browser.
"""
from __future__ import annotations

import os
from typing import Any, Optional

import httpx

_DEFAULT_BASE = "https://pixgb.com"
_TIMEOUT = 45.0


class PixGbError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def api_token() -> str:
    return (os.environ.get("PIXGB_API_TOKEN") or "").strip()


def api_base() -> str:
    return (os.environ.get("PIXGB_API_BASE") or _DEFAULT_BASE).strip().rstrip("/")


def enabled() -> bool:
    return bool(api_token())


def _headers() -> dict[str, str]:
    return {"X-Api-Token": api_token()}


def _error_message(payload: Any, fallback: str) -> str:
    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])
        if payload.get("error_message"):
            return str(payload["error_message"])
        if payload.get("detail"):
            return str(payload["detail"])
    return fallback


async def upload_bytes(
    data: bytes,
    filename: str,
    mime: str,
    *,
    custom_slug: Optional[str] = None,
    tags: str = "mafiawars",
) -> dict:
    """Upload to the shared Free account. Raises PixGbError on quota / API failure."""
    if not enabled():
        raise PixGbError("PixGB API token is not configured.", 503)
    files = {"file": (filename or "image.bin", data, mime or "application/octet-stream")}
    form: dict[str, str] = {"tags": tags, "isPrivate": "false"}
    if custom_slug:
        form["customSlug"] = custom_slug
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(
            f"{api_base()}/api/v1/upload",
            headers=_headers(),
            files=files,
            data=form,
        )
    payload = {}
    try:
        payload = r.json()
    except Exception:
        payload = {}
    if r.status_code >= 400 or not payload.get("success"):
        raise PixGbError(_error_message(payload, f"PixGB upload failed (HTTP {r.status_code})."), r.status_code if r.status_code >= 400 else 400)
    data_obj = payload.get("data") or {}
    short = data_obj.get("short_code")
    if not short:
        raise PixGbError("PixGB upload succeeded but returned no short code.")
    return {
        "short_code": short,
        "custom_slug": data_obj.get("custom_slug"),
        "page_url": data_obj.get("page_url") or data_obj.get("url"),
        "direct_url": data_obj.get("direct_url") or data_obj.get("display_url"),
        "thumb_url": (data_obj.get("thumb") or {}).get("url") or data_obj.get("thumb_url"),
        "delete_url": data_obj.get("delete_url"),
        "size": data_obj.get("size"),
    }


async def delete_short_code(short_code: str) -> None:
    if not enabled() or not short_code:
        return
    async with httpx.AsyncClient(timeout=20.0) as client:
        await client.delete(
            f"{api_base()}/api/v1/images/{short_code}",
            headers=_headers(),
        )
