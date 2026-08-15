# Player FAQ / How To guide chatbot (retrieve published sections only).
from typing import Any, Literal, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from utils.game_help_chat import (
    MAX_CONTEXT_FIELD_LEN,
    MAX_MESSAGE_LEN,
    answer_question,
    category_chips,
)


class GuideTopicContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["faq", "how_to"]
    kind: Literal["category", "subsection"]
    category: str = Field(..., min_length=1, max_length=MAX_CONTEXT_FIELD_LEN)
    title: str = Field(..., min_length=1, max_length=MAX_CONTEXT_FIELD_LEN)
    intent_id: Optional[str] = Field(None, max_length=MAX_CONTEXT_FIELD_LEN)
    domain: Optional[str] = Field(None, max_length=MAX_CONTEXT_FIELD_LEN)
    answer_type: Optional[str] = Field(None, max_length=MAX_CONTEXT_FIELD_LEN)
    choice_intent_ids: list[str] = Field(default_factory=list, max_length=5)


class GuideChatBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(..., min_length=1, max_length=MAX_MESSAGE_LEN)
    context: Optional[GuideTopicContext] = None


class GuideReplySection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["faq", "how_to", "system"]
    title: str
    body: str
    category: Optional[str] = None
    kind: Optional[Literal["category", "subsection"]] = None


class GuideChatResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refused: bool
    wealth: Optional[dict[str, Any]]
    fallback_contents: bool
    chat: bool
    intent: str
    preamble: Optional[str]
    context: Optional[GuideTopicContext]
    suggestions: list[str]
    related_questions: list[str]
    choices: list[dict[str, Any]]
    confidence: Literal["high", "medium", "low"]
    match_method: str
    intent_id: Optional[str]
    answer_type: str
    typo_corrections: list[dict[str, str]]
    entities: list[dict[str, str]]
    provenance: list[dict[str, str]]
    reply_sections: list[GuideReplySection]


def register(router):
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    _is_admin = srv._is_admin

    async def _flag_enabled() -> bool:
        main = await db.game_settings.find_one({"_id": "main"}, {"_id": 0, "game_help_chat_enabled": 1})
        if not main or "game_help_chat_enabled" not in main:
            return True
        return bool(main.get("game_help_chat_enabled"))

    async def _allowed(user: dict) -> bool:
        if _is_admin(user):
            return True
        return await _flag_enabled()

    async def _require_access(current_user: dict = Depends(get_current_user)):
        if not await _allowed(current_user):
            raise HTTPException(status_code=403, detail="Game Guide is not available yet.")
        return current_user

    @router.get("/help/chat/quota")
    async def help_chat_quota(current_user: dict = Depends(get_current_user)):
        allowed = await _allowed(current_user)
        if not allowed:
            return {
                "allowed": False,
                "enabled_for_players": False,
                "categories": [],
            }
        return {
            "allowed": True,
            "enabled_for_players": await _flag_enabled(),
            "categories": category_chips(),
        }

    @router.post("/help/chat", response_model=GuideChatResponse)
    async def help_chat(body: GuideChatBody, current_user: dict = Depends(_require_access)):
        safe_context = body.context.model_dump() if body.context else None
        return answer_question(body.message, safe_context)
