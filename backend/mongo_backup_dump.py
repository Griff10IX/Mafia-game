"""
MongoDB backup before index changes or deploys.

Requires MongoDB Database Tools (`mongodump`) on PATH:
  https://www.mongodb.com/try/download/database-tools

Usage (from repo root):
  python backend/mongo_backup_dump.py

Reads MONGO_URL and DB_NAME from backend/.env (same as server.py).
Writes a gzipped archive under ../backups/ (repo root).
"""
from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse


def build_mongodump_uri(mongo_url: str, db_name: str) -> str:
    """Put target DB in URI path so mongodump does not conflict with --db + authSource=admin."""
    p = urlparse(mongo_url.strip())
    path = "/" + db_name.lstrip("/")
    return urlunparse((p.scheme, p.netloc, path, p.params, p.query, p.fragment))


def _load_env() -> Path:
    backend_dir = Path(__file__).resolve().parent
    try:
        from dotenv import load_dotenv

        load_dotenv(backend_dir / ".env", override=True)
    except ImportError:
        pass
    return backend_dir


def main() -> None:
    backend_dir = _load_env()
    mongo_url = os.environ.get("MONGO_URL")
    db_name = (os.environ.get("DB_NAME") or "mafia").strip()
    if not mongo_url:
        print("ERROR: MONGO_URL not set. Configure backend/.env", file=sys.stderr)
        sys.exit(1)

    repo_root = backend_dir.parent
    backups = repo_root / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")
    archive_path = backups / f"mongo-{db_name}-{ts}.archive.gz"

    dump_uri = build_mongodump_uri(mongo_url, db_name)
    cmd = [
        "mongodump",
        "--uri",
        dump_uri,
        "--archive",
        str(archive_path),
        "--gzip",
    ]
    print("Backing up database", repr(db_name), "to", archive_path)
    try:
        subprocess.run(cmd, check=True)
    except FileNotFoundError:
        print(
            "ERROR: mongodump not found. Install MongoDB Database Tools and add them to PATH.\n"
            "  https://www.mongodb.com/try/download/database-tools",
            file=sys.stderr,
        )
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print("ERROR: mongodump failed with exit code", e.returncode, file=sys.stderr)
        sys.exit(e.returncode)

    try:
        size_mb = archive_path.stat().st_size / (1024 * 1024)
        print(f"Done. Archive size: {size_mb:.2f} MB")
    except OSError:
        print("Done.")


if __name__ == "__main__":
    main()
