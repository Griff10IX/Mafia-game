# User image hosting (Imgur-style): up to N images per user, stored under backend/uploads/image_host.
# Imports `server` inside register() only to avoid circular import during server startup.
import logging
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from utils.image_host_resize import maybe_resize_for_host, normalize_max_edge
from utils.image_upload_security import (
    MIME_TO_FILE_EXT,
    download_remote_image_full,
    verify_uploaded_file_bytes,
)

logger = logging.getLogger(__name__)

IMAGE_HOST_MAX_PER_USER = 10


class ImageHostImportRequest(BaseModel):
    url: str = Field(..., min_length=8, max_length=2048)
    max_edge: Optional[int] = None  # longest side px; optional preset
    is_public_gallery: bool = False

    @field_validator("max_edge", mode="before")
    @classmethod
    def _empty_max_edge(cls, v):
        if v in ("", None, False):
            return None
        return v

    @field_validator("max_edge")
    @classmethod
    def _valid_max_edge(cls, v):
        if v is None:
            return None
        try:
            return normalize_max_edge(int(v))
        except (TypeError, ValueError) as e:
            raise ValueError(str(e)) from e


class ImageVisibilityRequest(BaseModel):
    is_public_gallery: bool


def register(r) -> None:
    from server import (
        ROOT_DIR,
        _find_user_by_username_case_insensitive,
        db,
        get_current_user_verified,
        require_admin,
    )

    upload_root = ROOT_DIR / "uploads" / "image_host"
    gallery_max_edge = 640

    def _ensure_upload_root() -> None:
        upload_root.mkdir(parents=True, exist_ok=True)

    def _new_public_id() -> str:
        return secrets.token_urlsafe(9).replace("-", "_").replace("/", "_")[:16]

    async def _unique_public_id() -> str:
        for _ in range(12):
            pid = _new_public_id()
            exists = await db.image_host_uploads.find_one({"public_id": pid}, {"_id": 1})
            if not exists:
                return pid
        return uuid.uuid4().hex[:16]

    async def _count_active(user_id: str) -> int:
        return await db.image_host_uploads.count_documents({"user_id": user_id, "deleted_at": None})

    def _disk_path(user_id: str, public_id: str, ext: str) -> Path:
        user_dir = upload_root / user_id.replace("/", "_")
        user_dir.mkdir(parents=True, exist_ok=True)
        return user_dir / f"{public_id}.{ext}"

    def _coerce_bool(v) -> bool:
        if isinstance(v, bool):
            return v
        if v is None:
            return False
        if isinstance(v, (int, float)):
            return bool(v)
        s = str(v).strip().lower()
        return s in {"1", "true", "yes", "on"}

    def _gallery_disk_path(user_id: str, public_id: str, ext: str) -> Path:
        user_dir = upload_root / user_id.replace("/", "_")
        user_dir.mkdir(parents=True, exist_ok=True)
        return user_dir / f"{public_id}__gallery.{ext}"

    def _build_gallery_variant_bytes(data: bytes, mime: str) -> tuple[bytes, str]:
        try:
            resized, out_mime, _ = maybe_resize_for_host(data, mime, gallery_max_edge)
            return resized, out_mime
        except ValueError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Image upload failed during gallery resize: {str(e)}",
            ) from e

    def _safe_rel_to_abs(rel_path: str) -> Optional[Path]:
        if not rel_path:
            return None
        try:
            fp = (ROOT_DIR / rel_path).resolve()
            fp.relative_to(upload_root.resolve())
            return fp
        except Exception:
            return None

    async def list_my_images(current_user: dict = Depends(get_current_user_verified)):
        uid = current_user.get("id") or ""
        cur = db.image_host_uploads.find(
            {"user_id": uid, "deleted_at": None},
            {"_id": 0, "public_id": 1, "mime": 1, "size_bytes": 1, "original_filename": 1, "created_at": 1, "resize_max_edge": 1, "is_public_gallery": 1},
        ).sort("created_at", -1)
        items: List[dict] = []
        async for doc in cur:
            items.append(doc)
        return {"images": items, "count": len(items), "max": IMAGE_HOST_MAX_PER_USER}

    async def upload_image(
        file: UploadFile = File(...),
        max_edge: Optional[int] = Form(default=None),
        is_public_gallery: Optional[bool] = Form(default=False),
        current_user: dict = Depends(get_current_user_verified),
    ):
        _ensure_upload_root()
        uid = current_user.get("id") or ""
        if await _count_active(uid) >= IMAGE_HOST_MAX_PER_USER:
            raise HTTPException(
                status_code=400,
                detail=f"Maximum {IMAGE_HOST_MAX_PER_USER} hosted images. Delete one to upload more.",
            )

        max_edge_opt: Optional[int] = None
        if max_edge is not None:
            try:
                max_edge_opt = normalize_max_edge(int(max_edge))
            except (TypeError, ValueError) as e:
                raise HTTPException(status_code=400, detail=str(e)) from e

        raw = await file.read()
        mime, err = verify_uploaded_file_bytes(raw, file.content_type)
        if not mime or err:
            msg = err or "Invalid image file"
            if "too large" in msg.lower():
                msg = f"{msg}. Try selecting a smaller max size before upload."
            raise HTTPException(status_code=400, detail=msg)

        try:
            raw, mime, resize_meta = maybe_resize_for_host(raw, mime, max_edge_opt)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Image upload failed during resize: {str(e)}") from e

        ext = MIME_TO_FILE_EXT.get(mime)
        if not ext:
            raise HTTPException(status_code=400, detail="Unsupported image type")

        public_id = await _unique_public_id()
        path = _disk_path(uid, public_id, ext)
        try:
            path.write_bytes(raw)
        except OSError as e:
            logger.exception("image_host write failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to save image")

        gallery_raw, gallery_mime = _build_gallery_variant_bytes(raw, mime)
        gallery_ext = MIME_TO_FILE_EXT.get(gallery_mime)
        if not gallery_ext:
            raise HTTPException(status_code=400, detail="Unsupported image type for gallery variant")
        gallery_path = _gallery_disk_path(uid, public_id, gallery_ext)
        try:
            gallery_path.write_bytes(gallery_raw)
        except OSError as e:
            logger.exception("image_host gallery write failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to save gallery image")

        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": str(uuid.uuid4()),
            "public_id": public_id,
            "user_id": uid,
            "mime": mime,
            "size_bytes": len(raw),
            "original_filename": (file.filename or "")[:200] or None,
            "rel_path": str(path.relative_to(ROOT_DIR)).replace("\\", "/"),
            "rel_path_gallery": str(gallery_path.relative_to(ROOT_DIR)).replace("\\", "/"),
            "gallery_mime": gallery_mime,
            "gallery_size_bytes": len(gallery_raw),
            "gallery_max_edge": gallery_max_edge,
            "is_public_gallery": _coerce_bool(is_public_gallery),
            "created_at": now,
            "deleted_at": None,
            "resize_max_edge": resize_meta,
        }
        await db.image_host_uploads.insert_one(doc)
        return {"public_id": public_id, "message": "Uploaded"}

    async def import_from_url(
        body: ImageHostImportRequest,
        current_user: dict = Depends(get_current_user_verified),
    ):
        _ensure_upload_root()
        uid = current_user.get("id") or ""
        if await _count_active(uid) >= IMAGE_HOST_MAX_PER_USER:
            raise HTTPException(
                status_code=400,
                detail=f"Maximum {IMAGE_HOST_MAX_PER_USER} hosted images. Delete one first.",
            )

        data, err = await download_remote_image_full(body.url.strip())
        if not data:
            raise HTTPException(status_code=400, detail=err or "Could not import image")

        mime, verr = verify_uploaded_file_bytes(data, None)
        if not mime or verr:
            msg = verr or "Invalid image"
            if "too large" in msg.lower():
                msg = f"{msg}. Try importing a smaller image or use resize."
            raise HTTPException(status_code=400, detail=msg)

        try:
            data, mime, resize_meta = maybe_resize_for_host(data, mime, body.max_edge)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Image import failed during resize: {str(e)}") from e

        ext = MIME_TO_FILE_EXT.get(mime)
        if not ext:
            raise HTTPException(status_code=400, detail="Unsupported image type")

        public_id = await _unique_public_id()
        path = _disk_path(uid, public_id, ext)
        try:
            path.write_bytes(data)
        except OSError as e:
            logger.exception("image_host import write failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to save image")

        gallery_raw, gallery_mime = _build_gallery_variant_bytes(data, mime)
        gallery_ext = MIME_TO_FILE_EXT.get(gallery_mime)
        if not gallery_ext:
            raise HTTPException(status_code=400, detail="Unsupported image type for gallery variant")
        gallery_path = _gallery_disk_path(uid, public_id, gallery_ext)
        try:
            gallery_path.write_bytes(gallery_raw)
        except OSError as e:
            logger.exception("image_host import gallery write failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to save gallery image")

        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": str(uuid.uuid4()),
            "public_id": public_id,
            "user_id": uid,
            "mime": mime,
            "size_bytes": len(data),
            "original_filename": None,
            "source_url": body.url.strip()[:2048],
            "rel_path": str(path.relative_to(ROOT_DIR)).replace("\\", "/"),
            "rel_path_gallery": str(gallery_path.relative_to(ROOT_DIR)).replace("\\", "/"),
            "gallery_mime": gallery_mime,
            "gallery_size_bytes": len(gallery_raw),
            "gallery_max_edge": gallery_max_edge,
            "is_public_gallery": bool(body.is_public_gallery),
            "created_at": now,
            "deleted_at": None,
            "resize_max_edge": resize_meta,
        }
        await db.image_host_uploads.insert_one(doc)
        return {"public_id": public_id, "message": "Imported"}

    async def delete_image(
        public_id: str,
        current_user: dict = Depends(get_current_user_verified),
    ):
        uid = current_user.get("id") or ""
        doc = await db.image_host_uploads.find_one({"public_id": public_id, "user_id": uid, "deleted_at": None})
        if not doc:
            raise HTTPException(status_code=404, detail="Image not found")

        rel = doc.get("rel_path")
        if rel:
            try:
                fp = (ROOT_DIR / rel).resolve()
                if fp.is_file() and str(upload_root.resolve()) in str(fp):
                    fp.unlink(missing_ok=True)
            except Exception as e:
                logger.warning("image_host unlink failed: %s", e)
        rel_gallery = doc.get("rel_path_gallery")
        if rel_gallery:
            try:
                fp = (ROOT_DIR / rel_gallery).resolve()
                if fp.is_file() and str(upload_root.resolve()) in str(fp):
                    fp.unlink(missing_ok=True)
            except Exception as e:
                logger.warning("image_host gallery unlink failed: %s", e)

        await db.image_host_uploads.update_one(
            {"public_id": public_id, "user_id": uid},
            {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat()}},
        )
        return {"message": "Deleted"}

    async def set_image_visibility(
        public_id: str,
        body: ImageVisibilityRequest,
        current_user: dict = Depends(get_current_user_verified),
    ):
        uid = current_user.get("id") or ""
        doc = await db.image_host_uploads.find_one({"public_id": public_id, "user_id": uid, "deleted_at": None})
        if not doc:
            raise HTTPException(status_code=404, detail="Image not found")

        # Backfill gallery variant for legacy items if needed before publishing.
        if body.is_public_gallery and not doc.get("rel_path_gallery"):
            src_abs = _safe_rel_to_abs(doc.get("rel_path"))
            if not src_abs or not src_abs.is_file():
                raise HTTPException(status_code=400, detail="Original image file missing; re-upload to publish publicly.")
            try:
                src_data = src_abs.read_bytes()
            except OSError:
                raise HTTPException(status_code=500, detail="Failed to read original image file")
            src_mime = doc.get("mime") or "application/octet-stream"
            gallery_raw, gallery_mime = _build_gallery_variant_bytes(src_data, src_mime)
            gallery_ext = MIME_TO_FILE_EXT.get(gallery_mime)
            if not gallery_ext:
                raise HTTPException(status_code=400, detail="Unsupported image type for gallery variant")
            gallery_path = _gallery_disk_path(uid, public_id, gallery_ext)
            try:
                gallery_path.write_bytes(gallery_raw)
            except OSError:
                raise HTTPException(status_code=500, detail="Failed to save gallery image")
            await db.image_host_uploads.update_one(
                {"public_id": public_id, "user_id": uid},
                {"$set": {
                    "rel_path_gallery": str(gallery_path.relative_to(ROOT_DIR)).replace("\\", "/"),
                    "gallery_mime": gallery_mime,
                    "gallery_size_bytes": len(gallery_raw),
                    "gallery_max_edge": gallery_max_edge,
                }},
            )

        await db.image_host_uploads.update_one(
            {"public_id": public_id, "user_id": uid},
            {"$set": {"is_public_gallery": bool(body.is_public_gallery)}},
        )
        return {"message": "Visibility updated", "is_public_gallery": bool(body.is_public_gallery)}

    async def serve_image(public_id: str):
        doc = await db.image_host_uploads.find_one(
            {"public_id": public_id, "deleted_at": None},
            {"_id": 0, "rel_path": 1, "mime": 1},
        )
        if not doc or not doc.get("rel_path"):
            raise HTTPException(status_code=404, detail="Not found")
        fp = (ROOT_DIR / doc["rel_path"]).resolve()
        root_resolved = upload_root.resolve()
        try:
            fp.relative_to(root_resolved)
        except ValueError:
            raise HTTPException(status_code=404, detail="Not found")
        if not fp.is_file():
            raise HTTPException(status_code=404, detail="Not found")

        return FileResponse(
            path=str(fp),
            media_type=doc.get("mime") or "application/octet-stream",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    async def serve_gallery_image(public_id: str):
        doc = await db.image_host_uploads.find_one(
            {"public_id": public_id, "deleted_at": None},
            {"_id": 0, "rel_path_gallery": 1, "gallery_mime": 1, "rel_path": 1, "mime": 1},
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Not found")
        rel = doc.get("rel_path_gallery") or doc.get("rel_path")
        fp = _safe_rel_to_abs(rel)
        if not fp or not fp.is_file():
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(
            path=str(fp),
            media_type=(doc.get("gallery_mime") or doc.get("mime") or "application/octet-stream"),
            headers={"Cache-Control": "public, max-age=86400"},
        )

    async def list_public_gallery(
        limit: int = Query(60, ge=1, le=200),
        skip: int = Query(0, ge=0),
    ):
        filt = {"deleted_at": None, "is_public_gallery": True}
        total = await db.image_host_uploads.count_documents(filt)
        cur = (
            db.image_host_uploads.find(
                filt,
                {
                    "_id": 0,
                    "public_id": 1,
                    "created_at": 1,
                    "gallery_max_edge": 1,
                    "user_id": 1,
                },
            )
            .sort("created_at", -1)
            .skip(skip)
            .limit(limit)
        )
        rows: List[dict] = []
        async for doc in cur:
            rows.append(doc)

        uids = list({r.get("user_id") for r in rows if r.get("user_id")})
        uname_by_id: dict = {}
        if uids:
            async for u in db.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "username": 1}):
                uname_by_id[u["id"]] = u.get("username") or ""
        for rdoc in rows:
            rdoc["username"] = uname_by_id.get(rdoc.get("user_id") or "", "") or None
        return {"items": rows, "total": total, "skip": skip, "limit": limit}

    async def admin_list_uploads(
        limit: int = Query(100, ge=1, le=500),
        skip: int = Query(0, ge=0),
        user_id: Optional[str] = Query(None, max_length=64),
        username: Optional[str] = Query(None, max_length=64),
        _admin: dict = Depends(require_admin),
    ):
        """List active hosted images (all users). Optional filter by user_id or username."""
        filt: dict = {"deleted_at": None}
        uid_filter = (user_id or "").strip()
        if not uid_filter and (username or "").strip():
            uname_pat = _find_user_by_username_case_insensitive(username.strip())
            if uname_pat:
                u = await db.users.find_one(uname_pat, {"_id": 0, "id": 1})
                uid_filter = (u or {}).get("id") or ""
            if not uid_filter:
                return {"items": [], "total": 0, "skip": skip, "limit": limit}
        if uid_filter:
            filt["user_id"] = uid_filter

        total = await db.image_host_uploads.count_documents(filt)
        cur = (
            db.image_host_uploads.find(
                filt,
                {
                    "_id": 0,
                    "public_id": 1,
                    "user_id": 1,
                    "mime": 1,
                    "size_bytes": 1,
                    "original_filename": 1,
                    "source_url": 1,
                    "created_at": 1,
                    "resize_max_edge": 1,
                    "is_public_gallery": 1,
                },
            )
            .sort("created_at", -1)
            .skip(skip)
            .limit(limit)
        )
        rows: List[dict] = []
        async for doc in cur:
            rows.append(doc)

        uids = list({r.get("user_id") for r in rows if r.get("user_id")})
        uname_by_id: dict = {}
        if uids:
            async for u in db.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "username": 1}):
                uname_by_id[u["id"]] = u.get("username") or ""

        for r in rows:
            r["username"] = uname_by_id.get(r.get("user_id") or "", "") or None

        return {"items": rows, "total": total, "skip": skip, "limit": limit}

    async def admin_delete_upload(
        public_id: str,
        _admin: dict = Depends(require_admin),
    ):
        doc = await db.image_host_uploads.find_one({"public_id": public_id, "deleted_at": None})
        if not doc:
            raise HTTPException(status_code=404, detail="Image not found")

        rel = doc.get("rel_path")
        if rel:
            try:
                fp = (ROOT_DIR / rel).resolve()
                root_resolved = upload_root.resolve()
                fp.relative_to(root_resolved)
                if fp.is_file():
                    fp.unlink(missing_ok=True)
            except (ValueError, OSError) as e:
                logger.warning("image_host admin unlink failed: %s", e)
        rel_gallery = doc.get("rel_path_gallery")
        if rel_gallery:
            try:
                fp = (ROOT_DIR / rel_gallery).resolve()
                root_resolved = upload_root.resolve()
                fp.relative_to(root_resolved)
                if fp.is_file():
                    fp.unlink(missing_ok=True)
            except (ValueError, OSError) as e:
                logger.warning("image_host admin gallery unlink failed: %s", e)

        await db.image_host_uploads.update_one(
            {"public_id": public_id},
            {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat()}},
        )
        return {"message": "Deleted"}

    r.add_api_route("/image-host/mine", list_my_images, methods=["GET"])
    r.add_api_route("/image-host/upload", upload_image, methods=["POST"])
    r.add_api_route("/image-host/import-url", import_from_url, methods=["POST"])
    r.add_api_route("/image-host/item/{public_id}", delete_image, methods=["DELETE"])
    r.add_api_route("/image-host/item/{public_id}/visibility", set_image_visibility, methods=["POST"])
    r.add_api_route("/image-host/public", list_public_gallery, methods=["GET"])
    r.add_api_route("/image-host/admin/uploads", admin_list_uploads, methods=["GET"])
    r.add_api_route("/image-host/admin/item/{public_id}", admin_delete_upload, methods=["DELETE"])
    r.add_api_route("/image-host/i/{public_id}", serve_image, methods=["GET"])
    r.add_api_route("/image-host/g/{public_id}", serve_gallery_image, methods=["GET"])
