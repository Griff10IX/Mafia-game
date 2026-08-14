"""Validated intent catalog and deterministic question matching for Game Guide."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Optional

CATALOG_DIR = Path(__file__).resolve().parents[1] / "data" / "game_help_intents"
WORD_RE = re.compile(r"[a-z0-9]+")
QUESTION_WORDS = frozenset(
    "a an the is are was were do does did can could would should i me my you your "
    "please about tell explain show guide help information question work works working".split()
)
ACTION_TOKENS = frozenset(
    "attack buy sell collect join leave travel bust escape withdraw deposit revive report "
    "redeem equip melt grow harvest raid hire open edit send out".split()
)
ALLOWED_INTENT_TYPES = frozenset(
    {"definition", "procedure", "rules", "comparison", "troubleshooting", "yes_no"}
)
ALLOWED_SOURCES = frozenset({"faq", "how_to"})
ALLOWED_KINDS = frozenset({"category", "subsection"})


class CatalogValidationError(ValueError):
    """Raised when generated catalog data can no longer map to live guides."""


@dataclass(frozen=True)
class CatalogMatch:
    intent: dict[str, Any]
    score: float
    confidence: str
    method: str
    matched_variant: str


def normalize(value: str) -> str:
    return " ".join(WORD_RE.findall((value or "").lower()))


def content_tokens(value: str) -> set[str]:
    return {token for token in WORD_RE.findall((value or "").lower()) if token not in QUESTION_WORDS}


def section_key(section: dict[str, Any]) -> tuple[str, str, str, str]:
    return (
        str(section.get("source") or ""),
        str(section.get("kind") or ""),
        str(section.get("category") or ""),
        str(section.get("title") or ""),
    )


def _read_manifest() -> dict[str, Any]:
    path = CATALOG_DIR / "manifest.json"
    if not path.is_file():
        raise CatalogValidationError(f"Game Guide intent manifest is missing: {path}")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CatalogValidationError(f"Cannot read Game Guide intent manifest: {exc}") from exc
    if not isinstance(manifest, dict) or not isinstance(manifest.get("shards"), list):
        raise CatalogValidationError("Game Guide intent manifest has an invalid shape")
    return manifest


@lru_cache(maxsize=1)
def load_catalog() -> tuple[dict[str, Any], ...]:
    """Load immutable-at-runtime catalog records from domain shards."""
    manifest = _read_manifest()
    rows: list[dict[str, Any]] = []
    for shard in manifest["shards"]:
        filename = shard.get("file") if isinstance(shard, dict) else None
        if not isinstance(filename, str) or not filename.endswith(".json"):
            raise CatalogValidationError("Intent manifest contains an invalid shard filename")
        path = CATALOG_DIR / filename
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise CatalogValidationError(f"Cannot read intent shard {filename}: {exc}") from exc
        intents = payload.get("intents") if isinstance(payload, dict) else None
        if not isinstance(intents, list):
            raise CatalogValidationError(f"Intent shard {filename} has no intents list")
        rows.extend(intents)
    return tuple(rows)


def _require_text(row: dict[str, Any], field: str, intent_id: str) -> str:
    value = row.get(field)
    if not isinstance(value, str) or not value.strip():
        raise CatalogValidationError(f"{intent_id}: {field} must be non-empty text")
    return value.strip()


def validate_catalog(
    sections: Optional[Iterable[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Validate all records, relationships, and live guide section references."""
    if sections is None:
        from utils.game_help_chat import load_sections

        sections = load_sections()
    section_rows = tuple(sections)
    valid_section_keys = {section_key(section) for section in section_rows}
    intents = load_catalog()
    ids: set[str] = set()
    referenced: set[tuple[str, str, str, str]] = set()
    variant_count = 0

    for row in intents:
        if not isinstance(row, dict):
            raise CatalogValidationError("Every catalog intent must be an object")
        intent_id = _require_text(row, "id", "<unknown>")
        if intent_id in ids:
            raise CatalogValidationError(f"Duplicate intent id: {intent_id}")
        ids.add(intent_id)
        intent_type = _require_text(row, "intent_type", intent_id)
        if intent_type not in ALLOWED_INTENT_TYPES:
            raise CatalogValidationError(f"{intent_id}: unsupported intent_type {intent_type}")
        variants = row.get("variants")
        if not isinstance(variants, list) or len(variants) < 5:
            raise CatalogValidationError(f"{intent_id}: at least five variants are required")
        normalized_variants: set[str] = set()
        for variant in variants:
            if not isinstance(variant, str) or not normalize(variant):
                raise CatalogValidationError(f"{intent_id}: variants must be non-empty strings")
            normalized_variant = normalize(variant)
            if normalized_variant in normalized_variants:
                raise CatalogValidationError(f"{intent_id}: duplicate variant {variant!r}")
            normalized_variants.add(normalized_variant)
        variant_count += len(variants)
        refs = row.get("sections")
        if not isinstance(refs, list) or not refs:
            raise CatalogValidationError(f"{intent_id}: at least one guide section is required")
        for ref in refs:
            if not isinstance(ref, dict):
                raise CatalogValidationError(f"{intent_id}: section reference must be an object")
            key = section_key(ref)
            if key[0] not in ALLOWED_SOURCES or key[1] not in ALLOWED_KINDS:
                raise CatalogValidationError(f"{intent_id}: invalid section source or kind")
            if key not in valid_section_keys:
                raise CatalogValidationError(
                    f"{intent_id}: missing guide section {key[0]} / {key[2]} / {key[3]}"
                )
            referenced.add(key)
        for field in ("related_intents", "follow_ups", "entities", "route_aliases"):
            values = row.get(field, [])
            if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
                raise CatalogValidationError(f"{intent_id}: {field} must be a list of strings")

    for row in intents:
        for related_id in row.get("related_intents", []):
            if related_id not in ids:
                raise CatalogValidationError(f"{row['id']}: unknown related intent {related_id}")

    manifest = _read_manifest()
    if manifest.get("intent_count") != len(intents):
        raise CatalogValidationError("Manifest intent count does not match loaded catalog")
    if manifest.get("variant_count") != variant_count:
        raise CatalogValidationError("Manifest variant count does not match loaded catalog")
    return {
        "intents": len(intents),
        "variants": variant_count,
        "guide_sections": len(valid_section_keys),
        "referenced_sections": len(referenced),
        "uncovered_sections": sorted(valid_section_keys - referenced),
    }


def catalog_by_id() -> dict[str, dict[str, Any]]:
    return {row["id"]: row for row in load_catalog()}


@lru_cache(maxsize=1)
def _variant_index() -> tuple[tuple[str, set[str], dict[str, Any], str], ...]:
    indexed: list[tuple[str, set[str], dict[str, Any], str]] = []
    for intent in load_catalog():
        for variant in intent["variants"]:
            indexed.append((normalize(variant), content_tokens(variant), intent, variant))
    return tuple(indexed)


def _overlap_score(query_tokens: set[str], variant_tokens: set[str]) -> float:
    if not query_tokens or not variant_tokens:
        return 0.0
    shared = query_tokens & variant_tokens
    coverage = len(shared) / len(query_tokens)
    precision = len(shared) / len(variant_tokens)
    return (coverage * 64.0) + (precision * 26.0)


def _phrase_score(query: str, variant: str) -> tuple[float, str]:
    if query == variant:
        return 100.0, "exact_variant"
    if len(query) >= 8 and query in variant:
        return 92.0, "variant_phrase"
    if len(variant) >= 8 and variant in query:
        return 94.0, "query_phrase"
    return 0.0, "catalog_tokens"


def _is_faq_qa_intent(intent: dict[str, Any]) -> bool:
    refs = intent.get("sections") or []
    return bool(refs) and all(str(ref.get("category") or "") == "FAQ" for ref in refs)


def _is_feature_intent(intent: dict[str, Any]) -> bool:
    return str(intent.get("id") or "").startswith("cross_feature.feature.")


def _intent_priority(intent: dict[str, Any]) -> int:
    intent_type = str(intent.get("intent_type") or "")
    if intent_type in {"comparison", "yes_no", "troubleshooting"}:
        return 0
    if _is_feature_intent(intent):
        return 1
    return 2


def _title_specificity(intent: dict[str, Any], query_tokens: set[str]) -> int:
    refs = intent.get("sections") or []
    if not refs:
        return 0
    return len(query_tokens & content_tokens(str(refs[0].get("title") or "")))


def _kind_rank(intent: dict[str, Any]) -> int:
    kinds = {str(ref.get("kind") or "") for ref in intent.get("sections") or []}
    return 0 if "subsection" in kinds else 1


def match_catalog(message: str, limit: int = 5) -> list[CatalogMatch]:
    """Rank catalog intents without generating or inspecting factual answer text."""
    query = normalize(message)
    query_tokens = content_tokens(message)
    if not query or not query_tokens:
        return []
    how_like = bool(
        re.search(r"\b(?:how|explain|what is|what are|tell me about)\b", query)
    )
    best_by_intent: dict[str, tuple[float, str, str, dict[str, Any]]] = {}
    for variant, variant_tokens, intent, raw_variant in _variant_index():
        phrase_score, method = _phrase_score(query, variant)
        score = max(phrase_score, _overlap_score(query_tokens, variant_tokens))
        action_overlap = query_tokens & variant_tokens & ACTION_TOKENS
        if action_overlap:
            score += min(12.0, len(action_overlap) * 6.0)
        entity_tokens = content_tokens(" ".join(intent.get("entities", [])))
        entity_overlap = len(query_tokens & entity_tokens)
        if entity_overlap:
            score += min(8.0, entity_overlap * 2.0)
        domain_tokens = content_tokens(intent.get("domain", "").replace("_", " "))
        if query_tokens & domain_tokens:
            score += 4.0
        route_aliases = intent.get("route_aliases", [])
        if any(alias.lower() in message.lower() for alias in route_aliases):
            score += 9.0
            method = "route_alias"
        if len(intent.get("sections") or []) > 1:
            score += 5.0
        if _is_feature_intent(intent):
            score += 8.0
        if _is_faq_qa_intent(intent):
            score -= 18.0 if how_like else 6.0
        score += min(10.0, _title_specificity(intent, query_tokens) * 3.0)
        score = min(max(score, 0.0), 100.0)
        current = best_by_intent.get(intent["id"])
        if current is None or score > current[0]:
            best_by_intent[intent["id"]] = (score, method, raw_variant, intent)
    ranked = sorted(
        best_by_intent.values(),
        key=lambda item: (
            -item[0],
            _intent_priority(item[3]),
            1 if _is_faq_qa_intent(item[3]) else 0,
            -_title_specificity(item[3], query_tokens),
            _kind_rank(item[3]),
            -len(item[3].get("sections") or []),
            item[3]["id"],
        ),
    )
    results: list[CatalogMatch] = []
    for score, method, variant, intent in ranked[:limit]:
        confidence = "high" if score >= 88 else "medium" if score >= 68 else "low"
        results.append(
            CatalogMatch(
                intent=intent,
                score=round(score, 2),
                confidence=confidence,
                method=method,
                matched_variant=variant,
            )
        )
    return results


def prefer_complete_match(matches: list[CatalogMatch]) -> list[CatalogMatch]:
    """Skip short FAQ Q&A when a real feature chapter is almost as strong."""
    if not matches:
        return matches
    top = matches[0]
    if not _is_faq_qa_intent(top.intent):
        return matches
    better = next(
        (
            match
            for match in matches[1:]
            if not _is_faq_qa_intent(match.intent) and top.score - match.score <= 15
        ),
        None,
    )
    if better is None:
        return matches
    return [better] + [match for match in matches if match is not better]


def resolve_sections(
    intent: dict[str, Any],
    sections: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_key = {section_key(section): section for section in sections}
    return [by_key[section_key(ref)] for ref in intent["sections"] if section_key(ref) in by_key]


_NESTED_CHIP_RE = re.compile(
    r"\b(?:how do i use|how do i start|what are the rules for|where do i find|"
    r"tell me about|what happens with|how does|explain|what is|what are)\s+"
    r"(?:how|what|why|where|when|who|which|can|does|do)\b",
    re.I,
)


def is_natural_chip(text: str) -> bool:
    cleaned = (text or "").strip()
    if not cleaned or "??" in cleaned:
        return False
    return not _NESTED_CHIP_RE.search(cleaned)


def related_questions(intent: dict[str, Any], limit: int = 5) -> list[str]:
    questions = list(intent.get("follow_ups", []))
    by_id = catalog_by_id()
    for intent_id in intent.get("related_intents", []):
        related = by_id.get(intent_id)
        if related and related.get("variants"):
            questions.append(related["variants"][0])
    seen: set[str] = set()
    result: list[str] = []
    for question in questions:
        if not is_natural_chip(question):
            continue
        key = normalize(question)
        if key and key not in seen:
            seen.add(key)
            result.append(question)
        if len(result) >= limit:
            break
    return result


def coverage_report(
    sections: Optional[Iterable[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Map every live heading to stable intent IDs for maintainers and CI."""
    if sections is None:
        from utils.game_help_chat import load_sections

        sections = load_sections()
    section_rows = tuple(sections)
    mapping: dict[tuple[str, str, str, str], list[str]] = {
        section_key(section): [] for section in section_rows
    }
    orphaned_intents: list[str] = []
    for intent in load_catalog():
        matched = False
        for reference in intent["sections"]:
            key = section_key(reference)
            if key in mapping:
                mapping[key].append(intent["id"])
                matched = True
        if not matched:
            orphaned_intents.append(intent["id"])
    headings = [
        {
            "source": key[0],
            "kind": key[1],
            "category": key[2],
            "title": key[3],
            "intent_ids": sorted(intent_ids),
        }
        for key, intent_ids in sorted(mapping.items())
    ]
    return {
        "summary": {
            "headings": len(headings),
            "covered_headings": sum(bool(row["intent_ids"]) for row in headings),
            "intents": len(load_catalog()),
        },
        "uncovered_headings": [row for row in headings if not row["intent_ids"]],
        "orphaned_intents": sorted(orphaned_intents),
        "headings": headings,
    }
