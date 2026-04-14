#!/usr/bin/env python3
"""List mutating /api routes with no RATE_LIMIT_CONFIG pattern match.

Run from the backend directory with the same env as the API (MONGO_URL, DB_NAME, JWT_SECRET_KEY):

  cd backend && python scripts/audit_rate_limit_routes.py

Middleware intentionally skips /api/auth/, /api/admin/, /admin/ — those are listed separately.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
os.chdir(BACKEND)
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

try:
    from dotenv import load_dotenv

    load_dotenv(BACKEND / ".env", override=True)
    load_dotenv(BACKEND.parent / ".env", override=False)
except ImportError:
    pass

SKIP_PREFIXES = ("/api/auth/", "/api/admin/", "/admin/")
SKIP_EXACT = frozenset({"/", "/docs", "/openapi.json"})


def main() -> int:
    try:
        from middleware.security import RATE_LIMIT_CONFIG, get_rate_limit_for_path
    except ImportError as e:
        print("Import error:", e, file=sys.stderr)
        return 1

    try:
        from server import app
    except Exception as e:
        print(
            "Could not import server app (need MONGO_URL, DB_NAME, JWT_SECRET_KEY in env):",
            e,
            file=sys.stderr,
        )
        return 1

    patterns = frozenset(RATE_LIMIT_CONFIG.keys())
    mutating: set[tuple[str, frozenset[str]]] = set()

    for route in app.routes:
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None) or frozenset()
        if not path or not path.startswith("/api"):
            continue
        active = frozenset(m for m in methods if m not in ("GET", "HEAD", "OPTIONS", "TRACE"))
        if not active:
            continue
        mutating.add((path, active))

    uncovered: list[tuple[str, frozenset[str]]] = []
    skipped_mw: list[tuple[str, frozenset[str]]] = []

    for path, methods in sorted(mutating, key=lambda x: x[0]):
        if path in SKIP_EXACT or any(path.startswith(p) for p in SKIP_PREFIXES):
            skipped_mw.append((path, methods))
            continue
        _interval, _enabled, key = get_rate_limit_for_path(path)
        if key not in patterns:
            uncovered.append((path, methods))

    print("=== Mutating /api routes with NO RATE_LIMIT_CONFIG match ===")
    if not uncovered:
        print("(none)")
    else:
        for path, methods in uncovered:
            print(f"  {path}  {set(methods)}")

    print("\n=== Mutating routes skipped by SecurityMiddleware (no spam/duplicate/endpoint RL there) ===")
    for path, methods in sorted(skipped_mw, key=lambda x: x[0]):
        print(f"  {path}  {set(methods)}")

    print("\n=== Summary ===")
    print(f"Total mutating /api route registrations: {len(mutating)}")
    print(f"Uncovered (should be empty after config update): {len(uncovered)}")
    return 0 if not uncovered else 2


if __name__ == "__main__":
    raise SystemExit(main())
