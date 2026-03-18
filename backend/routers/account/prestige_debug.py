from fastapi import Depends, HTTPException

import server as srv


def register(router):
    db = srv.db
    get_current_user = srv.get_current_user
    get_rank_info = srv.get_rank_info
    RANKS = srv.RANKS
    PRESTIGE_CONFIGS = srv.PRESTIGE_CONFIGS
    get_prestige_requirement = srv.get_prestige_requirement
    _is_admin = srv._is_admin

    @router.get("/admin/prestige-debug")
    async def prestige_debug(current_user: dict = Depends(get_current_user)):
        """Debug view of prestige XP curve (admin-only)."""
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Not authorized")
        out = []
        godfather_req = RANKS[-1]["required_points"]
        for level in range(0, 5):
            mult = float(PRESTIGE_CONFIGS[level]["threshold_mult"]) if level in PRESTIGE_CONFIGS else 1.0 if level == 0 else 1.0
            next_req = get_prestige_requirement(level) if level < 5 else 0
            # Raw rank points to first reach Godfather at this prestige
            raw_to_gf = int(godfather_req * mult)
            # Raw rank points to satisfy prestige requirement
            raw_to_prestige = int(next_req * mult) if next_req else 0
            extra_at_gf = max(0, raw_to_prestige - raw_to_gf)
            frac_at_gf = (extra_at_gf / raw_to_prestige) if raw_to_prestige > 0 else 0.0
            out.append({
                "prestige_level": level,
                "threshold_mult": mult,
                "effective_req_next_prestige": next_req,
                "effective_godfather_req": godfather_req,
                "raw_points_to_godfather": raw_to_gf,
                "raw_points_to_next_prestige": raw_to_prestige,
                "raw_extra_at_godfather": extra_at_gf,
                "fraction_raw_at_godfather": frac_at_gf,
            })
        return {"curve": out}

