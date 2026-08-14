"""In-game FAQ / How To guide chatbot (no LLM). Replies quote published guide sections only."""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from utils.config import WEALTH_RANKS
from utils.game_help_catalog import (
    catalog_by_id,
    match_catalog,
    related_questions,
    resolve_sections,
)

MAX_MESSAGE_LEN = 400
MAX_CONTEXT_FIELD_LEN = 120
MIN_MATCH_SCORE = 18

REFUSAL_TEXT = (
    "I only answer in-game questions from FAQs and How To. "
    "I cannot look up players, old accounts, emails, IPs, staff tools, or how the server works. "
    "Use Help Desk for account issues."
)

_CHAT_GREET = (
    "Hey. I'm the Game Guide — ask me anything from FAQs and How To. "
    "Rackets, jail, wealth ranks, families, cars… what do you want to know?"
)
_CHAT_THANKS = "You're welcome. Fire another question whenever you want."
_CHAT_BYE = "See you around. I'll be here if you need the guides."
_CHAT_HOW_ARE = "All good — ready when you are. What do you want to look up?"
_CHAT_WHO = (
    "I'm the in-game Game Guide. I explain how the game works from the published FAQs and How To. "
    "I can't look up players or accounts. Ask a topic, or tap a chip below."
)
_CHAT_OK = "Got it. Ask whenever you're ready."
_CHAT_UNKNOWN = (
    "That one isn't in my book, boss. I only know the published FAQs and How To. "
    "Try one of these topics:"
)
_CHAT_FILLER = frozenset(
    "there please just wanted wanna like really so well um uh mate bro man "
    "friend buddy lol haha hahaha yo good".split()
)
_CHAT_GREET_WORDS = frozenset(
    "hello hi hey hiya howdy sup yo morning afternoon evening night gday g'day".split()
)
_CHAT_THANKS_WORDS = frozenset("thanks thank thx ty cheers appreciated".split())
_CHAT_BYE_WORDS = frozenset("bye goodbye cya later see ya".split())
_CHAT_OK_WORDS = frozenset("ok okay cool nice awesome sweet perfect great".split())
_CHAT_WORD_RE = re.compile(r"[a-z0-9']+")

SKIP_TITLES = frozenset({"contents", "questions?"})

STOPWORDS = frozenset(
    """
    a an the how do does did what is are was were to of in for my your you i me we us it
    on at be can with from and or this that work works working please tell about why when
    where who whom which using use get got make made need needs wanted want
    """.split()
)

SYNONYM_GROUPS = (
    frozenset({"illegal", "business"}),
    frozenset({"wealth", "billionaire", "millionaire", "cash"}),
    frozenset({"jail", "bust", "busts", "prison"}),
    frozenset({"family", "families", "crew", "crews"}),
    frozenset({"garage", "cars", "car", "vehicles", "vehicle"}),
    frozenset({"attack", "attacking", "combat", "kill", "kills"}),
    frozenset({"bank", "banks", "swiss", "interest", "deposit", "withdraw"}),
    frozenset({"crime", "crimes", "organised", "organized", "oc"}),
    frozenset({"travel", "state", "states", "city", "cities", "airport"}),
    frozenset({"rank", "ranks", "ranking", "progression", "rp"}),
    frozenset({"armour", "armor", "weapon", "weapons", "armoury", "armory"}),
)
SYNONYM_ALIASES = {
    "racket": {"rackets", "illegal", "business"},
    "rackets": {"racket", "illegal", "business"},
    "oc": {"organised", "organized", "crime"},
    "rp": {"rank", "points"},
}

_EMOJI_RE = re.compile(r":[a-z0-9_+-]+:", re.I)
_BBCODE_RE = re.compile(r"\[/?[^\]]+\]")
_TOKEN_RE = re.compile(r"[a-z0-9]+")
_CATEGORY_RE = re.compile(
    r"(?:\[center\])?\s*\[size=(?:1\.5|1\.8)\]\[b\]\[color=[^\]]+\](.*?)\[/color\]\[/b\]\[/size\](?:\[/center\])?",
    re.I | re.S,
)
_SUBSECTION_LINE_RE = re.compile(
    r"^(?:\[quote\]\s*)?(?:\[size=1\.4\])?\[color=#[A-Fa-f0-9]{3,8}\]\[b\](.+?)\[/b\]\[/color\](?:\[/size\])?\s*$",
    re.M | re.I,
)
_REFUSE_RE = re.compile(
    r"""
    \b(
        old\s+accounts? |
        previous\s+accounts? |
        previous\s+usernames? |
        past\s+usernames? |
        past\s+accounts? |
        what\s+accounts?\s+did |
        accounts?\s+did\s+\w+\s+have |
        accounts?\s+(?:are|were)\s+linked |
        linked\s+accounts? |
        account\s+history |
        user(?:'s)?\s+history |
        player(?:'s)?\s+history |
        \balts?\b |
        multi[-\s]?accounts? |
        their\s+email |
        (?:his|her|player(?:'s)?|user(?:'s)?)\s+email |
        what\s+email |
        look\s*up\s+(?:user|player|account) |
        search\s+(?:the\s+)?(?:user|player|account)\s+database |
        who\s+is\s+this\s+player |
        ip\s*(?:address|ban|bans|banned) |
        (?:their|his|her|player(?:'s)?|user(?:'s)?)\s+(?:device|location|login) |
        password\s+hash |
        (?:their|his|her)\s+password |
        \bmongo(?:db)?\b |
        connection\s+string |
        \bjwt\b |
        \.env\b |
        env\s+file |
        (?:open|show|access|dump|explain|reveal)\s+(?:the\s+)?admin\s+(?:panel|tools?) |
        (?:open|show|access|dump|explain|reveal)\s+(?:the\s+)?staff\s+panel |
        source\s+code |
        how\s+the\s+server |
        backend\s+(?:code|server|api|database|details?|info|information|works?) |
        how\s+(?:does|is)\s+(?:the\s+)?backend |
        modkill |
        wipe\s+(?:this\s+)?(?:account|user|player)
    )\b
    """,
    re.I | re.X,
)
_FOLLOW_UP_RE = re.compile(
    r"^\s*(?:tell\s+me\s+more|more|go\s+on|continue|what\s+about\s+(?:that|it)|"
    r"explain\s+(?:that|it)|why|where\s+do\s+i\s+find\s+(?:that|it)|"
    r"how\s+do\s+i\s+do\s+(?:that|it)|how\s+does\s+(?:that|it)\s+work|"
    r"(?:the\s+)?other\s+one|(?:first|second|third)(?:\s+one)?)"
    r"[\s?.!]*$",
    re.I,
)
_CONTEXT_TOPIC_RE = re.compile(r"^\s*(?:what|how)\s+about\s+(.+?)[?.!]*$", re.I)
_ORDINAL_RE = re.compile(r"^\s*(?:the\s+)?(first|second|third|1st|2nd|3rd)(?:\s+one)?\s*[?.!]*$", re.I)
_OTHER_RE = re.compile(r"^\s*(?:what\s+about\s+)?(?:the\s+)?other\s+one\s*[?.!]*$", re.I)
_INJECTION_RE = re.compile(
    r"\b(?:ignore\s+(?:all\s+)?(?:previous|prior|system)|reveal\s+(?:your\s+)?prompt|"
    r"system\s+prompt|developer\s+message|jailbreak|act\s+as\s+(?:an?\s+)?(?:admin|database)|"
    r"bypass\s+(?:the\s+)?(?:rules|filters?|security))\b",
    re.I,
)
_OFF_TOPIC_RE = re.compile(
    r"\b(?:weather|recipe|homework|write\s+(?:me\s+)?code|politics|football\s+score|"
    r"medical\s+advice|stock\s+price|latest\s+news)\b",
    re.I,
)
_BROAD_INTENTS = {
    "rank": ("Ranks (13 total)", "Wealth ranks (cash on hand)", "AUTO RANK"),
    "ranks": ("Ranks (13 total)", "Wealth ranks (cash on hand)", "AUTO RANK"),
    "bank": ("Banks", "Cash vs bank", "Wealth ranks (cash on hand)"),
    "banks": ("Banks", "Cash vs bank", "Wealth ranks (cash on hand)"),
    "heat": ("Properties", "Distillery", "Racket Raids"),
}
_MONEY_RE = re.compile(
    r"""
    \$?\s*
    ([\d]{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)
    \s*
    (billion|million|trillion|[bmt])?
    \b
    """,
    re.I | re.X,
)

ENTITY_ALIASES = {
    "bank_type": {
        "interest_bank": ("interest bank", "interest"),
        "swiss_bank": ("swiss bank", "swiss"),
    },
    "rank_type": {
        "wealth_rank": ("wealth rank", "wealth tier", "money rank"),
        "rp_rank": ("rp rank", "rank points", "normal rank"),
        "auto_rank": ("auto rank", "autorank"),
    },
    "racket_type": {
        "personal_racket": ("personal racket", "illegal business"),
        "family_racket": ("family racket", "crew racket"),
    },
    "heat_type": {
        "property_heat": ("property heat", "collection heat"),
        "distillery_heat": ("distillery heat", "booze heat"),
    },
    "money_scope": {
        "cash_on_hand": ("cash on hand", "wallet cash", "unprotected cash"),
        "bank_money": ("bank money", "protected cash", "banked cash"),
    },
}


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _load_guide_file(*rel) -> str:
    path = _project_root().joinpath(*rel)
    if not path.is_file():
        return ""
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def strip_bbcode(text: str) -> str:
    return _BBCODE_RE.sub(" ", text or "")


def clean_heading(raw: str) -> str:
    s = _EMOJI_RE.sub(" ", raw or "")
    s = strip_bbcode(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def tokenize(text: str) -> set[str]:
    words = _TOKEN_RE.findall((text or "").lower())
    out = {w for w in words if w not in STOPWORDS and (len(w) > 1 or w.isdigit())}
    return out


def expand_synonyms(tokens: set[str]) -> set[str]:
    extra: set[str] = set()
    for group in SYNONYM_GROUPS:
        if tokens & group:
            extra |= set(group)
    for token in tokens:
        extra |= SYNONYM_ALIASES.get(token, set())
    return tokens | extra


def sanitize_context(context: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Keep topic metadata only. Player text/history is never accepted as context."""
    if not isinstance(context, dict):
        return None
    source = str(context.get("source") or "").strip().lower()
    kind = str(context.get("kind") or "").strip().lower()
    category = clean_heading(str(context.get("category") or ""))[:MAX_CONTEXT_FIELD_LEN]
    title = clean_heading(str(context.get("title") or ""))[:MAX_CONTEXT_FIELD_LEN]
    if source not in {"faq", "how_to"} or kind not in {"category", "subsection"}:
        return None
    if not category or not title:
        return None
    safe: dict[str, Any] = {
        "source": source,
        "kind": kind,
        "category": category,
        "title": title,
    }
    for field in ("intent_id", "domain", "answer_type"):
        value = clean_heading(str(context.get(field) or ""))[:MAX_CONTEXT_FIELD_LEN]
        if value:
            safe[field] = value
    choice_ids = context.get("choice_intent_ids")
    if isinstance(choice_ids, list):
        safe["choice_intent_ids"] = [
            clean_heading(str(value))[:MAX_CONTEXT_FIELD_LEN]
            for value in choice_ids[:5]
            if clean_heading(str(value))
        ]
    return safe


def detect_question_shape(message: str) -> dict[str, Any]:
    """Classify form only; this does not infer any game fact."""
    text = (message or "").strip().lower()
    if re.search(r"\b(?:vs\.?|versus|difference|compare|other one)\b", text):
        shape = "comparison"
    elif re.search(r"\b(?:why (?:can(?:not|'t)|won't)|not working|unable to|blocked|stuck)\b", text):
        shape = "troubleshooting"
    elif re.match(r"^(?:can|could|do|does|did|is|are|will|would|should)\b", text):
        shape = "yes_no"
    elif re.search(r"\b(?:how do(?: i)?|how can(?: i)?|where do(?: i)?|steps?|show me how)\b", text):
        shape = "procedure"
    elif re.search(r"\b(?:rules?|allowed|punishment|happens if)\b", text):
        shape = "rules"
    else:
        shape = "definition"
    return {
        "shape": shape,
        "negated": bool(re.search(r"\b(?:not|never|no|cannot|can't|won't|doesn't|isn't|aren't)\b", text)),
        "entities": resolve_entities(text),
    }


def resolve_entities(message: str) -> list[dict[str, str]]:
    """Resolve public game concepts using longest aliases first."""
    text = clean_heading(message).lower()
    found: list[dict[str, str]] = []
    occupied: list[tuple[int, int]] = []
    candidates: list[tuple[int, str, str, str]] = []
    for entity_type, values in ENTITY_ALIASES.items():
        for value, aliases in values.items():
            for alias in aliases:
                candidates.append((len(alias), entity_type, value, alias))
    for _, entity_type, value, alias in sorted(candidates, reverse=True):
        match = re.search(rf"\b{re.escape(alias)}\b", text)
        if not match or any(match.start() < end and match.end() > start for start, end in occupied):
            continue
        occupied.append((match.start(), match.end()))
        found.append({"type": entity_type, "value": value, "alias": alias})
    return found


def typo_corrections(message: str) -> list[dict[str, str]]:
    corrections: list[dict[str, str]] = []
    vocab = heading_vocabulary()
    for token in tokenize(message):
        if len(token) < 4 or token in vocab:
            continue
        candidates = [
            candidate
            for candidate in vocab
            if candidate[0] == token[0] and abs(len(candidate) - len(token)) <= 2
        ]
        if not candidates:
            continue
        best = max(candidates, key=lambda candidate: SequenceMatcher(None, token, candidate).ratio())
        ratio = SequenceMatcher(None, token, best).ratio()
        if ratio >= 0.78:
            corrections.append({"from": token, "to": best})
    return corrections


def is_refused_query(message: str) -> bool:
    return bool(_REFUSE_RE.search(message or ""))


def _chat_words(message: str) -> list[str]:
    return _CHAT_WORD_RE.findall((message or "").lower())


def small_talk_reply(message: str) -> Optional[str]:
    """Friendly chatbot lines for greetings / thanks / bye. None if this is a real game question."""
    words = _chat_words(message)
    if not words:
        return None
    joined = " ".join(words)
    content = [
        w
        for w in words
        if w not in STOPWORDS
        and w not in _CHAT_FILLER
        and w not in _CHAT_GREET_WORDS
        and w not in _CHAT_THANKS_WORDS
        and w not in _CHAT_BYE_WORDS
        and w not in _CHAT_OK_WORDS
        and w not in {"you", "your", "me", "i", "im", "i'm", "are", "is", "it", "going", "doing"}
    ]
    if re.fullmatch(r"(who|what) (are|is) you( anyway)?", joined) or joined in (
        "what can you do",
        "what do you do",
        "help",
        "help me",
        "can you help",
        "can you help me",
    ):
        return _CHAT_WHO
    if re.fullmatch(r"how (are|r) (you|u)( doing| going)?", joined) or joined in (
        "how's it going",
        "hows it going",
        "how you doing",
        "you good",
        "you ok",
        "whats up",
        "what's up",
    ):
        return _CHAT_HOW_ARE
    if content:
        return None
    if any(w in _CHAT_BYE_WORDS for w in words) or joined in ("see you", "see ya"):
        return _CHAT_BYE
    if any(w in _CHAT_THANKS_WORDS for w in words):
        return _CHAT_THANKS
    if any(w in _CHAT_GREET_WORDS for w in words) or joined.startswith("good "):
        return _CHAT_GREET
    if any(w in _CHAT_OK_WORDS for w in words):
        return _CHAT_OK
    return None


def _system_sections(
    title: str,
    body: str,
    *,
    refused: bool = False,
    chat: bool = False,
    intent: str = "small_talk",
    suggestions: Optional[list[str]] = None,
    answer_type: Optional[str] = None,
    context: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    return {
        "refused": refused,
        "wealth": None,
        "fallback_contents": False,
        "chat": chat,
        "intent": intent,
        "preamble": None,
        "context": context,
        "suggestions": suggestions or [],
        "related_questions": suggestions or [],
        "choices": [],
        "confidence": "high" if intent in {"small_talk", "refusal"} else "low",
        "match_method": "fixed_system_copy",
        "intent_id": None,
        "answer_type": answer_type or intent,
        "typo_corrections": [],
        "entities": [],
        "provenance": [{"source": "system", "title": title, "method": "fixed_system_copy"}],
        "reply_sections": [{"source": "system", "title": title, "body": body}],
    }


def parse_money_amount(message: str) -> Optional[int]:
    best = None
    for m in _MONEY_RE.finditer(message or ""):
        raw, unit = m.group(1), (m.group(2) or "").lower()
        try:
            n = float(raw.replace(",", ""))
        except ValueError:
            continue
        mul = 1
        if unit in ("b", "billion"):
            mul = 1_000_000_000
        elif unit in ("m", "million"):
            mul = 1_000_000
        elif unit in ("t", "trillion"):
            mul = 1_000_000_000_000
        val = int(n * mul)
        if best is None or val > best:
            best = val
    return best


def wealth_for_amount(amount: int) -> dict[str, Any]:
    m = int(amount)
    chosen = WEALTH_RANKS[0]
    for row in WEALTH_RANKS:
        if m >= int(row["min_money"]):
            chosen = row
    return {
        "id": chosen["id"],
        "name": chosen["name"],
        "min_money": chosen["min_money"],
        "color": chosen.get("color", "#64748b"),
        "amount": m,
        "note": "Wealth rank is based on cash on hand only. Swiss Bank and Interest Bank do not count.",
    }


def _split_subsections(category_title: str, body: str, source: str) -> list[dict[str, Any]]:
    matches = list(_SUBSECTION_LINE_RE.finditer(body))
    sections: list[dict[str, Any]] = []
    for i, match in enumerate(matches):
        title = clean_heading(match.group(1))
        if not title or title.lower() in SKIP_TITLES:
            continue
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        chunk = body[start:end].strip()
        if not chunk:
            continue
        sections.append(_make_section(source, "subsection", category_title, title, chunk))
    return sections


def _make_section(source: str, kind: str, category: str, title: str, body: str) -> dict[str, Any]:
    heading_tokens = tokenize(title) | tokenize(category)
    body_tokens = tokenize(strip_bbcode(body))
    return {
        "source": source,
        "kind": kind,
        "category": category,
        "title": title,
        "body": body,
        "heading_tokens": heading_tokens,
        "body_tokens": body_tokens,
        "title_norm": clean_heading(title).lower(),
        "category_norm": clean_heading(category).lower(),
    }


def _parse_document(raw: str, source: str) -> list[dict[str, Any]]:
    if not raw:
        return []
    found = list(_CATEGORY_RE.finditer(raw))
    sections: list[dict[str, Any]] = []
    for i, match in enumerate(found):
        category = clean_heading(match.group(1))
        if not category or category.lower() in SKIP_TITLES:
            continue
        start = match.start()
        end = found[i + 1].start() if i + 1 < len(found) else len(raw)
        chunk = raw[start:end].strip()
        sections.append(_make_section(source, "category", category, category, chunk))
        sections.extend(_split_subsections(category, chunk, source))
    return sections


@lru_cache(maxsize=1)
def load_sections() -> tuple[dict[str, Any], ...]:
    faq = _load_guide_file("docs", "FORUM_FAQ.md")
    how_to = _load_guide_file("docs", "FORUM_HOW_TO.md")
    return tuple(_parse_document(faq, "faq") + _parse_document(how_to, "how_to"))


@lru_cache(maxsize=1)
def heading_vocabulary() -> frozenset[str]:
    return frozenset(
        token
        for section in load_sections()
        for token in section["heading_tokens"]
        if len(token) >= 4
    )


def fuzzy_expand(tokens: set[str]) -> set[str]:
    """Correct likely heading typos without broadening short/ambiguous words."""
    vocab = heading_vocabulary()
    corrected = set(tokens)
    for token in tokens:
        if len(token) < 4 or token in vocab:
            continue
        best = None
        best_ratio = 0.0
        for candidate in vocab:
            if abs(len(candidate) - len(token)) > 2 or candidate[0] != token[0]:
                continue
            ratio = SequenceMatcher(None, token, candidate).ratio()
            if ratio > best_ratio:
                best, best_ratio = candidate, ratio
        if best and best_ratio >= 0.78:
            corrected.add(best)
    return corrected


def category_chips() -> list[str]:
    seen: list[str] = []
    for sec in load_sections():
        if sec["kind"] != "category" or sec["source"] != "faq":
            continue
        title = sec["title"]
        if title not in seen:
            seen.append(title)
    return seen


def contents_list() -> str:
    lines = [
        "I could not match that closely. Ask using one of these topics from FAQs / How To:",
        "",
        "[b]FAQs[/b]",
    ]
    last_cat = None
    last_source = None
    for sec in load_sections():
        if sec["kind"] == "category":
            if sec["source"] != last_source:
                last_source = sec["source"]
                if sec["source"] == "how_to":
                    lines.append("")
                    lines.append("[b]How To[/b]")
            last_cat = sec["title"]
            lines.append(f"[*][b]{sec['title']}[/b]")
        elif sec["kind"] == "subsection" and sec["category"] == last_cat:
            lines.append(f"    — {sec['title']}")
    return "\n".join(lines)


def _find_context_section(context: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    safe = sanitize_context(context)
    if not safe:
        return None
    for section in load_sections():
        if (
            section["source"] == safe["source"]
            and section["kind"] == safe["kind"]
            and section["category"].lower() == safe["category"].lower()
            and section["title"].lower() == safe["title"].lower()
        ):
            return section
    return None


def _follow_up_sections(context: Optional[dict[str, Any]], limit: int = 2) -> list[dict[str, Any]]:
    current = _find_context_section(context)
    if not current:
        return []
    siblings = [
        section
        for section in load_sections()
        if section["source"] == current["source"]
        and section["category"] == current["category"]
        and section["kind"] == "subsection"
    ]
    if current["kind"] == "category":
        return siblings[:limit]
    for index, section in enumerate(siblings):
        if section["title"] == current["title"]:
            following = siblings[index + 1 : index + 1 + limit]
            return following or [current]
    return [current]


def _section_context(
    section: dict[str, Any],
    *,
    intent_id: Optional[str] = None,
    domain: Optional[str] = None,
    answer_type: Optional[str] = None,
    choice_intent_ids: Optional[list[str]] = None,
) -> dict[str, Any]:
    context: dict[str, Any] = {
        "source": section["source"],
        "kind": section["kind"],
        "category": section["category"],
        "title": section["title"],
    }
    if intent_id:
        context["intent_id"] = intent_id
    if domain:
        context["domain"] = domain
    if answer_type:
        context["answer_type"] = answer_type
    if choice_intent_ids:
        context["choice_intent_ids"] = choice_intent_ids[:5]
    return context


def _section_suggestions(matches: list[dict[str, Any]], limit: int = 4) -> list[str]:
    suggestions: list[str] = []
    for match in matches:
        for section in load_sections():
            if (
                section["source"] == match["source"]
                and section["category"] == match["category"]
                and section["kind"] == "subsection"
                and section["title"] != match["title"]
                and section["title"] not in suggestions
            ):
                suggestions.append(section["title"])
                if len(suggestions) >= limit:
                    return suggestions
    return suggestions


def _broad_choices(message: str) -> list[dict[str, str]]:
    normalized = clean_heading(message).lower()
    if normalized not in _BROAD_INTENTS:
        return []
    wanted = {title.lower() for title in _BROAD_INTENTS[normalized]}
    choices: list[dict[str, str]] = []
    for section in load_sections():
        if section["title"].lower() in wanted:
            choices.append(
                {
                    "label": section["title"],
                    "message": section["title"],
                    "source": section["source"],
                    "category": section["category"],
                }
            )
    return choices


def _score_section(
    query_norm: str,
    query_tokens: set[str],
    sec: dict[str, Any],
    *,
    prefer_how_to: bool = False,
    prefer_faq: bool = False,
) -> int:
    score = 0
    title_norm = sec["title_norm"]
    cat_norm = sec["category_norm"]
    if query_norm and query_norm == title_norm:
        score += 1000
    elif query_norm and query_norm == cat_norm:
        score += 1000 if sec["kind"] == "category" else 120
    elif query_norm and (query_norm in title_norm or title_norm in query_norm):
        score += 400
    heading = sec["heading_tokens"]
    overlap_h = query_tokens & heading
    score += 25 * len(overlap_h)
    if heading and heading <= query_tokens:
        score += 500
    score += len(query_tokens & sec["body_tokens"])
    if sec["kind"] == "subsection" and query_norm not in {title_norm, cat_norm}:
        score += 14
    if prefer_how_to and sec["source"] == "how_to":
        score += 12
    if prefer_faq and sec["source"] == "faq":
        score += 8
    if sec["source"] == "faq":
        score += 2
    return score


def retrieve_sections(message: str, limit: int = 3) -> list[dict[str, Any]]:
    query_norm = clean_heading(message).lower()
    query_tokens = expand_synonyms(fuzzy_expand(tokenize(message)))
    if not query_tokens and not query_norm:
        return []
    prefer_how_to = bool(re.search(r"\b(?:how|where)\s+(?:do|can)\s+i\b", message, re.I))
    prefer_faq = bool(re.search(r"\b(?:what happens|rules?|punishment|price|cost|chance)\b", message, re.I))
    ranked: list[tuple[int, dict[str, Any]]] = []
    for sec in load_sections():
        score = _score_section(
            query_norm,
            query_tokens,
            sec,
            prefer_how_to=prefer_how_to,
            prefer_faq=prefer_faq,
        )
        if score >= MIN_MATCH_SCORE:
            ranked.append((score, sec))
    ranked.sort(key=lambda x: (-x[0], 0 if x[1]["kind"] == "subsection" else 1, x[1]["title"]))
    picked: list[dict[str, Any]] = []
    parent_keys: set[tuple[str, str]] = set()
    for score, sec in ranked:
        key = (sec["source"], sec["category"])
        if sec["kind"] == "category":
            parent_keys.add(key)
            picked.append(sec)
        else:
            if key in parent_keys:
                continue
            picked.append(sec)
        if len(picked) >= limit:
            break
    return picked


def format_section_bbcode(sec: dict[str, Any]) -> str:
    return sec["body"]


def _answer_from_matches(
    matches: list[dict[str, Any]],
    *,
    intent: str,
    wealth: Optional[dict[str, Any]] = None,
    intent_id: Optional[str] = None,
    domain: Optional[str] = None,
    answer_type: str = "direct",
    confidence: str = "medium",
    match_method: str = "section_retrieval",
    suggestions: Optional[list[str]] = None,
    corrections: Optional[list[dict[str, str]]] = None,
    entities: Optional[list[dict[str, str]]] = None,
) -> dict[str, Any]:
    primary = matches[0]
    source_name = "FAQs" if primary["source"] == "faq" else "How To"
    topic = primary["title"] if primary["kind"] == "category" else f"{primary['category']} → {primary['title']}"
    if answer_type == "comparison":
        preamble = "Here are the published guide sections for both sides, boss."
    elif answer_type == "troubleshooting":
        preamble = "These published guide sections cover that problem, boss."
    elif answer_type == "yes_no":
        preamble = f"The published guide answers that under {source_name}: {topic}."
    else:
        preamble = f"Here's the score, boss — from {source_name}: {topic}."
    related = suggestions if suggestions is not None else _section_suggestions(matches)
    provenance = [
        {
            "source": section["source"],
            "kind": section["kind"],
            "category": section["category"],
            "title": section["title"],
            "method": "verbatim_guide_section",
        }
        for section in matches
    ]
    return {
        "refused": False,
        "wealth": wealth,
        "fallback_contents": False,
        "chat": False,
        "intent": intent,
        "preamble": preamble,
        "context": _section_context(
            primary,
            intent_id=intent_id,
            domain=domain,
            answer_type=answer_type,
        ),
        "suggestions": related,
        "related_questions": related,
        "choices": [],
        "confidence": confidence,
        "match_method": match_method,
        "intent_id": intent_id,
        "answer_type": answer_type,
        "typo_corrections": corrections or [],
        "entities": entities or [],
        "provenance": provenance,
        "reply_sections": [
            {
                "source": section["source"],
                "title": section["title"],
                "category": section["category"],
                "kind": section["kind"],
                "body": format_section_bbcode(section),
            }
            for section in matches
        ],
    }


def _catalog_choices(matches: list[Any]) -> list[dict[str, str]]:
    choices: list[dict[str, str]] = []
    seen_sections: set[tuple[str, str, str]] = set()
    for match in matches:
        refs = match.intent.get("sections", [])
        if not refs:
            continue
        ref = refs[0]
        key = (ref["source"], ref["category"], ref["title"])
        if key in seen_sections:
            continue
        seen_sections.add(key)
        choices.append(
            {
                "label": ref["title"],
                "message": match.intent["variants"][0],
                "intent_id": match.intent["id"],
                "source": ref["source"],
                "category": ref["category"],
            }
        )
        if len(choices) >= 3:
            break
    return choices


def _pending_choice_answer(
    text: str,
    context: Optional[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    safe = sanitize_context(context)
    if not safe:
        return None
    choice_ids = safe.get("choice_intent_ids", [])
    ordinal = _ORDINAL_RE.match(text)
    if ordinal and choice_ids:
        positions = {"first": 0, "1st": 0, "second": 1, "2nd": 1, "third": 2, "3rd": 2}
        index = positions[ordinal.group(1).lower()]
        if index < len(choice_ids):
            selected = catalog_by_id().get(choice_ids[index])
            if selected:
                sections = resolve_sections(selected, load_sections())
                if sections:
                    return _answer_from_matches(
                        sections,
                        intent="topic_search",
                        intent_id=selected["id"],
                        domain=selected["domain"],
                        answer_type=selected["intent_type"],
                        confidence="high",
                        match_method="clarification_choice",
                        suggestions=related_questions(selected),
                    )
    if _OTHER_RE.match(text) and safe.get("intent_id"):
        selected = catalog_by_id().get(safe["intent_id"])
        if selected:
            sections = resolve_sections(selected, load_sections())
            if len(sections) > 1:
                return _answer_from_matches(
                    sections[1:],
                    intent="follow_up",
                    intent_id=selected["id"],
                    domain=selected["domain"],
                    answer_type="follow_up",
                    confidence="high",
                    match_method="context_other_section",
                    suggestions=related_questions(selected),
                )
    return None


def answer_question(message: str, context: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    text = (message or "").strip()
    if len(text) > MAX_MESSAGE_LEN:
        text = text[:MAX_MESSAGE_LEN]
    if is_refused_query(text) or _INJECTION_RE.search(text):
        return _system_sections(
            "Not available",
            REFUSAL_TEXT,
            refused=True,
            intent="refusal",
            suggestions=["How do rackets work?", "How does jail work?", "Wealth ranks"],
        )
    if _OFF_TOPIC_RE.search(text):
        return _system_sections(
            "Game questions only",
            _CHAT_UNKNOWN,
            chat=True,
            intent="unknown",
            suggestions=category_chips()[:6],
        )
    chat = small_talk_reply(text)
    if chat:
        return _system_sections(
            "Guide",
            chat,
            chat=True,
            intent="small_talk",
            suggestions=["How do rackets work?", "How does jail work?", "Wealth ranks"],
        )
    pending = _pending_choice_answer(text, context)
    if pending:
        return pending
    if _FOLLOW_UP_RE.match(text):
        current = _find_context_section(context)
        follow_ups = [current] if current and re.fullmatch(r"\s*why[\s?.!]*", text, re.I) else _follow_up_sections(context)
        if follow_ups:
            safe = sanitize_context(context) or {}
            return _answer_from_matches(
                follow_ups,
                intent="follow_up",
                intent_id=safe.get("intent_id"),
                domain=safe.get("domain"),
                answer_type="follow_up",
                confidence="high",
                match_method="safe_topic_context",
            )
        return _system_sections(
            "Which topic?",
            "I can keep going, but remind me which game topic you mean, boss.",
            chat=True,
            intent="clarification",
            suggestions=category_chips()[:6],
        )
    choices = _broad_choices(text)
    if choices:
        labels = ", ".join(choice["label"] for choice in choices)
        return {
            **_system_sections(
                "Which one?",
                f"I've got a few files for that: {labels}. Which one do you mean?",
                chat=True,
                intent="clarification",
                suggestions=[choice["message"] for choice in choices],
            ),
            "choices": choices,
        }
    wealth = None
    amount = parse_money_amount(text)
    if amount is not None and amount >= 0:
        wealth = wealth_for_amount(amount)
        if "wealth" not in tokenize(text) and "rank" not in tokenize(text):
            text = f"{text} wealth ranks"
    shape = detect_question_shape(text)
    corrections = typo_corrections(text)
    safe_context = sanitize_context(context)
    contextual_topic = _CONTEXT_TOPIC_RE.match(text)
    catalog_query = text
    if contextual_topic and safe_context:
        context_words = f"{safe_context['category']} {safe_context['title']}".lower()
        anchor = next(
            (
                word
                for word in ("bank", "rank", "racket", "heat", "jail", "travel", "family")
                if word in context_words
            ),
            safe_context["title"],
        )
        catalog_query = f"{contextual_topic.group(1)} {anchor}"
    catalog_matches = match_catalog(catalog_query, limit=6)
    catalog_threshold = 54 if shape["shape"] in {"procedure", "troubleshooting", "yes_no"} else 68
    confident_catalog = [match for match in catalog_matches if match.score >= catalog_threshold]
    if confident_catalog:
        top = confident_catalog[0]
        choices = _catalog_choices(confident_catalog)
        top_ref = top.intent["sections"][0]
        top_key = (top_ref["source"], top_ref["category"], top_ref["title"])
        different_runner = next(
            (
                match
                for match in confident_catalog[1:]
                if (
                    match.intent["sections"][0]["source"],
                    match.intent["sections"][0]["category"],
                    match.intent["sections"][0]["title"],
                )
                != top_key
            ),
            None,
        )
        close_ambiguity = (
            top.score < 88
            and len(choices) > 1
            and len({choice["label"].lower() for choice in choices}) > 1
            and different_runner is not None
            and top.score - different_runner.score <= 2
        )
        if close_ambiguity:
            primary = resolve_sections(top.intent, load_sections())[0]
            labels = ", ".join(choice["label"] for choice in choices)
            choice_ids = [choice["intent_id"] for choice in choices]
            response = _system_sections(
                "Which one?",
                f"I found a few close guide topics: {labels}. Which one do you mean?",
                chat=True,
                intent="clarification",
                suggestions=[choice["message"] for choice in choices],
                answer_type="clarification",
                context=_section_context(
                    primary,
                    domain=top.intent["domain"],
                    answer_type="clarification",
                    choice_intent_ids=choice_ids,
                ),
            )
            response["choices"] = choices
            response["match_method"] = "catalog_ambiguity"
            response["entities"] = shape["entities"]
            return response
        matches = resolve_sections(top.intent, load_sections())
        if wealth is not None:
            wealth_sections = [
                section
                for section in load_sections()
                if section["kind"] == "subsection" and "wealth" in section["title_norm"]
            ]
            for section in reversed(wealth_sections):
                if section not in matches:
                    matches.insert(0, section)
        if matches:
            answer_type = top.intent["intent_type"]
            if answer_type in {"definition", "rules"} and shape["shape"] in {
                "yes_no",
                "troubleshooting",
                "procedure",
                "comparison",
            }:
                answer_type = shape["shape"]
            return _answer_from_matches(
                matches[:4],
                intent="wealth_lookup" if wealth else "topic_search",
                wealth=wealth,
                intent_id=top.intent["id"],
                domain=top.intent["domain"],
                answer_type=answer_type,
                confidence=(
                    "medium"
                    if top.confidence == "low"
                    and shape["shape"] in {"procedure", "troubleshooting", "yes_no"}
                    else top.confidence
                ),
                match_method=top.method,
                suggestions=related_questions(top.intent),
                corrections=corrections,
                entities=shape["entities"],
            )
    matches = retrieve_sections(text)
    if wealth is not None:
        wealth_secs = [
            s
            for s in load_sections()
            if s["kind"] == "subsection" and "wealth" in s["title_norm"]
        ]
        for ws in wealth_secs:
            if ws not in matches:
                matches.insert(0, ws)
        matches = matches[:4]
    if not matches:
        return {
            "refused": False,
            "wealth": wealth,
            "fallback_contents": True,
            "chat": True,
            "intent": "unknown",
            "preamble": None,
            "context": None,
            "suggestions": category_chips()[:8],
            "related_questions": category_chips()[:8],
            "choices": [],
            "confidence": "low",
            "match_method": "no_match",
            "intent_id": None,
            "answer_type": "clarification",
            "typo_corrections": corrections,
            "entities": shape["entities"],
            "provenance": [{"source": "system", "title": "Topics", "method": "fixed_system_copy"}],
            "reply_sections": [
                {
                    "source": "system",
                    "title": "Topics",
                    "body": (
                        f"{_CHAT_UNKNOWN}\n\n"
                        + "\n".join(f"[*]{topic}" for topic in category_chips())
                    ),
                }
            ],
        }
    if (
        not corrections
        and wealth is None
        and shape["shape"] not in {"procedure", "troubleshooting", "yes_no"}
    ):
        choices = [
            {
                "label": section["title"],
                "message": section["title"],
                "source": section["source"],
                "category": section["category"],
            }
            for section in matches[:3]
        ]
        labels = ", ".join(choice["label"] for choice in choices)
        response = _system_sections(
            "Which topic?",
            f"I found a few possible guide topics: {labels}. Which one matches your question?",
            chat=True,
            intent="clarification",
            suggestions=[choice["message"] for choice in choices],
            answer_type="clarification",
            context=_section_context(matches[0], answer_type="clarification"),
        )
        response["choices"] = choices
        response["match_method"] = "low_confidence_section_choices"
        response["entities"] = shape["entities"]
        return response
    return _answer_from_matches(
        matches,
        intent="wealth_lookup" if wealth else "topic_search",
        wealth=wealth,
        answer_type=shape["shape"],
        confidence=(
            "medium"
            if corrections or shape["shape"] in {"procedure", "troubleshooting", "yes_no"}
            else "low"
        ),
        match_method="fuzzy_section" if corrections else "section_retrieval",
        corrections=corrections,
        entities=shape["entities"],
    )


def heading_titles() -> list[tuple[str, str, str]]:
    """(source, kind, title) for every indexed heading — used by coverage tests."""
    return [(s["source"], s["kind"], s["title"]) for s in load_sections()]
