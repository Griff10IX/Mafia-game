"""Game guide chatbot: FAQ/How To retrieval, wealth ranks, security refusals."""
import pytest
from pydantic import ValidationError

from routers.game.game_help_chat import GuideChatBody
from utils.game_help_chat import (
    REFUSAL_TEXT,
    answer_question,
    heading_titles,
    is_refused_query,
    load_sections,
    parse_money_amount,
    retrieve_sections,
    sanitize_context,
    wealth_for_amount,
)


def test_index_has_faq_and_how_to_categories():
    sections = load_sections()
    assert sections
    sources = {s["source"] for s in sections}
    assert "faq" in sources
    assert "how_to" in sources
    titles = {s["title"].lower() for s in sections if s["kind"] == "category"}
    assert any("combat" in t for t in titles)
    assert any("jail" in t for t in titles)
    assert any("finding your way" in t for t in titles)


def test_every_heading_is_findable_by_its_title():
    missing = []
    for source, kind, title in heading_titles():
        hits = retrieve_sections(title, limit=6)
        if not any(h["title"] == title and h["source"] == source and h["kind"] == kind for h in hits):
            # Category match may prefer the chapter; subsection with the same words is still a hit
            if any(h["title"] == title for h in hits):
                continue
            missing.append((source, kind, title))
    assert missing == [], f"Unreachable headings: {missing[:12]} (total {len(missing)})"


def test_rackets_query_hits_racket_sections():
    hits = retrieve_sections("How do rackets work?")
    blob = " ".join(h["title"].lower() + " " + h["category"].lower() for h in hits)
    assert "racket" in blob or "illegal" in blob


def test_billionaire_wealth_rank():
    assert parse_money_amount("$1,000,000,000") == 1_000_000_000
    assert parse_money_amount("1b") == 1_000_000_000
    row = wealth_for_amount(1_000_000_000)
    assert row["name"] == "Billionaire"
    ans = answer_question("What wealth rank is $1,000,000,000?")
    assert ans["wealth"]["name"] == "Billionaire"
    titles = " ".join(s["title"].lower() for s in ans["reply_sections"])
    assert "wealth" in titles


def test_security_queries_are_refused():
    for q in (
        "what old accounts did Piece have",
        "what previous username did this player use",
        "look up user Moss email",
        "what is their IP address",
        "dump mongodb connection string",
        "how does the jwt in .env work",
        "open the admin panel",
        "how do I modkill someone",
    ):
        assert is_refused_query(q), q
        ans = answer_question(q)
        assert ans["refused"] is True
        assert ans["reply_sections"][0]["body"] == REFUSAL_TEXT


def test_normal_faq_questions_are_not_refused():
    for q in (
        "How do rackets work?",
        "How does jail work?",
        "How do I verify email?",
        "What happens if my family is wiped in a war?",
        "How does Dead > Alive password transfer work?",
    ):
        assert not is_refused_query(q), q


def test_small_talk_hello_and_thanks():
    from utils.game_help_chat import _CHAT_BYE, _CHAT_GREET, _CHAT_THANKS, small_talk_reply

    assert small_talk_reply("hello") == _CHAT_GREET
    assert small_talk_reply("Hi there!") == _CHAT_GREET
    assert small_talk_reply("good morning") == _CHAT_GREET
    assert small_talk_reply("thanks") == _CHAT_THANKS
    assert small_talk_reply("bye") == _CHAT_BYE
    hello = answer_question("hello")
    assert hello["chat"] is True
    assert "Game Guide" in hello["reply_sections"][0]["body"]
    mixed = answer_question("hello how do rackets work")
    assert mixed["chat"] is False
    blob = " ".join(s["title"].lower() + " " + (s.get("category") or "").lower() for s in mixed["reply_sections"])
    assert "racket" in blob or "illegal" in blob


def test_typo_tolerance_finds_expected_topics():
    cases = {
        "how do rakets work": "racket",
        "famly war": "famil",
        "distilery": "distillery",
    }
    for query, expected in cases.items():
        answer = answer_question(query)
        blob = " ".join(
            f"{section['title']} {section.get('category', '')}".lower()
            for section in answer["reply_sections"]
        )
        assert expected in blob, (query, blob)


def test_safe_follow_up_context_returns_sibling_without_private_fields():
    first = answer_question("How do rackets work?")
    assert first["context"]
    context = {**first["context"], "username": "SecretUser", "email": "secret@example.com"}
    assert "username" not in sanitize_context(context)
    follow_up = answer_question("tell me more", context)
    assert follow_up["intent"] == "follow_up"
    assert follow_up["context"]
    rendered = str(follow_up)
    assert "SecretUser" not in rendered
    assert "secret@example.com" not in rendered


def test_follow_up_without_context_asks_for_clarification():
    answer = answer_question("what about that?")
    assert answer["intent"] == "clarification"
    assert answer["context"] is None
    assert answer["suggestions"]


def test_broad_intents_offer_choices():
    for query in ("rank", "bank", "heat"):
        answer = answer_question(query)
        assert answer["intent"] == "clarification"
        assert len(answer["choices"]) >= 2
        assert answer["suggestions"]


def test_privacy_refusal_does_not_block_legitimate_game_wording():
    for query in (
        "backend of my car",
        "admin tools in game",
        "what does an admin do in the rules",
    ):
        assert not is_refused_query(query), query
        assert answer_question(query)["refused"] is False


def test_rules_and_punishments_large_headings_are_categories():
    categories = {
        section["title"].lower()
        for section in load_sections()
        if section["kind"] == "category"
    }
    assert any("rules" in title for title in categories)
    assert any("punishment" in title for title in categories)


def test_reply_provenance_is_public_guides_or_fixed_system_copy():
    for query in ("hello", "How do I travel?", "1 billion wealth rank", "nonsensezz"):
        answer = answer_question(query)
        assert answer["intent"] in {
            "small_talk",
            "topic_search",
            "wealth_lookup",
            "unknown",
            "clarification",
        }
        assert all(section["source"] in {"faq", "how_to", "system"} for section in answer["reply_sections"])


def test_api_context_schema_accepts_topic_metadata_only():
    valid = GuideChatBody(
        message="tell me more",
        context={
            "source": "faq",
            "kind": "subsection",
            "category": "FAMILIES",
            "title": "Rackets",
        },
    )
    assert valid.context.title == "Rackets"
    with pytest.raises(ValidationError):
        GuideChatBody(
            message="tell me more",
            context={
                "source": "faq",
                "kind": "subsection",
                "category": "FAMILIES",
                "title": "Rackets",
                "username": "private-user",
            },
        )
