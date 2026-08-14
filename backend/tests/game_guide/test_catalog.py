"""Catalog structure, reachability, matching, and grounding invariants."""
from __future__ import annotations

from collections import Counter

import pytest

from utils.game_help_catalog import (
    CATALOG_DIR,
    content_tokens,
    coverage_report,
    load_catalog,
    match_catalog,
    normalize,
    section_key,
    validate_catalog,
)
from utils.game_help_chat import load_sections


ALLOWED_CATALOG_FIELDS = {
    "id",
    "domain",
    "entities",
    "sections",
    "source_preference",
    "route_aliases",
    "intent_type",
    "variants",
    "related_intents",
    "follow_ups",
}
PRIVATE_ROUTE_PARTS = {
    "admin",
    "staff",
    "moderator",
    "backend",
    "database",
    "mongo",
    "users/",
    "players/",
}


def test_catalog_size_and_every_guide_heading_is_covered():
    report = validate_catalog(load_sections())
    assert report["intents"] >= 450
    assert report["variants"] >= 3_000
    assert report["guide_sections"] >= 200
    assert report["referenced_sections"] == report["guide_sections"]
    assert report["uncovered_sections"] == []


def test_manifest_has_domain_shards_and_generated_line_target():
    files = sorted(path for path in CATALOG_DIR.glob("*.json") if path.name != "manifest.json")
    assert len(files) >= 16
    line_count = sum(len(path.read_text(encoding="utf-8").splitlines()) for path in files)
    assert line_count >= 3_500


def test_coverage_report_has_no_uncovered_or_orphaned_records():
    report = coverage_report(load_sections())
    assert report["summary"]["headings"] == report["summary"]["covered_headings"]
    assert report["summary"]["intents"] >= 450
    assert report["uncovered_headings"] == []
    assert report["orphaned_intents"] == []
    assert all(row["intent_ids"] for row in report["headings"])


def test_catalog_contains_question_language_and_references_only():
    forbidden_fields = {
        "answer",
        "answer_text",
        "body",
        "facts",
        "price",
        "timer",
        "percentage",
        "instructions",
    }
    for intent in load_catalog():
        assert set(intent) == ALLOWED_CATALOG_FIELDS
        assert not (set(intent) & forbidden_fields)
        assert len(intent["variants"]) >= 5
        assert all("[" not in variant and "]" not in variant for variant in intent["variants"])


def test_ids_are_unique_stable_and_domain_prefixed():
    ids = [intent["id"] for intent in load_catalog()]
    assert len(ids) == len(set(ids))
    assert all(intent_id == intent_id.lower() for intent_id in ids)
    assert all(" " not in intent_id for intent_id in ids)
    assert all(intent_id.startswith(f"{intent['domain']}.") for intent_id, intent in zip(ids, load_catalog()))


def test_route_aliases_are_player_facing_only():
    for intent in load_catalog():
        for route in intent["route_aliases"]:
            lowered = route.lower()
            assert route.startswith("/")
            assert not any(part in lowered for part in PRIVATE_ROUTE_PARTS)


def test_all_section_references_are_exact_live_keys():
    live_keys = {section_key(section) for section in load_sections()}
    catalog_keys = {
        section_key(reference)
        for intent in load_catalog()
        for reference in intent["sections"]
    }
    assert catalog_keys == live_keys


def test_relationships_resolve_and_never_self_reference():
    by_id = {intent["id"]: intent for intent in load_catalog()}
    for intent in load_catalog():
        assert intent["id"] not in intent["related_intents"]
        assert all(related in by_id for related in intent["related_intents"])


def test_every_intent_primary_variant_matches_itself_or_same_section():
    failures = []
    for intent in load_catalog():
        matches = match_catalog(intent["variants"][0], limit=5)
        wanted_keys = {section_key(ref) for ref in intent["sections"]}
        if not matches:
            failures.append((intent["id"], "no matches"))
            continue
        equivalent = [
            match
            for match in matches
            if match.intent["id"] == intent["id"]
            or wanted_keys & {section_key(ref) for ref in match.intent["sections"]}
        ]
        if not equivalent or equivalent[0].score < 68:
            failures.append((intent["id"], [(match.intent["id"], match.score) for match in matches]))
    assert failures == [], failures[:10]


@pytest.mark.parametrize(
    ("question", "intent_id"),
    [
        ("Interest Bank vs Swiss Bank", "cross_feature.compare.interest-bank-vs-swiss-bank"),
        ("RP rank vs wealth rank", "cross_feature.compare.rp-rank-vs-wealth-rank"),
        ("Personal racket vs family racket", "cross_feature.compare.personal-vs-family-racket"),
        ("Property heat vs distillery heat", "cross_feature.compare.property-heat-vs-distillery-heat"),
        ("Does bank money count for wealth rank?", "cross_feature.yes-no.bank-money-counts-for-wealth"),
        ("Why can't I attack a new player?", "cross_feature.troubleshoot.new-player-attack"),
        ("My property collection is blocked", "cross_feature.troubleshoot.property-collection"),
        ("Can I attack from jail?", "cross_feature.yes-no.jail-blocks-actions"),
    ],
)
def test_curated_cross_feature_questions_win(question, intent_id):
    match = match_catalog(question, limit=1)[0]
    assert match.intent["id"] == intent_id
    assert match.confidence == "high"


def test_question_vocabulary_has_real_topic_content():
    empty = []
    for intent in load_catalog():
        for variant in intent["variants"]:
            if not content_tokens(variant):
                empty.append((intent["id"], variant))
    assert empty == []


def test_no_duplicate_variants_inside_an_intent():
    for intent in load_catalog():
        normalized = [normalize(variant) for variant in intent["variants"]]
        duplicates = [value for value, count in Counter(normalized).items() if count > 1]
        assert duplicates == [], (intent["id"], duplicates)
