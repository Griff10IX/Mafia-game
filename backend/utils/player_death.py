"""User doc changes applied when a real player character dies."""

from utils.auto_rank_death import AUTO_RANK_PAUSE_ON_DEATH
from utils.founding_member import (
    founding_member_strip_on_death_pull,
    founding_member_strip_on_death_set,
)
from utils.profile_cosmetics import custom_profile_badge_strip_on_death_pull, custom_profile_badge_strip_on_death_set


def player_death_set_fields() -> dict:
    return {
        **AUTO_RANK_PAUSE_ON_DEATH,
        **founding_member_strip_on_death_set(),
        **custom_profile_badge_strip_on_death_set(),
    }


def player_death_pull_fields() -> dict:
    return {
        **founding_member_strip_on_death_pull(),
        **custom_profile_badge_strip_on_death_pull(),
    }
