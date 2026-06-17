"""Official FIFA World Cup 2026 group-stage kickoffs (UTC) — overrides Odds API commence_time when wrong."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Dict, Optional, Tuple

_KICKOFFS_PATH = Path(__file__).resolve().parent.parent / "data" / "world_cup_2026_kickoffs.json"
WC_SPORT_KEY = "soccer_fifa_world_cup"

# Extra aliases not in teams seed (FIFA / Odds API spellings → canonical name in world_cup_2026_teams.json).
_EXTRA_ALIASES: Dict[str, str] = {
    "usa": "United States",
    "korea republic": "South Korea",
    "south korea": "South Korea",
    "congo dr": "DR Congo",
    "democratic republic of the congo": "DR Congo",
    "cote divoire": "Ivory Coast",
    "côte d'ivoire": "Ivory Coast",
    "cote d'ivoire": "Ivory Coast",
    "ir iran": "Iran",
    "iran": "Iran",
    "cabo verde": "Cape Verde",
    "cape verde": "Cape Verde",
    "curacao": "Curaçao",
    "curaçao": "Curaçao",
    "turkey": "Türkiye",
    "türkiye": "Türkiye",
    "bosnia": "Bosnia and Herzegovina",
    "sweden": "Sweden",
}


def _norm(s: str) -> str:
    x = (s or "").strip().lower()
    x = re.sub(r"[^a-z0-9]+", " ", x)
    return re.sub(r"\s+", " ", x).strip()


@lru_cache(maxsize=1)
def _alias_to_canonical() -> Dict[str, str]:
    out: Dict[str, str] = {k: v for k, v in _EXTRA_ALIASES.items()}
    try:
        teams_path = Path(__file__).resolve().parent.parent / "data" / "world_cup_2026_teams.json"
        raw = json.loads(teams_path.read_text(encoding="utf-8"))
        for grp in raw.get("groups") or []:
            for t in grp.get("teams") or []:
                name = (t.get("name") or "").strip()
                if not name:
                    continue
                out[_norm(name)] = name
                for alias in t.get("odds_api_names") or []:
                    a = (alias or "").strip()
                    if a:
                        out[_norm(a)] = name
    except Exception:
        pass
    return out


def canonical_wc_team_name(name: str) -> str:
    n = _norm(name)
    if not n:
        return (name or "").strip()
    return _alias_to_canonical().get(n, (name or "").strip())


def _pair_key(home: str, away: str) -> Tuple[str, str]:
    return canonical_wc_team_name(home), canonical_wc_team_name(away)


@lru_cache(maxsize=1)
def _kickoff_index() -> Dict[Tuple[str, str], str]:
    try:
        raw = json.loads(_KICKOFFS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: Dict[Tuple[str, str], str] = {}
    for row in raw.get("fixtures") or []:
        home = canonical_wc_team_name(row.get("home") or "")
        away = canonical_wc_team_name(row.get("away") or "")
        kick = (row.get("kickoff_utc") or "").strip()
        if home and away and kick:
            out[(home, away)] = kick
    return out


def resolve_wc_kickoff_utc(home: str, away: str, fallback: Optional[str] = None) -> Optional[str]:
    """Return official UTC kickoff (Z) for a WC 2026 fixture, or fallback if unknown."""
    key = _pair_key(home, away)
    hit = _kickoff_index().get(key)
    return hit or fallback


def apply_wc_kickoff_to_template(template: dict) -> dict:
    """If template is FIFA WC, replace start_time with official kickoff when known."""
    if not isinstance(template, dict):
        return template
    sk = (template.get("external_sport_key") or "").strip()
    if sk != WC_SPORT_KEY:
        return template
    name = (template.get("name") or "").strip()
    parts = name.split(" vs ", 1)
    if len(parts) != 2:
        return template
    fixed = resolve_wc_kickoff_utc(parts[0].strip(), parts[1].strip(), template.get("start_time"))
    if fixed:
        template = dict(template)
        template["start_time"] = fixed
    return template
