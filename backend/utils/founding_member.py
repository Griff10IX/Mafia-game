"""Founding Member badge — account-only; stripped on character death."""

FOUNDING_MEMBER_BADGE = "Founding Member"
FOUNDING_MEMBER_COST_POINTS = 5000
FOUNDING_MEMBER_STORE_REF = "buy-founding-member"
FOUNDING_MEMBER_PASSIVE_BONUS_PCT = 15


def user_has_founding_member(user: dict) -> bool:
    if not user:
        return False
    if user.get("founding_member"):
        return True
    badges = user.get("badges")
    return isinstance(badges, list) and FOUNDING_MEMBER_BADGE in badges


def founding_member_strip_on_death_set() -> dict:
    return {"founding_member": False}


def founding_member_strip_on_death_pull() -> dict:
    return {"badges": FOUNDING_MEMBER_BADGE}
