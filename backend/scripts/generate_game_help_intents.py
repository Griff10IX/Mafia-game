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
            "How do rackets work?",
            "Explain rackets",
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
            ("faq", "MONEY MAKING", "Properties"),
            ("faq", "MONEY MAKING", "Distillery"),
            ("faq", "WEED EMPIRE", "Heat & busts"),
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

FEATURE_GUIDES = (
    {
        "id": "cross_feature.feature.distillery",
        "intent_type": "definition",
        "variants": [
            "How does the Distillery work?",
            "How does Distillery work?",
            "Explain the Distillery",
            "Tell me about the Distillery",
            "How do I use the Distillery?",
            "What is the Distillery?",
            "Distillery guide",
            "How do I run a distillery?",
        ],
        "targets": [
            ("faq", "MONEY MAKING", "Distillery"),
            ("how_to", "MONEY & BUSINESSES", "Distillery (quick tour)"),
        ],
        "entities": ["Distillery", "vault", "heat", "workers"],
        "follow_ups": [
            "What is Distillery heat?",
            "How do personal rackets work?",
            "What do I get when I kill someone with a Distillery?",
        ],
    },
    {
        "id": "cross_feature.feature.weed-empire",
        "intent_type": "definition",
        "variants": [
            "How does Weed Empire work?",
            "How does the Weed Empire work?",
            "Explain Weed Empire",
            "Tell me about Weed Empire",
            "How do I use Weed Empire?",
            "Weed Empire guide",
            "How does the weed farm work?",
        ],
        "targets": [
            ("faq", "WEED EMPIRE", "WEED EMPIRE"),
            ("how_to", "WEED EMPIRE", "Open the farm"),
            ("how_to", "WEED EMPIRE", "Grow"),
            ("how_to", "WEED EMPIRE", "Cash & vault"),
            ("how_to", "WEED EMPIRE", "Crew, raids, heat"),
        ],
        "entities": ["Weed Empire", "grow", "heat", "raids", "crew"],
        "follow_ups": [
            "How do Weed Empire raids work?",
            "What are special strains?",
            "How does weed business cash work?",
        ],
    },
    {
        "id": "cross_feature.feature.personal-racket",
        "intent_type": "definition",
        "variants": [
            "How do personal rackets work?",
            "How does my illegal business work?",
            "Explain personal rackets",
            "How do I collect from my racket?",
            "What is an illegal business?",
            "How do rackets work for me?",
            "Personal racket guide",
        ],
        "targets": [
            ("faq", "MONEY MAKING", "Illegal Business (Personal Racket)"),
            ("how_to", "MONEY & BUSINESSES", "Illegal businesses & collecting"),
        ],
        "entities": ["personal racket", "illegal business"],
        "follow_ups": ["How do family rackets work?", "How does the Distillery work?"],
    },
    {
        "id": "cross_feature.feature.properties",
        "intent_type": "definition",
        "variants": [
            "How do properties work?",
            "How does property income work?",
            "Explain properties",
            "How do I collect property income?",
            "What are properties?",
            "Property guide",
            "How do I buy property?",
        ],
        "targets": [
            ("faq", "MONEY MAKING", "Properties"),
            ("how_to", "MONEY & BUSINESSES", "Property"),
            ("how_to", "MONEY & BUSINESSES", "My Properties"),
        ],
        "entities": ["properties", "property heat", "upkeep"],
        "follow_ups": [
            "Why can't I collect property income?",
            "What is property heat?",
            "How does the Distillery work?",
        ],
    },
    {
        "id": "cross_feature.feature.banks",
        "intent_type": "definition",
        "variants": [
            "How do banks work?",
            "How does the bank work?",
            "Explain the banks",
            "How do I use the bank?",
            "What are the banks?",
            "Bank guide",
            "How do I deposit money?",
        ],
        "targets": [
            ("faq", "MONEY MAKING", "Banks"),
            ("how_to", "MONEY & BUSINESSES", "Bank"),
            ("how_to", "FINDING YOUR WAY", "Cash vs bank"),
        ],
        "entities": ["bank", "Swiss Bank", "Interest Bank"],
        "follow_ups": [
            "Interest Bank vs Swiss Bank",
            "Does bank money count for wealth rank?",
        ],
    },
    {
        "id": "cross_feature.feature.jail",
        "intent_type": "definition",
        "variants": [
            "How does jail work?",
            "Explain jail",
            "Tell me about jail",
            "How do I get out of jail?",
            "What happens in jail?",
            "Jail guide",
            "How do busts work?",
        ],
        "targets": [
            ("faq", "JAIL SYSTEM", "JAIL SYSTEM"),
            ("faq", "JAIL SYSTEM", "Getting Out"),
            ("how_to", "CRIMES & ORGANISED CRIME", "Jail"),
        ],
        "entities": ["jail", "bust", "snitching"],
        "follow_ups": ["Can I attack from jail?", "How do I bust someone?"],
    },
    {
        "id": "cross_feature.feature.families",
        "intent_type": "definition",
        "variants": [
            "How do families work?",
            "Explain families",
            "Tell me about families",
            "How do I join a family?",
            "What are families?",
            "Family guide",
            "How does a crew work?",
        ],
        "targets": [
            ("faq", "FAMILIES", "FAMILIES"),
            ("how_to", "FAMILIES", "FAMILIES"),
        ],
        "entities": ["families", "crew", "compound"],
        "follow_ups": ["How do family rackets work?", "How do family wars work?"],
    },
    {
        "id": "cross_feature.feature.travel",
        "intent_type": "definition",
        "variants": [
            "How does travel work?",
            "How do I travel?",
            "Explain travel",
            "How do I change cities?",
            "What is travel?",
            "Travel guide",
            "How do states work?",
        ],
        "targets": [
            ("faq", "TRAVEL", "TRAVEL"),
            ("how_to", "TRAVEL & STATES", "Travel"),
            ("how_to", "TRAVEL & STATES", "States"),
        ],
        "entities": ["travel", "states", "airport"],
        "follow_ups": ["Why should I travel?", "How do cars affect travel?"],
    },
    {
        "id": "cross_feature.feature.combat",
        "intent_type": "definition",
        "variants": [
            "How does attacking work?",
            "How do I attack?",
            "Explain combat",
            "How does combat work?",
            "How do I kill someone?",
            "Attack guide",
            "How do fights work?",
        ],
        "targets": [
            ("faq", "COMBAT", "How Attacking Works"),
            ("how_to", "COMBAT & LOADOUT", "Attacking"),
        ],
        "entities": ["attack", "combat", "bullets"],
        "follow_ups": ["How do bodyguards work?", "What is Hitman for Hire?"],
    },
    {
        "id": "cross_feature.feature.cars",
        "intent_type": "definition",
        "variants": [
            "How do cars work?",
            "How does the garage work?",
            "Explain cars",
            "How do I use the garage?",
            "What are cars for?",
            "Garage guide",
            "How do vehicles work?",
            "How can I buy a car?",
            "How do I buy a car?",
        ],
        "targets": [
            ("faq", "GARAGE & VEHICLES", "GARAGE & VEHICLES"),
            ("how_to", "CARS & GARAGE", "Garage"),
            ("how_to", "CARS & GARAGE", "Buy & sell"),
        ],
        "entities": ["cars", "garage", "vehicles"],
        "follow_ups": ["How can I buy a car?", "How do I melt cars for bullets?"],
    },
    {
        "id": "cross_feature.feature.crimes",
        "intent_type": "definition",
        "variants": [
            "How do crimes work?",
            "How do I commit crimes?",
            "Explain crimes",
            "How do solo crimes work?",
            "What are crimes?",
            "Crime guide",
        ],
        "targets": [
            ("faq", "CRIMES", "Regular Crimes"),
            ("faq", "CRIMES", "GTA (Car Theft)"),
            ("how_to", "CRIMES & ORGANISED CRIME", "Solo crimes"),
            ("how_to", "CRIMES & ORGANISED CRIME", "GTA (car theft)"),
        ],
        "entities": ["crimes", "GTA", "organised crime"],
        "follow_ups": ["How does Organised Crime work?", "How does jail work?"],
    },
    {
        "id": "cross_feature.feature.organised-crime",
        "intent_type": "definition",
        "variants": [
            "How does Organised Crime work?",
            "How do heists work?",
            "Explain OC",
            "How do I start an OC?",
            "What is organised crime?",
            "Organised Crime guide",
            "How do crew OCs work?",
        ],
        "targets": [
            ("faq", "CRIMES", "Organised Crime (OC/Heists)"),
            ("how_to", "CRIMES & ORGANISED CRIME", "Organised Crime"),
        ],
        "entities": ["organised crime", "OC", "heists"],
        "follow_ups": ["How do crimes work?", "How do families work?"],
    },
    {
        "id": "cross_feature.feature.casinos",
        "intent_type": "definition",
        "variants": [
            "How do casinos work?",
            "Explain the casino",
            "How do I gamble?",
            "What games are in the casino?",
            "Casino guide",
            "How do I play casino games?",
        ],
        "targets": [
            ("faq", "CASINOS", "CASINOS"),
            ("how_to", "CASINO & MINI-GAMES", "Casino hub"),
            ("how_to", "CASINO & MINI-GAMES", "Sports betting"),
        ],
        "entities": ["casino", "gambling", "sports betting"],
        "follow_ups": ["How do mini-games work?", "How do I own a casino table?"],
    },
    {
        "id": "cross_feature.feature.mini-games",
        "intent_type": "definition",
        "variants": [
            "How do mini-games work?",
            "Explain mini-games",
            "What mini-games are there?",
            "Mini-games guide",
            "How do I play mini-games?",
            "Tell me about mini-games",
        ],
        "targets": [
            ("faq", "MINI-GAMES", "MINI-GAMES"),
            ("how_to", "CASINO & MINI-GAMES", "Mini-games"),
        ],
        "entities": ["mini-games", "Famiglia"],
        "follow_ups": ["How do casinos work?", "How does the mini-games leaderboard work?"],
    },
    {
        "id": "cross_feature.feature.prestige",
        "intent_type": "definition",
        "variants": [
            "How does Prestige work?",
            "What is Prestige?",
            "Explain Prestige",
            "How do I prestige?",
            "Prestige guide",
            "Tell me about Prestige",
            "What does Prestige do?",
        ],
        "targets": [
            ("faq", "PROGRESSION", "Prestige System"),
            ("how_to", "PROGRESSION", "Prestige & inventory"),
        ],
        "entities": ["prestige", "inventory"],
        "follow_ups": ["How do ranks work?", "How does Auto Rank work?"],
    },
    {
        "id": "cross_feature.feature.auto-rank",
        "intent_type": "definition",
        "variants": [
            "How does Auto Rank work?",
            "Explain Auto Rank",
            "What is Auto Rank?",
            "How do I use Auto Rank?",
            "Auto Rank guide",
            "Tell me about Auto Rank",
            "How does autorank work?",
        ],
        "targets": [
            ("faq", "AUTO RANK", "What it is"),
            ("how_to", "PROGRESSION", "Auto Rank"),
        ],
        "entities": ["Auto Rank", "autorank"],
        "follow_ups": ["How do crimes work?", "How does GTA work?"],
    },
    {
        "id": "cross_feature.feature.game-pass",
        "intent_type": "definition",
        "variants": [
            "How does Game Pass work?",
            "Explain Game Pass",
            "What is Game Pass?",
            "How do I use Game Pass?",
            "Game Pass guide",
            "Tell me about Game Pass",
            "How do I activate Game Pass?",
        ],
        "targets": [
            ("faq", "GAME PASS", "GAME PASS"),
            ("how_to", "STORE & GAME PASS", "Game Pass"),
        ],
        "entities": ["Game Pass", "VIP"],
        "follow_ups": ["How does the store work?", "What are special strains?"],
    },
    {
        "id": "cross_feature.feature.booze-runs",
        "intent_type": "definition",
        "variants": [
            "How do booze runs work?",
            "Explain booze runs",
            "How do I smuggle booze?",
            "What are booze runs?",
            "Booze run guide",
            "How does booze work?",
            "Tell me about booze runs",
        ],
        "targets": [
            ("faq", "MONEY MAKING", "Booze Runs"),
            ("how_to", "MONEY & BUSINESSES", "Other money pages"),
        ],
        "entities": ["booze runs", "booze"],
        "follow_ups": ["How does travel work?", "How does the Distillery work?"],
    },
)


def _guide(
    slug: str,
    variants: list[str],
    targets: list[tuple[str, str, str]],
    entities: list[str],
    follow_ups: list[str],
) -> dict[str, Any]:
    return {
        "id": f"cross_feature.feature.{slug}",
        "intent_type": "definition",
        "variants": variants,
        "targets": targets,
        "entities": entities,
        "follow_ups": follow_ups,
    }


EXTRA_FEATURE_GUIDES = (
    _guide(
        "weapons",
        [
            "How do weapons work?",
            "Explain weapons",
            "How do I buy weapons?",
            "What weapons are there?",
            "Weapons guide",
            "How does the armoury weapons work?",
            "Tell me about weapons",
        ],
        [
            ("faq", "COMBAT", "Weapons"),
            ("how_to", "COMBAT & LOADOUT", "Weapons & armour"),
        ],
        ["weapons", "armoury"],
        ["How does armour work?", "How does attacking work?"],
    ),
    _guide(
        "armour",
        [
            "How does armour work?",
            "Explain armour",
            "How do I buy armour?",
            "What armour is there?",
            "Armour guide",
            "Tell me about armor",
            "How does armor work?",
        ],
        [
            ("faq", "COMBAT", "Armour"),
            ("how_to", "COMBAT & LOADOUT", "Weapons & armour"),
        ],
        ["armour", "armor"],
        ["How do weapons work?", "How do bodyguards work?"],
    ),
    _guide(
        "hitlist",
        [
            "How does the hitlist work?",
            "Explain hitlist",
            "How do bounties work?",
            "What is the hitlist?",
            "Hitlist guide",
            "How do I place a bounty?",
            "Tell me about hitlist",
        ],
        [
            ("faq", "COMBAT", "Hitlist (Bounties)"),
            ("how_to", "COMBAT & LOADOUT", "Hitlist"),
        ],
        ["hitlist", "bounties"],
        ["How does attacking work?", "What is Hitman for Hire?"],
    ),
    _guide(
        "bodyguards",
        [
            "How do bodyguards work?",
            "Explain bodyguards",
            "How do I hire bodyguards?",
            "What are bodyguards?",
            "Bodyguards guide",
            "Tell me about bodyguards",
            "How do robot bodyguards work?",
        ],
        [
            ("faq", "COMBAT", "Bodyguards"),
            ("how_to", "COMBAT & LOADOUT", "Bodyguards"),
        ],
        ["bodyguards", "guards"],
        ["What is Hitman for Hire?", "How does attacking work?"],
    ),
    _guide(
        "hitman",
        [
            "How does Hitman for Hire work?",
            "What is Hitman for Hire?",
            "Explain Hitman for Hire",
            "How do I hire a hitman?",
            "Hitman guide",
            "Tell me about hitman",
            "How does hitman work?",
        ],
        [
            ("faq", "COMBAT", "Hitman for Hire"),
            ("how_to", "COMBAT & LOADOUT", "Hitman for Hire"),
        ],
        ["hitman", "Hitman for Hire"],
        ["How do bodyguards work?", "Why can't I attack a new player?"],
    ),
    _guide(
        "molotovs",
        [
            "How do molotovs work?",
            "Explain molotovs",
            "What are molotovs?",
            "Molotov guide",
            "How do I use a molotov?",
            "Tell me about molotovs",
            "How does molotov damage work?",
        ],
        [
            ("faq", "COMBAT", "Molotovs"),
            ("how_to", "COMBAT & LOADOUT", "Molotovs"),
        ],
        ["molotovs", "molotov"],
        ["How does attacking work?", "How does health work?"],
    ),
    _guide(
        "health",
        [
            "How does health work?",
            "Explain health",
            "What is the health system?",
            "Health guide",
            "How do I heal?",
            "Tell me about health",
            "How does HP work?",
        ],
        [
            ("faq", "COMBAT", "Health System"),
            ("how_to", "FINDING YOUR WAY", "Health"),
        ],
        ["health", "HP"],
        ["How do molotovs work?", "How does attacking work?"],
    ),
    _guide(
        "witnesses",
        [
            "How do witness statements work?",
            "Explain witnesses",
            "What are witness statements?",
            "Witness guide",
            "How do witnesses work?",
            "Tell me about witnesses",
            "What is a witness statement?",
        ],
        [("faq", "COMBAT", "Witness Statements")],
        ["witnesses", "witness statements"],
        ["How does attacking work?", "How does jail work?"],
    ),
    _guide(
        "death-revive",
        [
            "How does Dead to Alive work?",
            "What is Dead to Alive?",
            "How do I revive?",
            "What happens when I die?",
            "Explain Dead > Alive",
            "Death and revive guide",
            "How does revive work?",
        ],
        [
            ("how_to", "COMBAT & LOADOUT", "After death: Dead > Alive & revive"),
            ("faq", "FAQ", "Q: What is Dead to Alive?"),
            ("faq", "FAQ", "Q: What happens when I die?"),
        ],
        ["Dead to Alive", "revive", "death"],
        ["How does attacking work?", "Can I get my points back if I die?"],
    ),
    _guide(
        "wealth-ranks",
        [
            "How do wealth ranks work?",
            "What are wealth ranks?",
            "Explain wealth ranks",
            "What is wealth rank?",
            "Wealth rank guide",
            "Tell me about wealth ranks",
            "How does cash on hand rank work?",
        ],
        [
            ("faq", "MONEY MAKING", "Wealth ranks (cash on hand)"),
            ("how_to", "FINDING YOUR WAY", "Wealth rank"),
        ],
        ["wealth ranks", "cash on hand"],
        ["Does bank money count for wealth rank?", "RP rank vs wealth rank"],
    ),
    _guide(
        "stocks",
        [
            "How does the stock market work?",
            "Explain stocks",
            "How do I trade crypto?",
            "What is the stock market?",
            "Stock market guide",
            "How does crypto trading work?",
            "Tell me about stocks",
        ],
        [
            ("faq", "MONEY MAKING", "Stock Market (Crypto Trading)"),
            ("how_to", "MONEY & BUSINESSES", "Other money pages"),
        ],
        ["stock market", "crypto"],
        ["How do banks work?", "How does the store work?"],
    ),
    _guide(
        "sports-betting",
        [
            "How does sports betting work?",
            "Explain sports betting",
            "How do I bet on sports?",
            "What is sports betting?",
            "Sports betting guide",
            "Tell me about sports betting",
            "How do book events work?",
        ],
        [
            ("faq", "MONEY MAKING", "Sports Betting"),
            ("how_to", "CASINO & MINI-GAMES", "Sports betting"),
        ],
        ["sports betting", "betting"],
        ["How do casinos work?", "How do mini-games work?"],
    ),
    _guide(
        "crack-safe",
        [
            "How does Crack Safe work?",
            "Explain Crack the Safe",
            "How do I crack a safe?",
            "What is Crack Safe?",
            "Crack Safe guide",
            "Tell me about crack safe",
            "How does crack the safe work?",
        ],
        [
            ("faq", "MONEY MAKING", "Crack Safe"),
            ("how_to", "MONEY & BUSINESSES", "Other money pages"),
        ],
        ["Crack Safe", "safe"],
        ["How do loot boxes work?", "How do crimes work?"],
    ),
    _guide(
        "quick-trade",
        [
            "How does Quick Trade work?",
            "Explain Quick Trade",
            "How do I trade points?",
            "What is Quick Trade?",
            "Quick Trade guide",
            "Tell me about quick trade",
            "How do I send points?",
        ],
        [("how_to", "MONEY & BUSINESSES", "Quick Trade")],
        ["Quick Trade", "points"],
        ["How does the store work?", "How do banks work?"],
    ),
    _guide(
        "lottery",
        [
            "How does the lottery work?",
            "Explain lottery",
            "How do I buy lottery tickets?",
            "What is the lottery?",
            "Lottery guide",
            "Tell me about the lottery",
            "How do lottery draws work?",
        ],
        [("how_to", "MONEY & BUSINESSES", "Lottery")],
        ["lottery"],
        ["How do loot boxes work?", "How do casinos work?"],
    ),
    _guide(
        "loot-boxes",
        [
            "How do loot boxes work?",
            "Explain loot boxes",
            "How do I open loot?",
            "What are loot boxes?",
            "Loot box guide",
            "Tell me about loot boxes",
            "How does the loot box work?",
        ],
        [
            ("faq", "LOOT BOXES", "LOOT BOXES"),
            ("how_to", "MONEY & BUSINESSES", "Loot Box"),
        ],
        ["loot boxes", "loot"],
        ["What is a Loot Weapon?", "How does Game Pass work?"],
    ),
    _guide(
        "armoury-factory",
        [
            "How does the armoury work?",
            "How does the bullet factory work?",
            "Explain the armoury",
            "What is the bullet factory?",
            "Armoury guide",
            "How do I buy bullets with cash?",
            "Tell me about the armoury",
        ],
        [
            ("faq", "MONEY MAKING", "Armoury & bullet factory (per city)"),
            ("how_to", "FINDING YOUR WAY", "Bullets"),
        ],
        ["armoury", "bullet factory", "bullets"],
        ["How do I melt cars for bullets?", "How do weapons work?"],
    ),
    _guide(
        "family-rackets",
        [
            "How do family rackets work?",
            "Explain family rackets",
            "What is a family racket?",
            "Family racket guide",
            "How do crew rackets work?",
            "Tell me about family rackets",
            "How does a family Distillery racket work?",
        ],
        [("faq", "FAMILIES", "Rackets")],
        ["family racket", "crew racket"],
        ["Personal racket vs family racket", "How do racket raids work?"],
    ),
    _guide(
        "family-hierarchy",
        [
            "How does family hierarchy work?",
            "Explain family ranks",
            "What ranks are in a family?",
            "Family hierarchy guide",
            "How do family roles work?",
            "Tell me about family hierarchy",
            "What is a family boss?",
        ],
        [("faq", "FAMILIES", "Family Hierarchy")],
        ["family hierarchy", "family ranks"],
        ["How do families work?", "How does the family treasury work?"],
    ),
    _guide(
        "family-treasury",
        [
            "How does the family treasury work?",
            "Explain the crew vault",
            "What is the family bank?",
            "Family treasury guide",
            "How do I donate to my family?",
            "Tell me about the crew vault",
            "How does the family vault work?",
        ],
        [("faq", "FAMILIES", "Treasury (crew vault)")],
        ["treasury", "crew vault"],
        ["How do families work?", "How does the compound work?"],
    ),
    _guide(
        "compound",
        [
            "How does the compound work?",
            "Explain the family compound",
            "What is the compound?",
            "Compound guide",
            "How do I use the compound?",
            "Tell me about the compound",
            "How does family compound storage work?",
        ],
        [("faq", "FAMILIES", "Compound")],
        ["compound"],
        ["How does the family treasury work?", "How does Dead to Alive work?"],
    ),
    _guide(
        "racket-raids",
        [
            "How do racket raids work?",
            "Explain racket raids",
            "How do I raid a racket?",
            "What are racket raids?",
            "Racket raid guide",
            "Tell me about racket raids",
            "How does raiding a family racket work?",
        ],
        [("faq", "FAMILIES", "Racket Raids")],
        ["racket raids", "raids"],
        ["How do family rackets work?", "How do family wars work?"],
    ),
    _guide(
        "family-wars",
        [
            "How do family wars work?",
            "What are family wars?",
            "Explain Vendetta",
            "How does Vendetta work?",
            "Family war guide",
            "Tell me about family wars",
            "How do I start a family war?",
        ],
        [("faq", "FAMILIES", "Family Wars (Vendetta)")],
        ["family wars", "Vendetta"],
        ["How do families work?", "How do racket raids work?"],
    ),
    _guide(
        "crew-oc",
        [
            "How does crew OC work?",
            "Explain crew organised crime",
            "What is crew OC?",
            "Crew OC guide",
            "How do family heists work?",
            "Tell me about crew OC",
            "How does family OC work?",
        ],
        [("faq", "FAMILIES", "Crew OC")],
        ["crew OC", "family OC"],
        ["How does Organised Crime work?", "How do families work?"],
    ),
    _guide(
        "car-rarities",
        [
            "How do car rarities work?",
            "Explain car rarities",
            "What car rarities are there?",
            "Car rarity guide",
            "How does travel speed by rarity work?",
            "Tell me about car rarities",
            "How fast do cars travel?",
        ],
        [
            ("faq", "GARAGE & VEHICLES", "Car Rarities"),
            ("faq", "GARAGE & VEHICLES", "Travel Speed by Rarity"),
            ("how_to", "CARS & GARAGE", "Travel"),
        ],
        ["car rarities", "travel speed"],
        ["How do cars work?", "How do I melt cars for bullets?"],
    ),
    _guide(
        "melt-cars",
        [
            "How do I melt cars for bullets?",
            "How does melting cars work?",
            "Explain melting cars",
            "How do I turn cars into bullets?",
            "Melt cars guide",
            "Tell me about melting cars",
            "How many bullets do cars give?",
        ],
        [
            ("faq", "GARAGE & VEHICLES", "Melting Cars for Bullets"),
            ("how_to", "FINDING YOUR WAY", "Bullets"),
        ],
        ["melting cars", "bullets"],
        ["How do cars work?", "How does the armoury work?"],
    ),
    _guide(
        "busting",
        [
            "How do I bust someone?",
            "How does busting work?",
            "Explain busting others",
            "How do I bust people out of jail?",
            "Busting guide",
            "Tell me about busts",
            "How do jail busts work?",
        ],
        [("faq", "JAIL SYSTEM", "Busting Others")],
        ["busting", "bust"],
        ["How does jail work?", "How does snitching work?"],
    ),
    _guide(
        "snitching",
        [
            "How does snitching work?",
            "Explain snitching",
            "What is snitching?",
            "Snitching guide",
            "How do I snitch?",
            "Tell me about snitching",
            "What happens if I snitch?",
        ],
        [("faq", "JAIL SYSTEM", "Snitching")],
        ["snitching"],
        ["How does jail work?", "How do I bust someone?"],
    ),
    _guide(
        "cities",
        [
            "How do cities work?",
            "Explain cities",
            "What cities are there?",
            "Cities guide",
            "How do I change city?",
            "Tell me about cities",
            "What is each city for?",
        ],
        [
            ("faq", "TRAVEL", "Cities"),
            ("faq", "TRAVEL", "States (city overview)"),
            ("how_to", "TRAVEL & STATES", "States"),
        ],
        ["cities", "states"],
        ["How does travel work?", "How does airport ownership work?"],
    ),
    _guide(
        "airport-ownership",
        [
            "How does airport ownership work?",
            "Explain airports",
            "How do I own an airport?",
            "What is airport ownership?",
            "Airport guide",
            "Tell me about airports",
            "How do airport slots work?",
        ],
        [("faq", "TRAVEL", "Airport Ownership")],
        ["airport", "airport ownership"],
        ["How does travel work?", "How do I own a casino table?"],
    ),
    _guide(
        "ranks",
        [
            "How do ranks work?",
            "Explain rank points",
            "What are the ranks?",
            "Rank guide",
            "How does RP rank work?",
            "Tell me about ranks",
            "How do I rank up?",
        ],
        [
            ("faq", "PROGRESSION", "Ranks (13 total)"),
            ("how_to", "PROGRESSION", "Rank, badges & leaderboards"),
        ],
        ["ranks", "rank points", "RP"],
        ["RP rank vs wealth rank", "How does Auto Rank work?"],
    ),
    _guide(
        "missions",
        [
            "How do missions work?",
            "Explain missions",
            "What are missions?",
            "Missions guide",
            "How do I do missions?",
            "Tell me about missions",
            "How do story missions work?",
        ],
        [
            ("faq", "PROGRESSION", "Missions"),
            ("how_to", "PROGRESSION", "Missions & objectives"),
        ],
        ["missions"],
        ["How do objectives work?", "How does Prestige work?"],
    ),
    _guide(
        "objectives",
        [
            "How do objectives work?",
            "Explain objectives",
            "What are objectives?",
            "Objectives guide",
            "How do I complete objectives?",
            "Tell me about objectives",
            "How do daily objectives work?",
        ],
        [
            ("faq", "PROGRESSION", "Objectives"),
            ("how_to", "PROGRESSION", "Missions & objectives"),
        ],
        ["objectives"],
        ["How do missions work?", "What are Daily Rewards?"],
    ),
    _guide(
        "leaderboard",
        [
            "How does the game leaderboard work?",
            "Explain the leaderboard",
            "What is the game leaderboard?",
            "Leaderboard guide",
            "How do leaderboards work?",
            "Tell me about the leaderboard",
            "How does ranking on the leaderboard work?",
        ],
        [
            ("faq", "PROGRESSION", "Game Leaderboard"),
            ("how_to", "PROGRESSION", "Rank, badges & leaderboards"),
        ],
        ["leaderboard"],
        ["How do ranks work?", "How does the mini-games leaderboard work?"],
    ),
    _guide(
        "inventory",
        [
            "How does inventory work?",
            "Explain inventory",
            "What is my inventory?",
            "Inventory guide",
            "How do I use inventory items?",
            "Tell me about inventory",
            "Where is my inventory?",
        ],
        [
            ("faq", "PROGRESSION", "Inventory"),
            ("how_to", "PROGRESSION", "Prestige & inventory"),
        ],
        ["inventory"],
        ["How does Prestige work?", "How do tokens work?"],
    ),
    _guide(
        "badges",
        [
            "How do badges work?",
            "Explain badges",
            "What are badges?",
            "Badges guide",
            "How do achievements work?",
            "Tell me about badges",
            "How do I get badges?",
        ],
        [
            ("faq", "PROGRESSION", "Badges & achievements"),
            ("how_to", "PROGRESSION", "Rank, badges & leaderboards"),
        ],
        ["badges", "achievements"],
        ["How do ranks work?", "How do missions work?"],
    ),
    _guide(
        "respect",
        [
            "How does respect work?",
            "Explain respect",
            "What is respect?",
            "Respect guide",
            "How do I earn respect?",
            "Tell me about respect",
            "What is the respect currency?",
        ],
        [("faq", "PROGRESSION", "Respect (secondary currency)")],
        ["respect"],
        ["How does the store work?", "How do mini-games work?"],
    ),
    _guide(
        "daily-rewards",
        [
            "What are Daily Rewards?",
            "How do Daily Rewards work?",
            "Explain Daily Rewards",
            "Daily Rewards guide",
            "How do I claim daily rewards?",
            "Tell me about daily rewards",
            "How does Rock Paper Scissors daily work?",
        ],
        [
            ("how_to", "PROGRESSION", "Daily rewards"),
            ("faq", "FAQ", "Q: What are Daily Rewards?"),
        ],
        ["Daily Rewards"],
        ["How do objectives work?", "How do mini-games work?"],
    ),
    _guide(
        "point-store",
        [
            "How does the store work?",
            "How does the point store work?",
            "Explain the store",
            "What can I buy in the store?",
            "Point store guide",
            "Tell me about the store",
            "How do I spend points?",
        ],
        [
            ("faq", "POINT STORE", "POINT STORE"),
            ("how_to", "STORE & GAME PASS", "Game → Store"),
        ],
        ["point store", "store"],
        ["How do tokens work?", "How does Game Pass work?"],
    ),
    _guide(
        "tokens",
        [
            "How do tokens work?",
            "Explain tokens",
            "What are tokens?",
            "Token guide",
            "How do 1-hour tokens work?",
            "Tell me about tokens",
            "How do I use tokens?",
        ],
        [("faq", "POINT STORE", "Tokens (1-hour stacks)")],
        ["tokens"],
        ["How does the store work?", "How does Auto Rank work?"],
    ),
    _guide(
        "gta",
        [
            "How does GTA work?",
            "Explain car theft",
            "How do I steal cars?",
            "What is GTA?",
            "GTA guide",
            "Tell me about GTA",
            "How does car theft work?",
        ],
        [
            ("faq", "CRIMES", "GTA (Car Theft)"),
            ("how_to", "CRIMES & ORGANISED CRIME", "GTA (car theft)"),
        ],
        ["GTA", "car theft"],
        ["How do cars work?", "How do crimes work?"],
    ),
    _guide(
        "forum",
        [
            "How does the forum work?",
            "Explain the forum",
            "How do I use the forum?",
            "What is the forum?",
            "Forum guide",
            "Tell me about the forum",
            "How do forum posts work?",
        ],
        [
            ("faq", "SOCIAL FEATURES", "Forum"),
            ("how_to", "SOCIAL & HELP", "SOCIAL & HELP"),
        ],
        ["forum"],
        ["How do direct messages work?", "How do I report a bug?"],
    ),
    _guide(
        "inbox",
        [
            "How does the inbox work?",
            "Explain inbox",
            "How do notifications work?",
            "What is the inbox?",
            "Inbox guide",
            "Tell me about inbox",
            "How do I read mail?",
        ],
        [
            ("faq", "SOCIAL FEATURES", "Inbox & notifications"),
            ("how_to", "SOCIAL & HELP", "SOCIAL & HELP"),
        ],
        ["inbox", "notifications"],
        ["How do direct messages work?", "How does game chat work?"],
    ),
    _guide(
        "direct-messages",
        [
            "How do direct messages work?",
            "Explain DMs",
            "How do I send a private message?",
            "What are direct messages?",
            "DM guide",
            "Tell me about direct messages",
            "How does private chat work?",
        ],
        [("faq", "SOCIAL FEATURES", "Direct Messages")],
        ["direct messages", "DMs"],
        ["How does the inbox work?", "How does game chat work?"],
    ),
    _guide(
        "game-chat",
        [
            "How does game chat work?",
            "Explain chat",
            "How do I use chat?",
            "What is game chat?",
            "Chat guide",
            "Tell me about game chat",
            "How does public chat work?",
        ],
        [("faq", "SOCIAL FEATURES", "Game Chat")],
        ["game chat", "chat"],
        ["How do direct messages work?", "What are the chat rules?"],
    ),
    _guide(
        "profile",
        [
            "How does profile customization work?",
            "Explain profiles",
            "How do I edit my profile?",
            "What can I change on my profile?",
            "Profile guide",
            "Tell me about profile customization",
            "How do avatars work?",
        ],
        [
            ("faq", "SOCIAL FEATURES", "Profile Customization"),
            ("how_to", "PROFILE & ACCOUNT", "Edit profile"),
        ],
        ["profile", "avatar"],
        ["How do referrals work?", "How do badges work?"],
    ),
    _guide(
        "referrals",
        [
            "How do referrals work?",
            "Explain referrals",
            "How do I invite players?",
            "What is the referral system?",
            "Referral guide",
            "Tell me about referrals",
            "How do I redeem a code?",
        ],
        [
            ("faq", "SOCIAL FEATURES", "Referrals"),
            ("how_to", "PROFILE & ACCOUNT", "Referral & redeem"),
        ],
        ["referrals", "redeem"],
        ["How do I edit my profile?", "How does the store work?"],
    ),
    _guide(
        "users-online",
        [
            "How does users online work?",
            "Explain the online list",
            "How do I see who is online?",
            "What is users online?",
            "Users online guide",
            "Tell me about users online",
            "How do I find online players?",
        ],
        [("faq", "SOCIAL FEATURES", "Users online")],
        ["users online"],
        ["How do families work?", "How does attacking work?"],
    ),
    _guide(
        "help-desk",
        [
            "How do I report a bug?",
            "How does Help Desk work?",
            "Explain Help Desk",
            "How do I contact staff?",
            "Help Desk guide",
            "How do I make a ticket?",
            "Where is Help Desk?",
        ],
        [
            ("faq", "FAQ", "Q: How do I report a bug?"),
            ("how_to", "SOCIAL & HELP", "SOCIAL & HELP"),
        ],
        ["Help Desk", "bug"],
        ["How does the forum work?", "What are the rules?"],
    ),
    _guide(
        "weed-grow",
        [
            "How do I grow weed?",
            "How does the Weed Empire grow loop work?",
            "Explain growing in Weed Empire",
            "How do I plant weed?",
            "Weed grow guide",
            "How do I harvest weed?",
            "Tell me about growing weed",
        ],
        [
            ("faq", "WEED EMPIRE", "Grow loop"),
            ("how_to", "WEED EMPIRE", "Grow"),
        ],
        ["grow", "plant", "harvest"],
        ["How does Weed Empire work?", "How does weed business cash work?"],
    ),
    _guide(
        "weed-cash",
        [
            "How does weed business cash work?",
            "Explain the weed vault",
            "How do I withdraw weed cash?",
            "What is weed business cash?",
            "Weed cash guide",
            "How does Safety Deposit work?",
            "Tell me about weed cash",
        ],
        [
            ("faq", "WEED EMPIRE", "Business cash"),
            ("how_to", "WEED EMPIRE", "Cash & vault"),
        ],
        ["weed business cash", "Safety Deposit"],
        ["How does Weed Empire work?", "How do Weed Empire raids work?"],
    ),
    _guide(
        "weed-heat",
        [
            "How does Weed Empire heat work?",
            "Explain weed heat",
            "What is a heat bust?",
            "Weed heat guide",
            "How do I cool weed heat?",
            "Tell me about weed busts",
            "How do weed heat busts work?",
        ],
        [
            ("faq", "WEED EMPIRE", "Heat & busts"),
            ("how_to", "WEED EMPIRE", "Crew, raids, heat"),
        ],
        ["weed heat", "heat bust"],
        ["How does Weed Empire work?", "How do Weed Empire raids work?"],
    ),
    _guide(
        "weed-raids",
        [
            "How do Weed Empire raids work?",
            "Explain weed raids",
            "How do I raid another grower?",
            "What are Weed Empire raids?",
            "Weed raid guide",
            "Tell me about weed raids",
            "How does raiding farms work?",
        ],
        [
            ("faq", "WEED EMPIRE", "Raids"),
            ("how_to", "WEED EMPIRE", "Crew, raids, heat"),
        ],
        ["weed raids", "grower"],
        ["How does Weed Empire heat work?", "How does Weed Empire crew work?"],
    ),
    _guide(
        "weed-crew",
        [
            "How does Weed Empire crew work?",
            "Explain weed workers",
            "How do I hire weed crew?",
            "What do farm workers do?",
            "Weed crew guide",
            "Tell me about weed crew",
            "How do Weed Empire assistants work?",
        ],
        [
            ("faq", "WEED EMPIRE", "Crew"),
            ("how_to", "WEED EMPIRE", "Crew, raids, heat"),
        ],
        ["weed crew", "farm workers"],
        ["How do I grow weed?", "How do Weed Empire raids work?"],
    ),
    _guide(
        "special-strains",
        [
            "What are special strains?",
            "How do Weed Empire special strains work?",
            "Explain special strains",
            "How do loot exclusive strains work?",
            "Special strains guide",
            "Tell me about special strains",
            "How do Game Pass strains work?",
        ],
        [("faq", "WEED EMPIRE", "Special strains")],
        ["special strains", "loot exclusive"],
        ["How does Weed Empire work?", "How do loot boxes work?"],
    ),
    _guide(
        "famiglia",
        [
            "How does Famiglia work?",
            "Explain Famiglia",
            "What is Famiglia?",
            "Famiglia guide",
            "How do I play Famiglia?",
            "Tell me about Famiglia",
            "How does the Mafia RPG work?",
        ],
        [("faq", "MINI-GAMES", "Famiglia (Mafia RPG)")],
        ["Famiglia"],
        ["How do mini-games work?", "How does respect work?"],
    ),
    _guide(
        "mini-games-leaderboard",
        [
            "How does the mini-games leaderboard work?",
            "Explain mini-game points",
            "What is the mini-games leaderboard?",
            "Mini-games leaderboard guide",
            "How do weekly mini-game prizes work?",
            "Tell me about the mini-games leaderboard",
            "How do mini-game weeks work?",
        ],
        [("faq", "MINI-GAMES", "Mini-Games Leaderboard")],
        ["mini-games leaderboard"],
        ["How do mini-games work?", "How does the game leaderboard work?"],
    ),
    _guide(
        "new-accounts",
        [
            "How does new-account protection work?",
            "Explain new accounts",
            "What is new-account protection?",
            "New account guide",
            "How do new accounts work?",
            "Tell me about new-account protection",
            "Why are new players protected?",
        ],
        [
            ("faq", "COMBAT", "New-account protection"),
            ("how_to", "FINDING YOUR WAY", "New accounts"),
        ],
        ["new-account protection", "new accounts"],
        ["Why can't I attack a new player?", "How does attacking work?"],
    ),
)


def slug(value: str) -> str:
    normalized = value.lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", normalized).strip("-") or "topic"


def topic_text(title: str) -> str:
    topic = re.sub(r"^\s*Q:\s*", "", title, flags=re.I).strip().rstrip(":")
    return topic.replace("�", "'")


_QUESTION_START_RE = re.compile(
    r"^(?:how|what|why|where|when|who|which|can|could|do|does|did|is|are|should)\b",
    re.I,
)
_STRIP_QUESTION_PREFIX_RE = re.compile(
    r"^(?:"
    r"how (?:do i|does|do|can i|can|is|are) |"
    r"what (?:is|are|happens(?: if)?|do i get(?: when)?|should i know about) |"
    r"why (?:can(?:not|'t)|cant i|are|is|does) |"
    r"where (?:do i|can i|is|are) |"
    r"can i |does |do i "
    r")",
    re.I,
)


def is_question_like(text: str) -> bool:
    cleaned = topic_text(text).strip()
    return cleaned.endswith("?") or bool(_QUESTION_START_RE.match(cleaned))


def _clean_noun(part: str) -> str:
    candidate = re.sub(r"[?!.]+$", "", part).strip()
    candidate = _STRIP_QUESTION_PREFIX_RE.sub("", candidate).strip()
    candidate = re.sub(r"\b(?:work|working)$", "", candidate, flags=re.I).strip()
    candidate = re.sub(r"^(?:the|a|an)\s+", "", candidate, flags=re.I).strip()
    candidate = re.sub(r"\s+", " ", candidate)
    if not candidate or is_question_like(candidate) or len(candidate) > 40:
        return ""
    return candidate[0].upper() + candidate[1:]


def topic_label(title: str, category: str) -> str:
    """Short noun-like label. Never return a full question for wrapping into chips."""
    text = topic_text(title)
    if not is_question_like(text):
        return text
    for part in reversed([chunk.strip() for chunk in text.split("/")]):
        noun = _clean_noun(part)
        if noun:
            return noun
    with_match = re.search(r"\bwith (.+)$", re.sub(r"[?!.]+$", "", text), re.I)
    if with_match:
        noun = _clean_noun(with_match.group(1))
        if noun:
            return noun
    fallback = re.sub(r"\s*&\s*", " and ", category).strip()
    return fallback or text


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
    label: str,
) -> list[str]:
    variants = []
    if is_question_like(topic):
        variants.append(topic if topic.endswith("?") else f"{topic}?")
        wrap = label
    else:
        wrap = topic
        if original_title.lstrip().lower().startswith("q:"):
            variants.append(topic)
    if disambiguate:
        variants.append(f"What is {wrap} in {category}?")
    variants.extend(
        [
            f"What is {wrap}?",
            f"What are {wrap}?",
            f"Tell me about {wrap}",
            f"Explain {wrap}",
            f"How does {wrap} work?",
            f"I need information about {wrap}",
            f"Give me the guide for {wrap}",
            f"What should I know about {wrap}?",
        ]
    )
    return unique(variants)[:7]


def secondary_variants(label: str, source: str) -> tuple[str, list[str]]:
    wrap = label.split(" or ")[0].strip() if " or " in label.lower() else label
    if source == "how_to":
        return (
            "procedure",
            unique(
                [
                    f"How do I use {wrap}?",
                    f"How do I start {wrap}?",
                    f"Where do I find {wrap}?",
                    f"What do I do for {wrap}?",
                    f"Show me how to do {wrap}",
                    f"Help me with {wrap}",
                    f"Which menu has {wrap}?",
                ]
            ),
        )
    return (
        "rules",
        unique(
            [
                f"What are the rules for {wrap}?",
                f"What happens with {wrap}?",
                f"Does the FAQ explain {wrap}?",
                f"Can you clarify {wrap}?",
                f"Which FAQ covers {wrap}?",
                f"I have a question about {wrap}",
                f"How is {wrap} supposed to work?",
            ]
        ),
    )


def follow_up_chips(topic: str, label: str, category: str, *, overview: bool) -> list[str]:
    chip_label = label.split(" or ")[0].strip() if " or " in label.lower() else label
    if is_question_like(topic):
        if overview:
            return unique(
                [
                    f"Tell me about {chip_label}",
                    f"Where do I find {chip_label}?",
                    f"Show me the {category} guide",
                ]
            )
        return unique(
            [
                f"How does {chip_label} work?",
                f"Show me the {category} guide",
            ]
        )
    if overview:
        return unique(
            [
                f"How do I use {chip_label}?",
                f"What are the rules for {chip_label}?",
                f"Where do I find {chip_label}?",
            ]
        )
    return unique(
        [
            f"Tell me about {chip_label}",
            f"What happens with {chip_label}?",
            f"Show me the {category} guide",
        ]
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
        label = topic_label(section["title"], section["category"])
        domain = choose_domain(section)
        base = f"{domain}.{slug(section['category'])}.{slug(topic)}"
        id_counts[base] += 1
        if id_counts[base] > 1:
            base = f"{base}-{section['source']}"
        reference = section_ref(section)
        route_aliases = list(ROUTE_ALIASES.get(section["category"], ()))

        overview_id = f"{base}.overview"
        secondary_type, secondary_questions = secondary_variants(label, section["source"])
        secondary_id = f"{base}.{secondary_type}"
        common = {
            "domain": domain,
            "entities": unique([label, topic, section["category"]]),
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
                    label,
                ),
                "related_intents": [secondary_id],
                "follow_ups": follow_up_chips(topic, label, section["category"], overview=True),
            }
        )
        shards[domain].append(
            {
                "id": secondary_id,
                **common,
                "intent_type": secondary_type,
                "variants": secondary_questions,
                "related_intents": [overview_id],
                "follow_ups": follow_up_chips(topic, label, section["category"], overview=False),
            }
        )

    for spec in (*CURATED_INTENTS, *FEATURE_GUIDES, *EXTRA_FEATURE_GUIDES):
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
        by_id = {row["id"]: row for row in domain_rows}
        for row in domain_rows:
            category = row["sections"][0]["category"]
            sibling_ids = [value for value in by_category[category] if value != row["id"]]
            definition_siblings = [
                value
                for value in sibling_ids
                if by_id.get(value, {}).get("intent_type") == "definition"
            ]
            row["related_intents"] = unique(row["related_intents"] + definition_siblings[:3])
            sibling_chips = []
            for sibling_id in sibling_ids:
                sibling = by_id.get(sibling_id)
                if not sibling or sibling.get("intent_type") != "definition":
                    continue
                first = (sibling.get("variants") or [""])[0]
                if first:
                    sibling_chips.append(first)
            row["follow_ups"] = unique(row["follow_ups"] + sibling_chips)[:5]
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
