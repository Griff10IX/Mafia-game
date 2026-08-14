"""Fixture-driven answer plans, context, security, wealth, and provenance tests."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from routers.game.game_help_chat import GuideChatBody, GuideChatResponse
from utils.config import WEALTH_RANKS
from utils.game_help_chat import (
    REFUSAL_TEXT,
    answer_question,
    detect_question_shape,
    is_refused_query,
    load_sections,
    parse_money_amount,
    resolve_entities,
    sanitize_context,
    wealth_for_amount,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "game_guide"


def load_fixture(filename: str):
    return json.loads((FIXTURE_DIR / filename).read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", load_fixture("dialog_cases.json"))
def test_golden_dialog_cases(case):
    answer = answer_question(case["question"])
    assert answer["refused"] is False
    assert answer["answer_type"] == case["answer_type"]
    assert answer["confidence"] in {"high", "medium"}
    if case.get("intent_id"):
        assert answer["intent_id"] == case["intent_id"]
    titles = [section["title"] for section in answer["reply_sections"]]
    if case.get("titles"):
        assert titles == case["titles"]
    if case.get("title_contains"):
        assert case["title_contains"] in " ".join(titles).lower()
    GuideChatResponse.model_validate(answer)


def test_comparison_returns_multiple_independently_cited_sections():
    answer = answer_question("Personal racket vs family racket")
    assert answer["answer_type"] == "comparison"
    assert len(answer["reply_sections"]) == 2
    assert len(answer["provenance"]) == 2
    assert {row["category"] for row in answer["provenance"]} == {"MONEY MAKING", "FAMILIES"}


def test_yes_no_and_troubleshooting_are_shapes_not_generated_facts():
    yes_no = answer_question("Does bank money count for wealth rank?")
    problem = answer_question("My property collection is blocked")
    assert yes_no["answer_type"] == "yes_no"
    assert problem["answer_type"] == "troubleshooting"
    assert all(section["source"] in {"faq", "how_to"} for section in yes_no["reply_sections"])
    assert all(section["source"] in {"faq", "how_to"} for section in problem["reply_sections"])
    assert all(row["method"] == "verbatim_guide_section" for row in yes_no["provenance"])
    assert all(row["method"] == "verbatim_guide_section" for row in problem["provenance"])


def test_all_factual_bodies_are_exact_live_guide_bodies():
    live_bodies = {
        (section["source"], section["category"], section["title"], section["body"])
        for section in load_sections()
    }
    questions = [case["question"] for case in load_fixture("dialog_cases.json")]
    questions.extend(
        [
            "How do rakets work?",
            "How does distilery work?",
            "What wealth rank is $1 billion?",
            "How do family wars work?",
            "How can I travel?",
        ]
    )
    for question in questions:
        answer = answer_question(question)
        for section in answer["reply_sections"]:
            if section["source"] == "system":
                continue
            key = (
                section["source"],
                section["category"],
                section["title"],
                section["body"],
            )
            assert key in live_bodies, question


def test_provenance_has_one_row_per_guide_section():
    for case in load_fixture("dialog_cases.json"):
        answer = answer_question(case["question"])
        assert len(answer["provenance"]) == len(answer["reply_sections"])
        for section, provenance in zip(answer["reply_sections"], answer["provenance"]):
            assert provenance["source"] == section["source"]
            assert provenance["title"] == section["title"]
            if section["source"] != "system":
                assert provenance["category"] == section["category"]


def test_typo_corrections_are_public_heading_terms_only():
    answer = answer_question("how do rakets and distilery work")
    corrections = {(item["from"], item["to"]) for item in answer["typo_corrections"]}
    assert ("rakets", "rackets") in corrections or ("rakets", "racket") in corrections
    assert ("distilery", "distillery") in corrections
    assert answer["match_method"] == "fuzzy_section"


def test_bank_context_resolves_what_about_swiss():
    first = answer_question("How do banks work?")
    second = answer_question("what about Swiss?", first["context"])
    assert second["intent_id"] == "cross_feature.compare.interest-bank-vs-swiss-bank"
    assert second["answer_type"] == "comparison"
    assert second["confidence"] == "high"


def test_other_one_uses_second_published_comparison_section():
    first = answer_question("Interest Bank vs Swiss Bank")
    second = answer_question("the other one", first["context"])
    assert second["intent"] == "follow_up"
    assert second["match_method"] == "context_other_section"
    assert second["reply_sections"][0]["title"] != first["reply_sections"][0]["title"]


def test_why_uses_current_section_without_message_history():
    first = answer_question("What is Prestige?")
    second = answer_question("why?", first["context"])
    assert second["intent"] == "follow_up"
    assert second["reply_sections"][0]["title"] == first["reply_sections"][0]["title"]
    assert second["match_method"] == "safe_topic_context"


def test_follow_up_without_context_clarifies():
    answer = answer_question("the other one")
    assert answer["intent"] == "clarification"
    assert answer["answer_type"] == "clarification"
    assert answer["context"] is None


def test_context_sanitizer_keeps_only_public_topic_metadata():
    dirty = {
        "source": "faq",
        "kind": "subsection",
        "category": "MONEY MAKING",
        "title": "Banks",
        "intent_id": "cross_feature.compare.interest-bank-vs-swiss-bank",
        "domain": "cross_feature",
        "answer_type": "comparison",
        "choice_intent_ids": ["one", "two", "three", "four", "five", "six"],
        "username": "PrivatePlayer",
        "email": "private@example.com",
        "message_history": ["secret"],
        "player_id": "123",
    }
    safe = sanitize_context(dirty)
    assert set(safe) == {
        "source",
        "kind",
        "category",
        "title",
        "intent_id",
        "domain",
        "answer_type",
        "choice_intent_ids",
    }
    assert len(safe["choice_intent_ids"]) == 5
    assert "PrivatePlayer" not in str(safe)
    assert "private@example.com" not in str(safe)


def test_api_rejects_private_or_oversized_context_fields():
    with pytest.raises(ValidationError):
        GuideChatBody(
            message="tell me more",
            context={
                "source": "faq",
                "kind": "subsection",
                "category": "FAMILIES",
                "title": "Rackets",
                "player_id": "private",
            },
        )
    with pytest.raises(ValidationError):
        GuideChatBody(
            message="first one",
            context={
                "source": "faq",
                "kind": "subsection",
                "category": "FAMILIES",
                "title": "Rackets",
                "choice_intent_ids": ["1", "2", "3", "4", "5", "6"],
            },
        )


def test_security_fixture_refusals_and_false_positive_guards():
    cases = load_fixture("security_cases.json")
    for question in cases["refused"]:
        assert is_refused_query(question) or answer_question(question)["refused"], question
        answer = answer_question(question)
        assert answer["refused"] is True
        assert answer["reply_sections"][0]["body"] == REFUSAL_TEXT
        assert answer["match_method"] == "fixed_system_copy"
    for question in cases["allowed"]:
        assert not is_refused_query(question), question
        assert answer_question(question)["refused"] is False


def test_off_topic_fixture_returns_fixed_unknown_copy():
    for question in load_fixture("security_cases.json")["off_topic"]:
        answer = answer_question(question)
        assert answer["refused"] is False
        assert answer["intent"] == "unknown"
        assert answer["answer_type"] == "unknown"
        assert answer["reply_sections"][0]["source"] == "system"


@pytest.mark.parametrize(
    ("question", "shape"),
    [
        ("What is Prestige?", "definition"),
        ("How do I travel?", "procedure"),
        ("Can I attack from jail?", "yes_no"),
        ("Why can't I collect?", "troubleshooting"),
        ("Bank versus Swiss Bank", "comparison"),
        ("What are the combat rules?", "rules"),
    ],
)
def test_question_shape_detection(question, shape):
    assert detect_question_shape(question)["shape"] == shape


def test_entity_resolution_prefers_long_specific_aliases():
    entities = resolve_entities(
        "Does Swiss Bank money count for wealth rank, unlike cash on hand?"
    )
    pairs = {(item["type"], item["value"]) for item in entities}
    assert ("bank_type", "swiss_bank") in pairs
    assert ("rank_type", "wealth_rank") in pairs
    assert ("money_scope", "cash_on_hand") in pairs


def test_every_wealth_tier_at_its_threshold():
    assert len(WEALTH_RANKS) >= 20
    for row in WEALTH_RANKS:
        result = wealth_for_amount(int(row["min_money"]))
        assert result["id"] == row["id"]
        assert result["name"] == row["name"]


@pytest.mark.parametrize(
    ("text", "amount"),
    [
        ("$1,000", 1_000),
        ("1m", 1_000_000),
        ("1.5 million", 1_500_000),
        ("2b", 2_000_000_000),
        ("3.25 billion", 3_250_000_000),
        ("1t", 1_000_000_000_000),
        ("I have $500 and $20,000", 20_000),
    ],
)
def test_common_money_formats(text, amount):
    assert parse_money_amount(text) == amount


def test_wealth_answer_has_computed_result_and_guide_source():
    answer = answer_question("What wealth rank is $1,000,000,000?")
    assert answer["wealth"]["name"] == "Billionaire"
    assert answer["intent"] == "wealth_lookup"
    assert any("wealth" in section["title"].lower() for section in answer["reply_sections"])
    assert all(section["source"] in {"faq", "how_to"} for section in answer["reply_sections"])
