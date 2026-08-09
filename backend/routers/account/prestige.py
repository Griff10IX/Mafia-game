# Prestige system: 5 levels unlocked after reaching Godfather, each harder than the last.
from fastapi import Depends, HTTPException


def _fmt_mult(x: float) -> str:
    """Short string for multipliers (drops trailing .0)."""
    if abs(x - round(x)) < 1e-9:
        return str(int(round(x)))
    return str(x).rstrip("0").rstrip(".")


def _format_prestige_unlock_benefits(cfg: dict, unlocked_prestige_level: int) -> str:
    """Human-readable list of bonuses for the prestige level just unlocked (matches UI table + extra fields)."""
    import server as srv

    parts: list[str] = []
    crime = float(cfg.get("crime_mult") or 1.0)
    if crime != 1.0:
        parts.append(f"crime payouts +{round((crime - 1.0) * 100)}%")
    oc = float(cfg.get("oc_mult") or 1.0)
    if oc != 1.0:
        parts.append(f"OC payouts +{round((oc - 1.0) * 100)}%")
    gta = float(cfg.get("gta_rare_boost") or 0.0)
    if gta:
        parts.append(f"GTA rare car rolls +{_fmt_mult(gta)}×")
    npc = float(cfg.get("npc_mult") or 1.0)
    if npc != 1.0:
        parts.append(f"NPC rewards +{round((npc - 1.0) * 100)}%")
    mission_m = float(cfg.get("mission_reward_mult") if cfg.get("mission_reward_mult") is not None else 1.0)
    parts.append(f"mission reward multiplier ×{_fmt_mult(mission_m)}")
    ib = float(cfg.get("illegal_business_mult") or 1.0)
    if ib != 1.0:
        parts.append(f"illegal business income +{round((ib - 1.0) * 100)}%")
    thr = srv.get_rank_threshold_mult(unlocked_prestige_level)
    if thr > 1.0:
        parts.append(f"rank tier thresholds ×{_fmt_mult(thr)} (same ladder shape, scaled to your prestige gate)")
    if not parts:
        return "See the Prestige page for details."
    out = ", ".join(parts)
    return out[0].upper() + out[1:] if out else out


def register(router):
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    get_rank_info = srv.get_rank_info
    PRESTIGE_CONFIGS = srv.PRESTIGE_CONFIGS
    get_prestige_bonus = srv.get_prestige_bonus
    get_prestige_requirement = srv.get_prestige_requirement
    GODFATHER_RANK_ID = srv.GODFATHER_RANK_ID

    @router.get("/prestige/info")
    async def prestige_info(current_user: dict = Depends(get_current_user)):
        """Return the current user's prestige status and next-prestige requirements."""
        level = int(current_user.get("prestige_level") or 0)
        rank_points = int(current_user.get("rank_points") or 0)
        mult = float(current_user.get("prestige_rank_multiplier") or 1.0)
        rank_id, rank_name = get_rank_info(rank_points, mult)

        at_max = level >= 5
        next_level = level + 1 if not at_max else None
        godfather_req = get_prestige_requirement(level) if next_level else None
        godfather_effective_threshold = int(srv.RANKS[-1]["required_points"] * mult)
        prestige_path_target_effective = None
        if next_level is not None and godfather_req is not None:
            # Bar must reflect the real climb: you cannot prestige below Godfather, and some gates exceed that RP.
            prestige_path_target_effective = max(godfather_effective_threshold, int(godfather_req))

        effective_rp = rank_points
        can_prestige = (
            not at_max
            and rank_id >= GODFATHER_RANK_ID
            and godfather_req is not None
            and effective_rp >= godfather_req
        )

        current_benefits = get_prestige_bonus(current_user)

        from utils.prestige_points_rewards import points_reward_for_prestige_level

        all_levels = []
        for lvl, cfg in PRESTIGE_CONFIGS.items():
            if lvl == 1:
                level_req = srv.get_prestige_requirement(0)
            else:
                level_req = srv.get_prestige_requirement(lvl - 1)

            all_levels.append(
                {
                    "level": lvl,
                    "name": cfg.get("name", ""),
                    "godfather_req": level_req,
                    "points_reward": points_reward_for_prestige_level(lvl),
                    "crime_mult": cfg.get("crime_mult", 1.0),
                    "oc_mult": cfg.get("oc_mult", 1.0),
                    "gta_rare_boost": cfg.get("gta_rare_boost", 0),
                    "npc_mult": cfg.get("npc_mult", 1.0),
                    "mission_reward_mult": cfg.get("mission_reward_mult", 1.0),
                    "illegal_business_mult": cfg.get("illegal_business_mult", 1.0),
                    "rank_threshold_mult": float(srv.get_rank_threshold_mult(lvl)),
                }
            )

        return {
            "prestige_level": level,
            "prestige_name": PRESTIGE_CONFIGS.get(level, {}).get("name") if level > 0 else None,
            "rank_points": rank_points,
            "rank_id": rank_id,
            "rank_name": rank_name,
            "effective_rank_points": effective_rp,
            "can_prestige": can_prestige,
            "at_max_prestige": at_max,
            "godfather_req": godfather_req,
            "godfather_effective_threshold": godfather_effective_threshold,
            "prestige_path_target_effective": prestige_path_target_effective,
            "current_benefits": current_benefits,
            "all_levels": all_levels,
        }

    @router.post("/prestige/activate")
    async def prestige_activate(current_user: dict = Depends(get_current_user)):
        """Prestige the user: must be at Godfather. Resets rank_points to 0, increments prestige_level.
        Mission progress and Game Pass tier cursors / carry RP are preserved (rank XP is banked into
        rank_xp_pass_prestige_carry_rp for everyone so pass UI and VIP math stay consistent)."""
        level = int(current_user.get("prestige_level") or 0)
        if level >= 5:
            raise HTTPException(status_code=400, detail="Already at maximum prestige (level 5)")

        rank_points = int(current_user.get("rank_points") or 0)
        effective_rp = rank_points
        godfather_req = get_prestige_requirement(level)
        mult = float(current_user.get("prestige_rank_multiplier") or 1.0)

        rank_id, _ = get_rank_info(rank_points, mult)
        if rank_id < GODFATHER_RANK_ID:
            raise HTTPException(status_code=400, detail="You must reach Godfather rank before prestiging")
        if godfather_req is None or godfather_req <= 0 or effective_rp < godfather_req:
            raise HTTPException(
                status_code=400,
                detail=f"You need {godfather_req:,} effective rank points to prestige (you have {effective_rp:,})",
            )

        new_level = level + 1
        new_cfg = PRESTIGE_CONFIGS[new_level]
        new_mult = srv.get_rank_threshold_mult(new_level)

        gp_row = await db.users.find_one(
            {"id": current_user["id"]},
            {"_id": 0, "rank_xp_pass_prestige_carry_rp": 1},
        )
        prev_carry = int((gp_row or {}).get("rank_xp_pass_prestige_carry_rp") or 0)

        prestige_set = {
            "prestige_level": new_level,
            "prestige_rank_multiplier": new_mult,
            "rank_points": 0,
            "rank": 1,
            # Rank-up bullets/respect use rank_up_rewarded_to_rank as idempotency; without reset, old
            # Godfather-tier value makes every re-climb fire false "ranked up" notifications (e.g. Capo).
            "rank_up_rewarded_to_rank": 1,
            # Bank RP into carry for all players (not only active VIP). Previously non-VIP prestiging
            # zeroed carry + tier cursors, which looked like Game Pass reset and could break expired-VIP UI.
            "rank_xp_pass_prestige_carry_rp": prev_carry + rank_points,
        }

        await db.users.update_one(
            {"id": current_user["id"]},
            {"$set": prestige_set},
        )

        points_reward = 0
        try:
            from utils.prestige_points_rewards import (
                grant_pending_prestige_points_rewards,
                points_reward_for_prestige_level,
            )

            points_reward = points_reward_for_prestige_level(new_level)
            grant_out = await grant_pending_prestige_points_rewards(
                db,
                {"id": current_user["id"], "prestige_level": new_level, "is_dead": False},
                reason="prestige",
            )
            if int(grant_out.get("points") or 0) > 0:
                points_reward = int(grant_out["points"])
        except Exception:
            points_reward = 0

        try:
            from routers.game.leaderboard import invalidate_leaderboard_cache

            invalidate_leaderboard_cache()
        except Exception:
            pass

        benefits_line = _format_prestige_unlock_benefits(new_cfg, new_level)
        points_line = (
            f"\n\nReward: +{points_reward:,} points."
            if points_reward > 0
            else ""
        )
        await srv.send_notification(
            current_user["id"],
            f"Prestige {new_level} — {new_cfg['name']}!",
            f"You have prestiged to level {new_level} ({new_cfg['name']}). Your rank has reset to Rat.\n\n"
            f"Benefits at this level: {benefits_line}.{points_line}",
            "system",
            category="system",
        )

        await srv.log_activity(
            current_user["id"],
            current_user.get("username", "?"),
            "account_prestige",
            {"new_level": new_level, "name": new_cfg["name"], "points_reward": points_reward},
        )
        msg = f"Prestiged to level {new_level} — {new_cfg['name']}!"
        if points_reward > 0:
            msg += f" (+{points_reward:,} points)"
        return {
            "message": msg,
            "prestige_level": new_level,
            "prestige_name": new_cfg["name"],
            "points_reward": points_reward,
        }
