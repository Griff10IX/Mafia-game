from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from utils import attack_turnstile_gate as gate
from utils.captcha_turnstile import TurnstileVerifyResult


class _Client:
    host = "127.0.0.1"


class _Request:
    method = "POST"
    client = _Client()

    def __init__(self, path="/api/attack/execute"):
        self.headers = {
            "user-agent": "Mozilla/5.0 Chrome/120",
            "cf-connecting-ip": "127.0.0.1",
        }
        self.url = type("Url", (), {"path": path})()


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if _matches(doc, query):
                return dict(doc)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return type("InsertResult", (), {"inserted_id": doc.get("id")})()

    async def find_one_and_update(self, query, update):
        for doc in self.docs:
            if _matches(doc, query):
                old = dict(doc)
                doc.update(update.get("$set", {}))
                return old
        return None


def _matches(doc, query):
    for key, expected in (query or {}).items():
        if key == "consumed_at" and isinstance(expected, dict) and expected.get("$exists") is False:
            if "consumed_at" in doc:
                return False
            continue
        if key == "expires_at" and isinstance(expected, dict) and "$gt" in expected:
            if not (doc.get(key) and doc[key] > expected["$gt"]):
                return False
            continue
        if doc.get(key) != expected:
            return False
    return True


class _DB:
    def __init__(self, main=None):
        self.game_settings = _Collection([main] if main else [])
        self.collections = {
            gate.ATTACK_TURNSTILE_NONCES_COLLECTION: _Collection(),
            "captcha_turnstile_failures": _Collection(),
        }

    def __getitem__(self, name):
        return self.collections.setdefault(name, _Collection())


@pytest.mark.asyncio
async def test_attack_turnstile_disabled_by_default_allows_without_token(monkeypatch):
    monkeypatch.delenv("ATTACK_TURNSTILE_DISABLED", raising=False)
    db = _DB()
    current_user = {"id": "u1", "username": "Tester"}

    cfg = await gate.attack_turnstile_config(db)
    assert cfg["enabled"] is False

    out = await gate.require_attack_turnstile(
        db,
        request=_Request(),
        current_user=current_user,
        action="execute",
        captcha_token=None,
        captcha_nonce=None,
        risk_score=100,
    )
    assert out["allowed"] is True
    assert out["reason"] == "not_required"


@pytest.mark.asyncio
async def test_attack_turnstile_target_rollout_excludes_nonlisted_user(monkeypatch):
    monkeypatch.delenv("ATTACK_TURNSTILE_DISABLED", raising=False)
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret")
    db = _DB(
        {
            "_id": "main",
            "attack_turnstile_enabled": True,
            "attack_turnstile_enforce": "enforce",
            "attack_turnstile_mode": "execute_only",
            "minigame_turnstile_site_key": "site",
            "attack_turnstile_target_usernames": ["alphauser"],
        }
    )
    cfg_other = await gate.attack_turnstile_config(db, current_user={"id": "u2", "username": "Other"})
    assert cfg_other["enabled"] is False
    assert cfg_other["target_rollout_active"] is True
    cfg_alpha = await gate.attack_turnstile_config(db, current_user={"id": "u1", "username": "AlphaUser"})
    assert cfg_alpha["enabled"] is True
    out = await gate.require_attack_turnstile(
        db,
        request=_Request(),
        current_user={"id": "u2", "username": "Other"},
        action="execute",
        captcha_token=None,
        captcha_nonce=None,
        risk_score=100,
    )
    assert out["allowed"] is True
    assert out["reason"] == "not_required"


@pytest.mark.asyncio
async def test_attack_turnstile_nonce_is_one_time(monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret")
    db = _DB(
        {
            "_id": "main",
            "attack_turnstile_enabled": True,
            "attack_turnstile_enforce": "enforce",
            "attack_turnstile_mode": "execute_only",
            "minigame_turnstile_site_key": "site",
        }
    )
    current_user = {"id": "u1", "username": "Tester"}

    issued = await gate.issue_attack_turnstile_nonce(db, current_user=current_user, action="execute")
    nonce = issued["nonce"]
    assert issued["required"] is True

    async def _ok_verify(**kwargs):
        return TurnstileVerifyResult(success=True, action="attack_execute", cdata=nonce, challenge_ts=datetime.now(timezone.utc).isoformat())

    monkeypatch.setattr(gate, "verify_turnstile_token", _ok_verify)

    first = await gate.require_attack_turnstile(
        db,
        request=_Request(),
        current_user=current_user,
        action="execute",
        captcha_token="token",
        captcha_nonce=nonce,
        risk_score=0,
    )
    assert first["reason"] == "verified"

    with pytest.raises(HTTPException) as exc_info:
        await gate.require_attack_turnstile(
            db,
            request=_Request(),
            current_user=current_user,
            action="execute",
            captcha_token="token",
            captcha_nonce=nonce,
            risk_score=0,
        )
    assert exc_info.value.status_code == 400
