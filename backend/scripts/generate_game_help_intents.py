"""Generate the guides-only deterministic Game Guide intent catalog.

The output contains question language and exact guide references only. It never
copies factual answer text from the published FAQ or How To documents.
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BACKEND_DIR.parent
OUTPUT_DIR = BACKEND_DIR / "data" / "game_help_intents"
sys.path.insert(0, str(BACKEND_DIR))

from utils.game_help_chat import load_sections  # noqa: E402


DOMAIN_ORDER = (
    "onboarding_navigation",
    "combat_death",
    "money_banks_properties",
    "distillery_rackets",
    "weed_empire",
    "cars_crimes",
    "jail",
    "travel_states",
    "families",
    "casinos_minigames",
    "progression_wealth",
    "loot_store_pass",
    "auto_rank",
    "social_help_formatting",
    "rules_punishments",
    "cross_feature",
)

CATEGORY_DOMAINS = {
    "COMBAT": "combat_death",
    "COMBAT & LOADOUT": "combat_death",
    "MONEY MAKING": "money_banks_properties",
    "MONEY & BUSINESSES": "money_banks_properties",
    "WEED EMPIRE": "weed_empire",
    "GARAGE & VEHICLES": "cars_crimes",
    "CARS & GARAGE": "cars_crimes",
    "CRIMES": "cars_crimes",
    "CRIMES & ORGANISED CRIME": "cars_crimes",
    "JAIL SYSTEM": "jail",
    "TRAVEL": "travel_states",
    "TRAVEL & STATES": "travel_states",
    "FAMILIES": "families",
    "CASINOS": "casinos_minigames",
    "MINI-GAMES": "casinos_minigames",
    "CASINO & MINI-GAMES": "casinos_minigames",
    "PROGRESSION": "progression_wealth",
    "LOOT BOXES": "loot_store_pass",
    "POINT STORE": "loot_store_pass",
    "GAME PASS": "loot_store_pass",
    "STORE & GAME PASS": "loot_store_pass",
    "AUTO RANK": "auto_rank",
    "SOCIAL FEATURES": "social_help_formatting",
    "PROFILE & ACCOUNT": "social_help_formatting",
    "SOCIAL & HELP": "social_help_formatting",
    "SMILEYS & FORMATTING": "social_help_formatting",
    "RULES & POLICIES": "rules_punishments",
    "PUNISHMENTS & APPEALS": "rules_punishments",
    "POINTS & PURCHASES": "rules_punishments",
    "REFUND & CHARGEBACK POLICY": "rules_punishments",
    "ALL PURCHASES ARE FINAL AND NON-REFUNDABLE": "rules_punishments",
    "FAQ": "cross_feature",
    "PRO TIPS": "cross_feature",
    "FINDING YOUR WAY": "onboarding_navigation",
}

ROUTE_ALIASES = {
    "COMBAT": ("/kill/attack", "/kill/bodyguards", "/kill/hitlist", "/kill/hitman"),
    "MONEY MAKING": ("/money/bank", "/money/property", "/money/racket", "/money/booze-run"),
    "WEED EMPIRE": ("/money/weed-empire",),
    "GARAGE & VEHICLES": ("/cars/garage", "/cars/buy", "/cars/sell"),
    "CRIMES": ("/crime/crimes", "/crime/gta", "/organised-crime"),
    "JAIL SYSTEM": ("/crime/jail",),
    "TRAVEL": ("/game/travel", "/game/states"),
    "FAMILIES": ("/game/family",),
    "CASINOS": ("/casino", "/sports-betting"),
    "MINI-GAMES": ("/casino/mini-games",),
    "PROGRESSION": ("/game/ranking", "/account/missions", "/account/prestige"),
    "POINT STORE": ("/game/store",),
    "GAME PASS": ("/game-pass",),
    "AUTO RANK": ("/account/autorank",),
    "SOCIAL FEATURES": ("/social/forum", "/social/inbox", "/game/help-desk"),
}

SPECIAL_DOMAIN_WORDS = {
    "distillery_rackets": ("distillery", "racket", "illegal business", "property heat"),
    "combat_death": ("dead", "death", "revive", "hitman", "attack", "weapon", "armour"),
    "progression_wealth": ("wealth", "rank", "prestige", "mission", "objective"),
}

CURATED_INTENTS = (
    {
        "id": "cross_feature.compare.interest-bank-vs-swiss-bank",
        "intent_type": "comparison",
        "variants": [
            "What is the difference between the Interest Bank and Swiss Bank?",
            "Interest Bank vs Swiss Bank",
            "Compare Swiss and Interest banks",
            "Which bank should I use?",
            "How are the two banks different?",
            "What about the other bank?",
            "Swiss or Interest Bank?",
        ],
        "targets": [
            ("faq", "MONEY MAKING", "Banks"),
            ("faq", "FAQ", "Q: What's the Interest Bank vs Swiss Bank?"),
            ("how_to", "MONEY & BUSINESSES", "Bank"),
        ],
        "entities": ["Interest Bank", "Swiss Bank", "bank"],
        "follow_ups": ["Does bank money count for wealth rank?", "How do I use the bank?"],
    },
    {
        "id": "cross_feature.compare.rp-rank-vs-wealth-rank",
        "intent_type": "comparison",
        "variants": [
            "What is the difference between RP rank and wealth rank?",
            "RP rank vs wealth rank",
            "Compare rank points and wealth",
            "Are wealth ranks and normal ranks the same?",
            "Which rank uses cash?",
            "Which rank uses RP?",
            "Explain the two types of rank",
        ],
        "targets": [
            ("faq", "PROGRESSION", "Ranks (13 total)"),
            ("faq", "MONEY MAKING", "Wealth ranks (cash on hand)"),
        ],
        "entities": ["RP rank", "wealth rank", "rank"],
        "follow_ups": ["What are wealth ranks?", "How does normal ranking work?"],
    },
    {
        "id": "cross_feature.compare.personal-vs-family-racket",
        "intent_type": "comparison",
        "variants": [
            "What is the difference between a personal racket and family racket?",
            "Personal racket vs family racket",
            "Compare illegal businesses and family rackets",
            "Are personal and family rackets the same?",
            "Which racket belongs to my family?",
            "Which racket can I own personally?",
            "Explain both kinds of racket",
        ],
        "targets": [
            ("faq", "MONEY MAKING", "Illegal Business (Personal Racket)"),
            ("faq", "FAMILIES", "Rackets"),
        ],
        "entities": ["personal racket", "family racket", "illegal business"],
        "follow_ups": ["How do personal rackets work?", "How do family rackets work?"],
    },
    {
        "id": "cross_feature.compare.property-heat-vs-distillery-heat",
        "intent_type": "comparison",
        "variants": [
            "What is the difference between property heat and distillery heat?",
            "Property heat vs distillery heat",
            "Compare property and distillery heat",
            "Is all heat the same?",
            "Which heat blocks property collections?",
            "Which heat affects the distillery?",
            "Explain both kinds of heat",
        ],
        "targets": [
            ("faq", "FAQ", "Q: Why can't I collect property income? / What is Heat?"),
            ("faq", "FAQ", "Q: Why are property collections still blocked when Heat is low?"),
            ("faq", "FAQ", "Q: How does the Distillery work?"),
        ],
        "entities": ["property heat", "distillery heat", "heat"],
        "follow_ups": ["Why can't I collect property income?", "How does the Distillery work?"],
    },
    {
        "id": "cross_feature.yes-no.bank-money-counts-for-wealth",
        "intent_type": "yes_no",
        "variants": [
            "Does bank money count for wealth rank?",
            "Does Swiss Bank cash count toward wealth?",
            "Does Interest Bank money count toward my wealth tier?",
            "Is protected cash included in wealth rank?",
            "Do banks increase my wealth rank?",
            "What money counts for wealth rank?",
            "Is wealth based on cash on hand?",
        ],
        "targets": [
            ("faq", "MONEY MAKING", "Wealth ranks (cash on hand)"),
            ("how_to", "FINDING YOUR WAY", "Cash vs bank"),
        ],
        "entities": ["bank money", "wealth rank", "cash on hand"],
        "follow_ups": ["What are wealth ranks?", "Interest Bank vs Swiss Bank"],
    },
    {
        "id": "cross_feature.troubleshoot.new-player-attack",
        "intent_type": "troubleshooting",
        "variants": [
            "Why can't I attack a new player?",
            "Why is attacking this new account blocked?",
            "I cannot hire a hitman on a new player",
            "New player attack is not working",
            "Why does new account protection stop attacks?",
            "Can I attack someone who just joined?",
            "Hitman is blocked on a new account",
        ],
        "targets": [
            ("faq", "COMBAT", "New-account protection"),
            ("faq", "FAQ", "Q: Why can’t I attack / hire a Hitman on a new player?"),
        ],
        "entities": ["new player", "new account protection", "attack", "hitman"],
        "follow_ups": ["How does attacking work?", "What is Hitman for Hire?"],
    },
    {
        "id": "cross_feature.troubleshoot.property-collection",
        "intent_type": "troubleshooting",
        "variants": [
            "Why can't I collect property income?",
            "My property collection is blocked",
            "Property income is not working",
            "Why can I not collect when heat is low?",
            "What stops property collections?",
            "I cannot collect from My Properties",
            "Help with a blocked property collection",
        ],
        "targets": [
            ("faq", "FAQ", "Q: Why can't I collect property income? / What is Heat?"),
            ("faq", "FAQ", "Q: Why are property collections still blocked when Heat is low?"),
            ("how_to", "MONEY & BUSINESSES", "My Properties"),
        ],
        "entities": ["property collection", "property heat", "My Properties"],
        "follow_ups": ["What is property heat?", "Where is My Properties?"],
    },
    {
        "id": "cross_feature.yes-no.jail-blocks-actions",
        "intent_type": "yes_no",
        "variants": [
            "Can I play normally while I am in jail?",
            "What is blocked while jailed?",
            "Can I attack from jail?",
            "Can I travel while in jail?",
            "Does jail stop game actions?",
            "What can I do while jailed?",
            "Which actions are unavailable in jail?",
        ],
        "targets": [
            ("faq", "JAIL SYSTEM", "What the server blocks while you’re in jail"),
            ("how_to", "CRIMES & ORGANISED CRIME", "Jail"),
        ],
        "entities": ["jail", "blocked actions", "attack", "travel"],
        "follow_ups": ["How do I get out of jail?", "How do I bust someone?"],
    },
)


def slug(value: str) -> str:
    normalized = value.lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", normalized).strip("-") or "topic"


def topic_text(title: str) -> str:
    topic = re.sub(r"^\s*Q:\s*", "", title, flags=re.I).strip().rstrip(":")
    return topic.replace("�", "'")


def unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        clean = re.sub(r"\s+", " ", value).strip()
        key = clean.casefold()
        if clean and key not in seen:
            seen.add(key)
            result.append(clean)
    return result


def choose_domain(section: dict[str, Any]) -> str:
    category = section["category"]
    title = topic_text(section["title"]).lower()
    for domain, words in SPECIAL_DOMAIN_WORDS.items():
        if any(word in title for word in words):
            return domain
    return CATEGORY_DOMAINS.get(category, "cross_feature")


def overview_variants(
    topic: str,
    original_title: str,
    category: str,
    disambiguate: bool,
) -> list[str]:
    variants = []
    if disambiguate:
        variants.append(f"What is {topic} in {category}?")
    if original_title.lstrip().lower().startswith("q:"):
        variants.append(topic)
    variants.extend(
        [
            f"What is {topic}?",
            f"What are {topic}?",
            f"Tell me about {topic}",
            f"Explain {topic}",
            f"How does {topic} work?",
            f"I need information about {topic}",
            f"Give me the guide for {topic}",
            f"What should I know about {topic}?",
        ]
    )
    return unique(variants)[:7]


def secondary_variants(topic: str, source: str) -> tuple[str, list[str]]:
    if source == "how_to":
        return (
            "procedure",
            unique(
                [
                    f"How do I use {topic}?",
                    f"How do I start {topic}?",
                    f"Where do I find {topic}?",
                    f"What do I do for {topic}?",
                    f"Show me how to do {topic}",
                    f"Help me with {topic}",
                    f"Which menu has {topic}?",
                ]
            ),
        )
    return (
        "rules",
        unique(
            [
                f"What are the rules for {topic}?",
                f"What happens with {topic}?",
                f"Does the FAQ explain {topic}?",
                f"Can you clarify {topic}?",
                f"Which FAQ covers {topic}?",
                f"I have a question about {topic}",
                f"How is {topic} supposed to work?",
            ]
        ),
    )


def section_ref(section: dict[str, Any]) -> dict[str, str]:
    return {
        "source": section["source"],
        "kind": section["kind"],
        "category": section["category"],
        "title": section["title"],
    }


def _find_exact_section(
    sections: tuple[dict[str, Any], ...],
    target: tuple[str, str, str],
) -> dict[str, Any]:
    source, category, title = target
    for section in sections:
        if (
            section["source"] == source
            and section["category"] == category
            and section["title"] == title
        ):
            return section
    raise ValueError(f"Curated intent target does not exist: {target}")


def build_catalog() -> dict[str, list[dict[str, Any]]]:
    shards: dict[str, list[dict[str, Any]]] = defaultdict(list)
    id_counts: dict[str, int] = defaultdict(int)
    sections = load_sections()
    title_counts: dict[str, int] = defaultdict(int)
    for section in sections:
        title_counts[topic_text(section["title"]).casefold()] += 1

    for section in sections:
        topic = topic_text(section["title"])
        domain = choose_domain(section)
        base = f"{domain}.{slug(section['category'])}.{slug(topic)}"
        id_counts[base] += 1
        if id_counts[base] > 1:
            base = f"{base}-{section['source']}"
        reference = section_ref(section)
        route_aliases = list(ROUTE_ALIASES.get(section["category"], ()))

        overview_id = f"{base}.overview"
        secondary_type, secondary_questions = secondary_variants(topic, section["source"])
        secondary_id = f"{base}.{secondary_type}"
        common = {
            "domain": domain,
            "entities": [topic, section["category"]],
            "sections": [reference],
            "source_preference": section["source"],
            "route_aliases": route_aliases,
        }
        shards[domain].append(
            {
                "id": overview_id,
                **common,
                "intent_type": "definition",
                "variants": overview_variants(
                    topic,
                    section["title"],
                    section["category"],
                    title_counts[topic.casefold()] > 1,
                ),
                "related_intents": [secondary_id],
                "follow_ups": [
                    f"How do I use {topic}?",
                    f"What are the rules for {topic}?",
                    f"Where do I find {topic}?",
                ],
            }
        )
        shards[domain].append(
            {
                "id": secondary_id,
                **common,
                "intent_type": secondary_type,
                "variants": secondary_questions,
                "related_intents": [overview_id],
                "follow_ups": [
                    f"Tell me about {topic}",
                    f"What happens with {topic}?",
                    f"Show me the {section['category']} guide",
                ],
            }
        )

    for spec in CURATED_INTENTS:
        references = [
            section_ref(_find_exact_section(sections, target))
            for target in spec["targets"]
        ]
        shards["cross_feature"].append(
            {
                "id": spec["id"],
                "domain": "cross_feature",
                "entities": spec["entities"],
                "sections": references,
                "source_preference": references[0]["source"],
                "route_aliases": [],
                "intent_type": spec["intent_type"],
                "variants": spec["variants"],
                "related_intents": [],
                "follow_ups": spec["follow_ups"],
            }
        )

    for domain in DOMAIN_ORDER:
        domain_rows = shards[domain]
        by_category: dict[str, list[str]] = defaultdict(list)
        for row in domain_rows:
            by_category[row["sections"][0]["category"]].append(row["id"])
        for row in domain_rows:
            category = row["sections"][0]["category"]
            sibling_ids = [value for value in by_category[category] if value != row["id"]]
            row["related_intents"] = unique(row["related_intents"] + sibling_ids[:3])
    return shards


def write_catalog(shards: dict[str, list[dict[str, Any]]]) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for old_file in OUTPUT_DIR.glob("*.json"):
        old_file.unlink()
    manifest: dict[str, Any] = {"version": 1, "shards": [], "intent_count": 0, "variant_count": 0}
    for domain in DOMAIN_ORDER:
        rows = shards.get(domain, [])
        filename = f"{domain}.json"
        payload = {"domain": domain, "intents": rows}
        (OUTPUT_DIR / filename).write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        variant_count = sum(len(row["variants"]) for row in rows)
        manifest["shards"].append(
            {"file": filename, "intents": len(rows), "variants": variant_count}
        )
        manifest["intent_count"] += len(rows)
        manifest["variant_count"] += variant_count
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {manifest['intent_count']} intents and "
        f"{manifest['variant_count']} question variants to {OUTPUT_DIR}"
    )


if __name__ == "__main__":
    write_catalog(build_catalog())
