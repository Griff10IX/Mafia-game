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
def _official_fixture_rows() -> list:
    try:
        raw = json.loads(_KICKOFFS_PATH.read_text(encoding="utf-8"))
        return list(raw.get("fixtures") or [])
    except Exception:
        return []


@lru_cache(maxsize=1)
def _official_fixture_meta_index() -> Dict[Tuple[str, str], dict]:
    """Canonical (home, away) → official stage / group / knockout_round / kickoff."""
    out: Dict[Tuple[str, str], dict] = {}
    for row in _official_fixture_rows():
        home = canonical_wc_team_name(row.get("home") or "")
        away = canonical_wc_team_name(row.get("away") or "")
        kick = (row.get("kickoff_utc") or "").strip()
        if not home or not away:
            continue
        meta = {
            "kickoff_utc": kick or None,
            "group_id": (row.get("group_id") or "").strip().upper() or None,
            "stage": (row.get("stage") or "").strip().lower() or None,
            "knockout_round": (row.get("knockout_round") or "").strip().lower() or None,
            "match_no": row.get("match_no"),
        }
        if meta["group_id"]:
            meta["stage"] = "group"
            meta["knockout_round"] = None
        elif meta["knockout_round"]:
            meta["stage"] = "knockout"
            meta["group_id"] = None
        out[(home, away)] = meta
        out[(away, home)] = meta
    return out


def lookup_official_wc_fixture(home: str, away: str) -> Optional[dict]:
    """Return official FIFA schedule row for this pairing (either home/away order)."""
    h, a = _pair_key(home, away)
    if not h or not a:
        return None
    return _official_fixture_meta_index().get((h, a))


@lru_cache(maxsize=1)
def _kickoff_index() -> Dict[Tuple[str, str], str]:
    out: Dict[Tuple[str, str], str] = {}
    for row in _official_fixture_rows():
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


WC_KNOCKOUT_ROUND_LABELS: Dict[str, str] = {
    "knockout": "Knockout",
    "round_of_32": "Round of 32",
    "round_of_16": "Round of 16",
    "quarter_final": "Quarter-final",
    "semi_final": "Semi-final",
    "third_place": "Third-place play-off",
    "final": "Final",
}

_WC_KNOCKOUT_ROUND_ORDER = (
    "round_of_32",
    "round_of_16",
    "quarter_final",
    "semi_final",
    "third_place",
    "final",
    "knockout",
)


def infer_knockout_round_from_kickoff(kickoff: Optional[str]) -> Optional[str]:
    """Best-effort WC 2026 knockout round from kickoff date (after group stage ends 27 Jun)."""
    if not kickoff:
        return None
    try:
        from datetime import date, datetime, timezone

        dt = datetime.fromisoformat(str(kickoff).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        d = dt.date()
    except Exception:
        return None
    # Group stage runs through 27 June — do not treat 28 Jun group games as knockouts.
    if d < date(2026, 6, 28):
        return None
    if d <= date(2026, 7, 3):
        return "round_of_32"
    if d <= date(2026, 7, 7):
        return "round_of_16"
    if d <= date(2026, 7, 12):
        return "quarter_final"
    if d <= date(2026, 7, 16):
        return "semi_final"
    if d == date(2026, 7, 18):
        return "third_place"
    if d >= date(2026, 7, 19):
        return "final"
    return "knockout"


def normalize_wc_kickoff_utc(kickoff: Optional[str]) -> Optional[str]:
    """Normalize kickoff to UTC Z string for schedule lookups."""
    if not kickoff:
        return None
    try:
        from datetime import datetime, timezone

        dt = datetime.fromisoformat(str(kickoff).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        s = (str(kickoff) or "").strip()
        return s if s else None


def lookup_official_fixtures_for_match_row(match: dict) -> list:
    """Official FIFA rows matching a DB match by kickoff + group / knockout round."""
    kick = normalize_wc_kickoff_utc(match.get("kickoff"))
    if not kick:
        return []
    gid = (match.get("group_id") or "").strip().upper()
    ko = (match.get("knockout_round") or "").strip().lower()
    stage = (match.get("stage") or "").strip().lower()
    out: list = []
    for row in _official_fixture_rows():
        row_kick = normalize_wc_kickoff_utc(row.get("kickoff_utc"))
        if row_kick != kick:
            continue
        row_gid = (row.get("group_id") or "").strip().upper()
        row_ko = (row.get("knockout_round") or "").strip().lower()
        if gid and row_gid:
            if gid == row_gid:
                out.append(row)
            continue
        if ko and row_ko:
            if ko == row_ko:
                out.append(row)
            continue
        if stage == "group" and row_gid:
            out.append(row)
        elif stage == "knockout" and row_ko:
            out.append(row)
        elif not gid and not ko and not row_gid and not row_ko:
            out.append(row)
    return out


def team_briefs_from_official_schedule(match: dict, teams_by_id: dict) -> Tuple[Optional[dict], Optional[dict]]:
    """Resolve home/away team docs from FIFA schedule when match team ids are broken."""
    fixtures = lookup_official_fixtures_for_match_row(match)
    if not fixtures:
        return None, None
    row = fixtures[0]
    home_name = canonical_wc_team_name(row.get("home") or "")
    away_name = canonical_wc_team_name(row.get("away") or "")
    home_doc = None
    away_doc = None
    for t in teams_by_id.values():
        tname = canonical_wc_team_name(t.get("name") or "")
        if tname == home_name:
            home_doc = t
        if tname == away_name:
            away_doc = t
    return home_doc, away_doc


def knockout_round_label(round_key: Optional[str]) -> str:
    key = (round_key or "").strip().lower()
    if not key:
        return "Knockout"
    return WC_KNOCKOUT_ROUND_LABELS.get(key, key.replace("_", " ").title())


def knockout_round_sort_key(round_key: Optional[str]) -> int:
    key = (round_key or "knockout").strip().lower()
    try:
        return _WC_KNOCKOUT_ROUND_ORDER.index(key)
    except ValueError:
        return len(_WC_KNOCKOUT_ROUND_ORDER)


def enrich_wc_match_round(match: dict) -> dict:
    """Add round_key / round_label / is_knockout for API + UI."""
    ht = (match.get("home_team") or {}).get("name") or ""
    at = (match.get("away_team") or {}).get("name") or ""
    official = lookup_official_wc_fixture(ht, at) if ht and at else None

    stage = (match.get("stage") or "").strip().lower()
    if official and official.get("group_id"):
        gid = official["group_id"]
        return {
            **match,
            "is_knockout": False,
            "round_key": "group",
            "round_label": f"Group {gid}",
            "stage": "group",
            "group_id": gid,
        }
    if official and official.get("knockout_round"):
        round_key = official["knockout_round"]
        return {
            **match,
            "is_knockout": True,
            "round_key": round_key,
            "round_label": knockout_round_label(round_key),
            "stage": "knockout",
            "group_id": None,
        }

    round_key = (match.get("knockout_round") or "").strip().lower() or None
    if stage == "group":
        return {
            **match,
            "is_knockout": False,
            "round_key": "group",
            "round_label": f"Group {match.get('group_id') or '—'}",
        }
    if stage in WC_KNOCKOUT_ROUND_LABELS:
        round_key = stage if stage != "knockout" else round_key
    if not round_key and stage == "knockout":
        round_key = infer_knockout_round_from_kickoff(match.get("kickoff")) or stage or "knockout"
    if stage in ("final", "third_place"):
        round_key = stage
    label = knockout_round_label(round_key)
    return {
        **match,
        "is_knockout": stage != "group",
        "round_key": round_key,
        "round_label": label,
    }
