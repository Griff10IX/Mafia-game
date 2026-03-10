# Prestige system: 5 levels unlocked after reaching Godfather, each harder than the last.
from fastapi import Depends, HTTPException


def register(router):
    import server as srv

    db = srv.db
    get_current_user = srv.get_current_user
    get_rank_info = srv.get_rank_info
    PRESTIGE_CONFIGS = srv.PRESTIGE_CONFIGS
    get_prestige_bonus = srv.get_prestige_bonus
    get_prestige_requirement = srv.get_prestige_requirement

    @router.get("/prestige/info")
    async def prestige_info(current_user: dict = Depends(get_current_user)):
        """Return the current user's prestige status and next-prestige requirements."""
        level = int(current_user.get("prestige_level") or 0)
        mult = float(current_user.get("prestige_rank_multiplier") or 1.0)
        rank_points = int(current_user.get("rank_points") or 0)
        rank_id, rank_name = get_rank_info(rank_points, mult)

        at_max = level >= 5
        next_level = level + 1 if not at_max else None
        godfather_req = get_prestige_requirement(level) if next_level else None

        effective_rp = int(rank_points / mult) if mult > 1.0 else rank_points
        # Require Godfather rank and effective RP >= next level's requirement
        can_prestige = (
            not at_max
            and rank_id >= 11
            and godfather_req is not None
            and effective_rp >= godfather_req
        )

        current_benefits = get_prestige_bonus(current_user)

        all_levels = []
        for lvl, cfg in PRESTIGE_CONFIGS.items():
            # godfather_req in the table should match the effective RP needed
            # to unlock this prestige level (i.e. requirement from previous level).
            if lvl == 1:
                level_req = srv.get_prestige_requirement(0)
            else:
                level_req = srv.get_prestige_requirement(lvl - 1)
            all_levels.append({
                "level": lvl,
                "name": cfg["name"],
                "godfather_req": level_req,
                "crime_mult": cfg["crime_mult"],
                "oc_mult": cfg["oc_mult"],
                "gta_rare_boost": cfg["gta_rare_boost"],
                "npc_mult": cfg["npc_mult"],
                "mission_reward_mult": cfg.get("mission_reward_mult", 1.0),
            })

        return {
            "prestige_level": level,
            "prestige_name": PRESTIGE_CONFIGS[level]["name"] if level > 0 else None,
            "rank_points": rank_points,
            "rank_id": rank_id,
            "rank_name": rank_name,
            "effective_rank_points": effective_rp,
            "can_prestige": can_prestige,
            "at_max_prestige": at_max,
            "godfather_req": godfather_req,
            "current_benefits": current_benefits,
            "all_levels": all_levels,
        }

    @router.post("/prestige/activate")
    async def prestige_activate(current_user: dict = Depends(get_current_user)):
        """Prestige the user: must be at Godfather. Resets rank_points to 0, increments prestige_level."""
        level = int(current_user.get("prestige_level") or 0)
        if level >= 5:
            raise HTTPException(status_code=400, detail="Already at maximum prestige (level 5)")

        mult = float(current_user.get("prestige_rank_multiplier") or 1.0)
        rank_points = int(current_user.get("rank_points") or 0)
        effective_rp = int(rank_points / mult) if mult > 1.0 else rank_points
        godfather_req = get_prestige_requirement(level)

        rank_id, _ = get_rank_info(rank_points, mult)
        if rank_id < 11:
            raise HTTPException(status_code=400, detail="You must reach Godfather rank before prestiging")
        if godfather_req is None or godfather_req <= 0 or effective_rp < godfather_req:
            raise HTTPException(status_code=400, detail=f"You need {godfather_req:,} effective rank points to prestige (you have {effective_rp:,})")

        new_level = level + 1
        new_cfg = PRESTIGE_CONFIGS[new_level]
        new_mult = new_cfg["threshold_mult"]

        # Reset missions so they can be redone; payouts scale by prestige (mission_reward_mult).
        mission_reset_unset = {
            "mission_1_crimes_baseline": "",
            "mission_2_crimes_baseline": "",
            "mission_2_jail_busts_baseline": "",
            "mission_3_crimes_baseline": "",
            "mission_3_jail_busts_baseline": "",
            "mission_3_gta_baseline": "",
            "mission_3_booze_sells_baseline": "",
            "mission_3_bullets_melted_baseline": "",
            "mission_3_bullets_purchased_armoury_baseline": "",
            "mission_3_uncommon_cars_scrapped_baseline": "",
            "first_mission_notification_sent": "",
        }

        await db.users.update_one(
            {"id": current_user["id"]},
            {
                "$set": {
                    "prestige_level": new_level,
                    "prestige_rank_multiplier": new_mult,
                    "rank_points": 0,
                    "rank": 1,
                    "mission_completions": [],
                },
                "$unset": mission_reset_unset,
            },
        )

        await srv.send_notification(
            current_user["id"],
            f"Prestige {new_level} — {new_cfg['name']}!",
            f"You have prestiged to level {new_level} ({new_cfg['name']}). Your rank has reset to Rat. "
            f"Next prestige requires {get_prestige_requirement(new_level):,} effective rank points at Godfather.",
            "system",
            category="system",
        )

        return {
            "message": f"Prestiged to level {new_level} — {new_cfg['name']}!",
            "prestige_level": new_level,
            "prestige_name": new_cfg["name"],
        }
