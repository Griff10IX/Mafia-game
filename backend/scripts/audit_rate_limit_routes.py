#!/usr/bin/env python3
"""Deprecated: per-endpoint RATE_LIMIT_CONFIG was removed in Phase 0 (no app-level API rate limiting)."""

from __future__ import annotations

import sys


def main() -> int:
    print(
        "audit_rate_limit_routes.py: obsolete — RATE_LIMIT_CONFIG is empty and "
        "check_endpoint_rate_limit is a no-op. IP bans remain in SecurityMiddleware."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
