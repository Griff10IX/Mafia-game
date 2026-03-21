"""
Shared validation for user-supplied raster images (custom car URL, image host, etc.).
Allows JPEG, PNG, GIF, WebP only; blocks SVG, HTML, SSRF targets for remote URLs.
"""
from __future__ import annotations

import base64
import ipaddress
import re
import socket
from typing import Optional
from urllib.parse import urlparse

import httpx

CAR_IMAGE_ALLOWED_TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})
CAR_IMAGE_MAX_DATA_URL_BYTES = 300_000
CAR_IMAGE_MAX_REMOTE_BYTES = 2_000_000
CAR_IMAGE_PROBE_READ_BYTES = 65536

MIME_TO_FILE_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
}


def sniff_image_mime(data: bytes) -> Optional[str]:
    if len(data) < 12:
        return None
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "image/gif"
    if data.startswith(b"RIFF") and b"WEBP" in data[:16]:
        return "image/webp"
    return None


def verify_image_magic_bytes(data: bytes, declared_mime: Optional[str]) -> tuple[bool, str]:
    """Ensure raw bytes are JPEG, PNG, GIF, or WebP. Optional declared_mime must match sniff."""
    if len(data) < 12:
        return False, "Invalid or empty image file"

    sniffed = sniff_image_mime(data)
    if sniffed is None:
        return False, "File must be a real JPEG, PNG, GIF, or WebP image (executables and web pages are blocked)"

    if declared_mime and declared_mime in CAR_IMAGE_ALLOWED_TYPES and declared_mime != sniffed:
        return False, "Image data does not match declared type"

    return True, ""


def verify_uploaded_file_bytes(data: bytes, content_type_header: Optional[str]) -> tuple[Optional[str], str]:
    """Validate multipart upload body. Returns (mime_for_storage, error_message)."""
    if len(data) > CAR_IMAGE_MAX_REMOTE_BYTES:
        return None, f"Image too large (max {CAR_IMAGE_MAX_REMOTE_BYTES // 1_000_000}MB)"

    decl: Optional[str] = None
    if content_type_header:
        c = content_type_header.split(";")[0].strip().lower()
        if c in CAR_IMAGE_ALLOWED_TYPES:
            decl = c

    ok, err = verify_image_magic_bytes(data, decl)
    if not ok:
        return None, err

    mime = sniff_image_mime(data)
    assert mime is not None
    return mime, ""


def validate_car_image_data_url(url: str) -> tuple[bool, str]:
    """Validate data:image/...;base64,..."""
    if not url.lower().startswith("data:image/"):
        return False, "Data URLs must be images"

    match = re.match(r"^data:(image/[a-zA-Z0-9+-]+);base64,(.+)$", url, re.IGNORECASE)
    if not match:
        return False, "Invalid data URL format"

    mime_type = match.group(1).lower()
    b64_data = match.group(2)

    if "svg" in mime_type:
        return False, "SVG is not allowed (security)"

    if mime_type not in CAR_IMAGE_ALLOWED_TYPES:
        return False, "Only JPEG, PNG, GIF, and WebP images are allowed"

    if not re.match(r"^[A-Za-z0-9+/=\s]+$", b64_data.replace("\n", "").replace("\r", "")):
        return False, "Invalid base64 encoding"

    try:
        decoded = base64.b64decode(re.sub(r"\s+", "", b64_data))
    except Exception:
        return False, "Failed to decode image data"

    return verify_image_magic_bytes(decoded, mime_type)


def car_image_url_host_is_public(url: str) -> tuple[bool, str]:
    """Reject SSRF: only globally routable resolved IPs."""
    parsed = urlparse(url)
    host = parsed.hostname
    if not host:
        return False, "Invalid image URL"
    if parsed.username is not None or parsed.password is not None:
        return False, "Image URL must not include credentials"

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return False, "Could not resolve image URL host"

    seen: set[str] = set()
    for info in infos:
        ip_str = info[4][0]
        if ip_str in seen:
            continue
        seen.add(ip_str)
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if not ip.is_global:
            return False, "Image URL host is not allowed"

    if not seen:
        return False, "Could not resolve image URL host"
    return True, ""


async def validate_car_image_http_url(url: str) -> tuple[bool, str]:
    """Probe remote URL: headers + first chunk, magic bytes."""
    url_stripped = url.strip()
    low = url_stripped.lower()
    if not (low.startswith("https://") or low.startswith("http://")):
        return False, "Image URL must use https:// or http://"

    parsed = urlparse(url_stripped)
    if parsed.scheme not in ("http", "https"):
        return False, "Image URL must use https:// or http://"

    ok_host, host_err = car_image_url_host_is_public(url_stripped)
    if not ok_host:
        return False, host_err

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; MafiaWarsImageValidator/1.0)",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }

    data = b""
    ct_raw = ""
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(12.0),
            follow_redirects=True,
            limits=httpx.Limits(max_keepalive_connections=0, max_connections=1),
        ) as client:
            async with client.stream("GET", url_stripped, headers=headers) as r:
                if r.status_code not in (200, 206):
                    return False, f"Image URL returned HTTP {r.status_code}"

                ok_final, err_final = car_image_url_host_is_public(str(r.url))
                if not ok_final:
                    return False, err_final

                cl = r.headers.get("content-length")
                if cl is not None:
                    try:
                        if int(cl) > CAR_IMAGE_MAX_REMOTE_BYTES:
                            return False, "Image file too large (max 2MB)"
                    except ValueError:
                        pass

                ct_raw = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
                if ct_raw and ct_raw not in CAR_IMAGE_ALLOWED_TYPES and ct_raw != "application/octet-stream":
                    return False, "URL must serve a JPEG, PNG, GIF, or WebP image"

                chunks: list[bytes] = []
                total = 0
                async for chunk in r.aiter_bytes():
                    if not chunk:
                        continue
                    chunks.append(chunk)
                    total += len(chunk)
                    if total >= CAR_IMAGE_PROBE_READ_BYTES:
                        break

                data = b"".join(chunks)[:CAR_IMAGE_PROBE_READ_BYTES]
    except httpx.RequestError:
        return False, "Could not download image from URL"

    declared = ct_raw if ct_raw in CAR_IMAGE_ALLOWED_TYPES else None
    ok_magic, magic_err = verify_image_magic_bytes(data, declared)
    if not ok_magic:
        return False, magic_err

    return True, ""


async def download_remote_image_full(url: str) -> tuple[Optional[bytes], str]:
    """Download full image after the same checks as validate_car_image_http_url (single GET, capped size)."""
    url_stripped = url.strip()
    low = url_stripped.lower()
    if not (low.startswith("https://") or low.startswith("http://")):
        return None, "Image URL must use https:// or http://"

    parsed = urlparse(url_stripped)
    if parsed.scheme not in ("http", "https"):
        return None, "Invalid URL"

    ok_host, host_err = car_image_url_host_is_public(url_stripped)
    if not ok_host:
        return None, host_err

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; MafiaWarsImageFetch/1.0)",
        "Accept": "image/*,*/*;q=0.8",
    }

    ct_raw = ""
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(20.0),
            follow_redirects=True,
            limits=httpx.Limits(max_keepalive_connections=0, max_connections=1),
        ) as client:
            async with client.stream("GET", url_stripped, headers=headers) as r:
                if r.status_code not in (200, 206):
                    return None, f"Image URL returned HTTP {r.status_code}"

                ok_final, err_final = car_image_url_host_is_public(str(r.url))
                if not ok_final:
                    return None, err_final

                cl = r.headers.get("content-length")
                if cl is not None:
                    try:
                        if int(cl) > CAR_IMAGE_MAX_REMOTE_BYTES:
                            return None, "Image file too large (max 2MB)"
                    except ValueError:
                        pass

                ct_raw = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
                if ct_raw and ct_raw not in CAR_IMAGE_ALLOWED_TYPES and ct_raw != "application/octet-stream":
                    return None, "URL must serve a JPEG, PNG, GIF, or WebP image"

                data = bytearray()
                async for chunk in r.aiter_bytes():
                    if not chunk:
                        continue
                    data.extend(chunk)
                    if len(data) > CAR_IMAGE_MAX_REMOTE_BYTES:
                        return None, "Image file too large (max 2MB)"

                body = bytes(data)
    except httpx.RequestError:
        return None, "Could not download image from URL"

    declared = ct_raw if ct_raw in CAR_IMAGE_ALLOWED_TYPES else None
    ok_magic, magic_err = verify_image_magic_bytes(body, declared)
    if not ok_magic:
        return None, magic_err

    return body, ""


async def validate_custom_car_image_value(url: str) -> tuple[bool, str]:
    """Full validation for stored custom car image (data URL or http(s) link)."""
    if not url or not str(url).strip():
        return False, "No URL provided"

    url = str(url).strip()
    low = url.lower()
    if low.startswith("javascript:") or low.startswith("vbscript:") or low.startswith("data:text/"):
        return False, "Invalid URL"

    if url.lower().startswith("data:"):
        return validate_car_image_data_url(url)

    return await validate_car_image_http_url(url)
