# Pure lap-resolution logic for interactive races (no DB / FastAPI).
# Config is injected from racing.py to avoid circular imports and constant drift.

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple


@dataclass
class LapEngineConfig:
    """Subset of racing.py constants — populated by racing module."""

    tire_wear_per_lap: float
    tire_pit_threshold: float
    pit_threshold_per_level: float
    strategist_pit_offset_per_level: float
    pit_random_threshold_per_level: float
    pit_penalty_factor_base: float
    pit_penalty_improvement_per_level: float
    fuel_weight_penalty_per_level: float
    fuel_tech_weight_per_level: float
    corner_grip_brakes_per_level: float
    corner_grip_aero_per_level: float
    corner_grip_susp_per_level: float
    cooling_speed_penalty_at_risk_per_level: float
    cooling_dnf_risk_reduction_per_level: float
    tactician_wet_pace_per_level: float
    morale_top_half_pace_per_level: float
    spotter_dodge_chance_per_level: float
    tyre_tech_wear_reduction_per_level: float
    logistics_wear_reduction_per_level: float
    acceleration_bonus_per_level: float
    overtaking_chance_per_level: float
    reliability_wear_reduction_per_level: float
    cooling_wear_reduction_per_level: float
    engine_wear_per_race_divisor: float  # ENGINE_WEAR_PER_RACE / max(1,total_laps) passed in
    engine_risk_threshold: float
    engine_wear_max: float
    engine_dnf_chance_per_lap_at_100: float
    engine_speed_penalty_at_risk: float
    max_crew_level: int
    tire_compounds: List[dict]
    get_weather: Callable[[str], dict]


def default_sectors_from_track(track: dict, is_wet: bool) -> List[dict]:
    """Build 3 sectors if track has no explicit sectors list."""
    if track.get("sectors"):
        return list(track["sectors"])
    corners = int(track.get("corners") or 10)
    corner_severity = float(track.get("corner_severity") or 0.4)
    cw = min(0.6, corners * corner_severity * 0.015)
    if is_wet:
        cw = min(0.75, cw * 1.35)
    straight_share = max(0.2, 1.0 - cw)
    return [
        {"kind": "straight", "weight": straight_share * 0.52, "drs": True},
        {"kind": "corner", "weight": cw, "drs": False},
        {"kind": "straight", "weight": straight_share * 0.48, "drs": True},
    ]


def _weather_grip_mult(weather: dict) -> float:
    g = weather.get("grip_mult")
    if g is not None:
        return float(g)
    sm = float(weather.get("speed_mult", 1.0))
    return 0.92 + (sm - 0.78) * 0.25


def sectorized_combined_pace(
    speed_val: float,
    grip_val: float,
    tire_factor: float,
    compound_mult: float,
    corner_grip_bonus: float,
    weather: dict,
    sectors: List[dict],
) -> float:
    speed_mult = float(weather.get("speed_mult", 1.0))
    grip_mult = _weather_grip_mult(weather)
    straight_perf = speed_val * tire_factor * speed_mult
    corner_perf = grip_val * tire_factor * corner_grip_bonus * speed_mult * grip_mult
    tw = sum(float(s.get("weight", 0)) for s in sectors)
    if tw <= 0:
        return straight_perf * 0.5 + corner_perf * 0.5
    total = 0.0
    for s in sectors:
        w = float(s.get("weight", 0)) / tw
        if s.get("kind") == "corner":
            total += w * corner_perf
        else:
            total += w * straight_perf
    return max(0.01, total)


def pace_mode_to_levels(pace_mode: Optional[str], push_level: int) -> Tuple[int, float, float]:
    """Returns (effective_push_level, pace_mult, wear_mult)."""
    pm = (pace_mode or "").strip().lower()
    if pm == "push":
        return 5, 1.045, 1.22
    if pm == "conserve":
        return 1, 0.965, 0.78
    if pm == "normal":
        return 3, 0.92 + 3 * 0.04, 0.7 + 3 * 0.15
    if pm == "":
        pl = max(1, min(5, int(push_level or 3)))
        pace_mult = 0.92 + pl * 0.04
        wear_mult = 0.7 + pl * 0.15
        return pl, pace_mult, wear_mult
    pl = max(1, min(5, int(push_level or 3)))
    pace_mult = 0.92 + pl * 0.04
    wear_mult = 0.7 + pl * 0.15
    return pl, pace_mult, wear_mult


def qual_lap_time(
    cfg: LapEngineConfig,
    lap_base: float,
    speed_val: float,
    grip_val: float,
    compound_mult: float,
    corner_grip_bonus: float,
    weather_id: str,
    track: dict,
    qual_noise: float,
) -> float:
    weather = cfg.get_weather(weather_id)
    is_wet = weather_id in ("rain", "snow")
    sectors = default_sectors_from_track(track or {}, is_wet)
    combined = sectorized_combined_pace(
        speed_val, grip_val, 1.0, compound_mult, corner_grip_bonus, weather, sectors
    )
    combined = max(0.01, float(combined))
    t = lap_base / combined + qual_noise
    return max(20.0, min(300.0, t))


def launch_multiplier(
    lap_num: int,
    reaction_ms: Optional[int],
    accel_lvl: int,
    driver_skill: int,
    is_npc: bool,
) -> float:
    if lap_num != 1:
        return 1.0
    if is_npc:
        react = random.uniform(180, 420)
    else:
        react = float(reaction_ms if reaction_ms is not None else 320)
    react = max(80.0, min(650.0, react))
    react_penalty = (react - 200) / 2500.0
    launch_boost = accel_lvl * 0.0012 + (driver_skill - 50) * 0.0015
    return max(0.88, min(1.08, 1.0 - react_penalty + launch_boost))


def maybe_roll_weather_change(
    race_id: str, lap_num: int, current_weather: str, total_laps: int, rng: random.Random
) -> Tuple[str, bool]:
    order = ["clear", "night", "very_hot", "rain", "clear"]
    try:
        idx = order.index(current_weather)
    except ValueError:
        idx = 0
    if lap_num < 2 or lap_num >= total_laps:
        return current_weather, False
    if rng.random() > 0.07:
        return current_weather, False
    delta = rng.choice([-1, 1])
    new_idx = max(0, min(len(order) - 1, idx + delta))
    new_w = order[new_idx]
    if new_w == current_weather:
        return current_weather, False
    return new_w, True


def resolve_overtakes_v2(
    order: List[str],
    speed_by_id: Dict[str, float],
    lap_time_by_id: Dict[str, float],
    car_states: Dict[str, dict],
    decisions: Dict[str, dict],
    driver_cache: Dict[str, dict],
    upgrades_map: Dict[str, dict],
    entrants_by_id: Dict[str, dict],
    sectors: List[dict],
    safety_car_active: bool,
    rng: random.Random,
) -> Tuple[List[str], List[dict]]:
    """Returns (new_order, events_this_round)."""
    if safety_car_active:
        return list(order), []
    events: List[dict] = []
    o = list(order)
    drs_weight = sum(float(s.get("weight", 0)) for s in sectors if s.get("drs") and s.get("kind") != "corner")
    tw = sum(float(s.get("weight", 0)) for s in sectors) or 1.0
    drs_zone_strength = min(1.0, drs_weight / tw + 0.15)

    for _ in range(4):
        moved = False
        for i in range(len(o) - 1, 0, -1):
            car_behind = o[i]
            car_ahead = o[i - 1]
            sb, sa = speed_by_id.get(car_behind, 0), speed_by_id.get(car_ahead, 0)
            if sa <= 0 or sb <= 0:
                continue
            closeness = abs(sa - sb) / max(sa, sb)
            entrant_b = entrants_by_id.get(car_behind) or {}
            up_b = upgrades_map.get(
                (entrant_b.get("racing_car_instance_id") or entrant_b.get("id") or "")
            ) or {}
            ovt = int(up_b.get("overtaking_level") or 0)
            drv_b = driver_cache.get(car_behind, {})
            cs_b = car_states.get(car_behind, {})
            cs_a = car_states.get(car_ahead, {})
            tw_b = float(cs_b.get("tyre_wear") or 100) / 100.0
            tw_a = float(cs_a.get("tyre_wear") or 100) / 100.0
            grip_edge = max(0.0, tw_b - tw_a) * 0.35
            rnd_b = (cs_b.get("_rnd") or {}) if isinstance(cs_b.get("_rnd"), dict) else {}
            base_prob = (
                ovt * 0.0012
                + drv_b.get("racecraft", 50) * 0.0010
                + drv_b.get("aggression", 40) * 0.00035
                + float(rnd_b.get("overtaking_pct", 0) or 0)
                + grip_edge
            )
            if closeness < 0.035:
                base_prob += 0.04 * drs_zone_strength
            ahead_dec = decisions.get(car_ahead, {})
            if ahead_dec.get("defend"):
                base_prob *= 0.52
            if closeness > 0.11:
                continue
            roll = rng.random()
            if roll < base_prob * 0.85:
                o[i - 1], o[i] = car_behind, car_ahead
                events.append(
                    {
                        "type": "overtake",
                        "passer_id": car_behind,
                        "passed_id": car_ahead,
                    }
                )
            elif roll < base_prob * 1.15 and closeness < 0.06:
                events.append(
                    {
                        "type": "overtake_failed",
                        "attacker_id": car_behind,
                        "defender_id": car_ahead,
                    }
                )
                if rng.random() < 0.08 + drv_b.get("aggression", 40) * 0.001:
                    victim = car_behind if rng.random() < 0.5 else car_ahead
                    events.append(
                        {
                            "type": "failed_overtake_contact",
                            "attacker_id": car_behind,
                            "defender_id": car_ahead,
                            "victim_hint": victim,
                        }
                    )
    return o, events


def update_gaps_to_ahead(
    order: List[str],
    lap_time_sec: Dict[str, float],
    prev_gaps: Dict[str, float],
    safety_car_active: bool,
    rng: random.Random,
) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for i, eid in enumerate(order):
        if i == 0:
            continue
        ahead = order[i - 1]
        prev = float(prev_gaps.get(eid, 0.8))
        lt_b = lap_time_sec.get(eid, 90.0)
        lt_a = lap_time_sec.get(ahead, 90.0)
        lap_diff = (lt_b - lt_a) * 0.22
        if safety_car_active:
            out[eid] = max(0.08, min(1.2, 0.35 + rng.uniform(-0.08, 0.08)))
        else:
            out[eid] = max(0.02, min(45.0, prev - lap_diff + rng.uniform(-0.04, 0.04)))
    return out


def pit_stop_duration_sec(pit_level: int, rng: random.Random) -> float:
    base = 22.0 - min(100, max(0, pit_level)) * 0.14
    return max(16.5, base + rng.uniform(-0.8, 1.1))


@dataclass
class InteractiveLapResult:
    order: List[str]
    new_pit_stops: List[dict]
    new_incidents: List[dict]
    car_states: Dict[str, dict]
    new_dnfs: List[str]
    lap_events: List[dict]
    lap_time_sec: Dict[str, float]
    gaps_to_ahead: Dict[str, float]
    weather_id: str
    weather_changed: bool
    safety_car_laps_remaining: int
    safety_car_just_ended: bool


def run_interactive_lap_turn(
    cfg: LapEngineConfig,
    lap_num: int,
    total_laps: int,
    entrants: List[dict],
    profile_by_user: Dict[str, dict],
    upgrades_map: Dict[str, dict],
    car_states: Dict[str, dict],
    decisions: Dict[str, dict],
    weather_id: str,
    track: Optional[dict],
    crew_cache: Dict[str, dict],
    driver_cache: Dict[str, dict],
    prior_lap_results: List[List[str]],
    race_id: str,
    prev_gaps_to_ahead: Dict[str, float],
    safety_car_laps_remaining: int,
    rng: random.Random,
) -> InteractiveLapResult:
    track = track or {}

    ids = [e.get("user_id") or e.get("id") for e in entrants]
    entrants_by_id = {e.get("user_id") or e.get("id"): e for e in entrants}
    dnf_ids = [eid for eid in ids if car_states.get(eid, {}).get("dnf")]
    incoming_sc = int(safety_car_laps_remaining or 0)

    lap_events: List[dict] = []
    new_weather = weather_id
    weather_changed = False
    if incoming_sc <= 0:
        new_weather, weather_changed = maybe_roll_weather_change(
            race_id, lap_num, weather_id, total_laps, rng
        )
        if weather_changed:
            lap_events.append({"type": "weather_change", "to": new_weather})
            if new_weather in ("rain", "snow") and lap_num > 1 and rng.random() < 0.35:
                incoming_sc = rng.randint(1, 2)
                lap_events.append({"type": "safety_car_deployed", "laps": incoming_sc, "reason": "weather"})
    weather = cfg.get_weather(new_weather)
    is_wet = new_weather in ("rain", "snow")
    sectors = default_sectors_from_track(track, is_wet)
    tire_wear_mult = float(weather.get("tire_wear_mult", 1.0))

    new_pit_stops: List[dict] = []
    new_incidents: List[dict] = []
    new_dnfs: List[str] = []

    engine_wear_per_lap = cfg.engine_wear_per_race_divisor

    rnd_cache: Dict[str, dict] = {}

    def get_rnd(eid: str, entrant: dict) -> dict:
        if eid in rnd_cache:
            return rnd_cache[eid]
        raw = car_states.get(eid, {}).get("_rnd")
        if isinstance(raw, dict):
            rnd_cache[eid] = raw
            return raw
        rnd_cache[eid] = {}
        return {}

    for eid in ids:
        if eid in dnf_ids:
            continue
        cs = car_states.get(eid, {})
        wear = float(cs.get("engine_wear") or 0)
        if wear < cfg.engine_risk_threshold:
            continue
        entrant = entrants_by_id.get(eid)
        up = upgrades_map.get((entrant or {}).get("racing_car_instance_id") or (entrant or {}).get("id") or "") or {}
        cooling = int(up.get("cooling_level") or 0)
        cooling_risk_mult = max(0.4, 1.0 - cooling * cfg.cooling_dnf_risk_reduction_per_level)
        rnd_b = get_rnd(eid, entrant or {})
        dnf_chance = (wear - cfg.engine_risk_threshold) / max(
            1e-6, cfg.engine_wear_max - cfg.engine_risk_threshold
        ) * cfg.engine_dnf_chance_per_lap_at_100
        dnf_chance *= 1.0 - float(rnd_b.get("dnf_reduction", 0) or 0)
        if rng.random() < (dnf_chance * cooling_risk_mult):
            dnf_ids.append(eid)
            new_dnfs.append(eid)
            car_states[eid]["dnf"] = True
            lap_events.append({"type": "dnf_engine", "entrant_id": eid})

    pitting = set()
    for eid in ids:
        if eid in dnf_ids:
            continue
        decision = decisions.get(eid, {})
        entrant = entrants_by_id.get(eid)
        is_npc = (entrant or {}).get("is_npc")
        if not is_npc and eid in decisions and decision.get("pit_this_lap"):
            pitting.add(eid)
            new_compound = (decision.get("pit_compound") or "medium").lower()
            if new_compound not in ("soft", "medium", "hard", "inter", "full_wet"):
                new_compound = "medium"
            car_states[eid]["compound"] = new_compound
        elif is_npc or eid not in decisions:
            cs = car_states.get(eid, {})
            prof = profile_by_user.get(eid) or {}
            pit_level = min(cfg.max_crew_level, int(prof.get("pit_level") or 0))
            strategist = crew_cache.get(eid, {}).get("strategist", 0)
            pit_threshold = min(
                65,
                cfg.tire_pit_threshold
                + pit_level * cfg.pit_threshold_per_level
                - strategist * cfg.strategist_pit_offset_per_level,
            )
            tw = float(cs.get("tyre_wear") or 100)
            if tw < pit_threshold:
                pitting.add(eid)
            elif (
                lap_num > 1
                and lap_num < total_laps
                and rng.random() < 0.12
                and tw < (55 + pit_level * cfg.pit_random_threshold_per_level)
            ):
                pitting.add(eid)

    for eid in pitting:
        new_pit_stops.append({"lap": lap_num, "entrant_id": eid})
        prof = profile_by_user.get(eid) or {}
        pit_lvl = min(cfg.max_crew_level, int(prof.get("pit_level") or 0))
        dur = pit_stop_duration_sec(pit_lvl, rng)
        lap_events.append({"type": "pit_stop", "entrant_id": eid, "duration_sec": round(dur, 2)})

    lap_speeds: List[Tuple[str, float]] = []
    lap_time_sec: Dict[str, float] = {}
    lap_base = float(track.get("lap_base") or 90.0)

    for e in entrants:
        eid = e.get("user_id") or e.get("id")
        if eid in dnf_ids:
            lap_speeds.append((eid, 0.0))
            lap_time_sec[eid] = 999.0
            continue

        cs = car_states.get(eid, {})
        decision = decisions.get(eid, {})
        is_npc = e.get("is_npc")

        pace_mode = decision.get("pace_mode") if isinstance(decision, dict) else None
        raw_push = int(decision.get("push_level") or 3) if not is_npc and eid in decisions else 3
        if is_npc or eid not in decisions:
            drv = driver_cache.get(eid, {})
            raw_push = max(1, min(5, 2 + int(drv.get("aggression", 40) / 30)))
            defend = rng.random() < 0.1
        else:
            defend = bool(decision.get("defend"))

        eff_push, pace_mult, wear_mult_from_mode = pace_mode_to_levels(
            pace_mode if not is_npc else None, raw_push if not is_npc else raw_push
        )
        car_states[eid]["push_level"] = eff_push
        car_states[eid]["pace_mode"] = (pace_mode or ("normal" if eff_push == 3 else "push" if eff_push >= 4 else "conserve")).lower()

        from typing import TYPE_CHECKING

        if TYPE_CHECKING:
            pass

        # speed/grip from caller — use attached precomputed values in car_states for this lap
        speed_val = float(cs.get("_lap_speed_base", 10))
        grip_val = float(cs.get("_lap_grip_base", 0.85))

        eng_wear = float(cs.get("engine_wear") or 0)
        if eng_wear >= cfg.engine_risk_threshold:
            up = upgrades_map.get(e.get("racing_car_instance_id") or e.get("id") or "") or {}
            cooling_lvl = int(up.get("cooling_level") or 0)
            penalty = min(
                1.0,
                cfg.engine_speed_penalty_at_risk + cooling_lvl * cfg.cooling_speed_penalty_at_risk_per_level,
            )
            speed_val *= penalty

        speed_val *= pace_mult
        if defend:
            speed_val *= 0.97

        up_fuel = upgrades_map.get(e.get("racing_car_instance_id") or e.get("id") or "") or {}
        fuel_lvl = int(up_fuel.get("fuel_level") or 0)
        crew = crew_cache.get(eid, {})
        fuel_tech = crew.get("fuel_tech", 0)
        base_weight_penalty = 0.03 * ((total_laps - lap_num + 1) / max(1, total_laps))
        weight_penalty = max(
            0.0,
            base_weight_penalty
            - fuel_lvl * cfg.fuel_weight_penalty_per_level
            - fuel_tech * cfg.fuel_tech_weight_per_level,
        )
        fuel_weight_mult = 1.0 + weight_penalty

        tw = float(cs.get("tyre_wear") or 100)
        tire_factor = max(0.3, (tw / 100.0) ** 1.2)

        compound = (cs.get("compound") or "medium").lower()
        compound_mult = 1.0
        for c in cfg.tire_compounds:
            if c.get("id") == compound:
                compound_mult = float(c.get("grip_mult", 1.0))
                if is_wet and c.get("wet_grip_bonus"):
                    compound_mult += float(c.get("wet_grip_bonus", 0))
                break

        up = upgrades_map.get(e.get("racing_car_instance_id") or e.get("id") or "") or {}
        brakes = int(up.get("brakes_level") or 0)
        aero = int(up.get("aero_level") or 0)
        susp = int(up.get("suspension_level") or 0)
        accel_lvl = int(up.get("acceleration_level") or 0)

        corner_grip_bonus = (
            compound_mult
            + brakes * cfg.corner_grip_brakes_per_level
            + aero * cfg.corner_grip_aero_per_level
            + susp * cfg.corner_grip_susp_per_level
        )

        combined = sectorized_combined_pace(
            speed_val, grip_val, tire_factor, compound_mult, corner_grip_bonus, weather, sectors
        )
        combined /= fuel_weight_mult

        if accel_lvl > 0 and rng.random() < 0.15:
            combined *= 1.0 + accel_lvl * cfg.acceleration_bonus_per_level + float(
                (get_rnd(eid, e)).get("acceleration_pct", 0) or 0
            )

        drv_stats = driver_cache.get(eid, {})
        combined *= 1.0 + (drv_stats.get("skill", 50) - 50) * 0.002
        variance_scale = max(0.2, 1.0 - drv_stats.get("consistency", 50) * 0.008)
        combined += rng.uniform(-0.5, 0.5) * variance_scale
        if is_wet:
            combined *= 1.0 + (drv_stats.get("wet_ability", 50) - 50) * 0.003
            combined *= 1.0 + float((get_rnd(eid, e)).get("wet_grip_pct", 0) or 0)

        tactician = crew.get("tactician", 0)
        if is_wet and tactician > 0:
            combined *= 1.0 + tactician * cfg.tactician_wet_pace_per_level

        morale = crew.get("morale", 0)
        if morale > 0 and prior_lap_results:
            last_lap = prior_lap_results[-1]
            pos_idx = last_lap.index(eid) if eid in last_lap else len(last_lap)
            if pos_idx < len(ids) // 2:
                combined *= 1.0 + morale * cfg.morale_top_half_pace_per_level

        dmg = float(cs.get("damage") or 0)
        if dmg > 0:
            combined *= 1.0 - dmg

        if eid in pitting:
            ent_prof = profile_by_user.get(eid) or {}
            ent_pit_level = min(cfg.max_crew_level, int(ent_prof.get("pit_level") or 0))
            pit_factor = cfg.pit_penalty_factor_base + ent_pit_level * cfg.pit_penalty_improvement_per_level
            combined *= pit_factor

        reaction_ms = decision.get("reaction_ms") if isinstance(decision, dict) else None
        lm = launch_multiplier(
            lap_num,
            reaction_ms,
            accel_lvl,
            int(drv_stats.get("skill", 50)),
            bool(is_npc),
        )
        combined *= lm

        lap_speeds.append((eid, combined))
        lt = lap_base / max(0.01, combined) + rng.uniform(-0.04, 0.04)
        if eid in pitting:
            lt += pit_stop_duration_sec(
                min(cfg.max_crew_level, int((profile_by_user.get(eid) or {}).get("pit_level") or 0)), rng
            ) * 0.35
        lap_time_sec[eid] = max(12.0, min(400.0, lt))

    sc_active = incoming_sc > 0
    safety_car_just_ended = False

    rng.shuffle(lap_speeds)
    lap_speeds.sort(key=lambda x: -x[1])
    order = [x[0] for x in lap_speeds]
    speed_by_id = {eid: s for eid, s in lap_speeds}

    ov_events: List[dict]
    order, ov_events = resolve_overtakes_v2(
        order,
        speed_by_id,
        lap_time_sec,
        car_states,
        decisions,
        driver_cache,
        upgrades_map,
        entrants_by_id,
        sectors,
        sc_active,
        rng,
    )
    for ev in ov_events:
        lap_events.append(ev)
        if ev.get("type") == "failed_overtake_contact":
            va = ev.get("victim_hint")
            if not va:
                continue
            spotter = crew_cache.get(va, {}).get("spotter", 0)
            if spotter > 0 and rng.random() < spotter * cfg.spotter_dodge_chance_per_level:
                continue
            dmg_val = rng.uniform(0.02, 0.09)
            old_dmg = float(car_states.get(va, {}).get("damage") or 0)
            car_states[va]["damage"] = min(0.28, old_dmg + dmg_val)
            new_incidents.append(
                {
                    "lap": lap_num,
                    "entrant_ids": [ev.get("attacker_id"), ev.get("defender_id")],
                    "damaged": va,
                    "damage_pct": round(dmg_val * 100, 1),
                }
            )

    active_ids = [eid for eid in ids if eid not in dnf_ids]
    for i in range(len(active_ids)):
        for j in range(i + 1, len(active_ids)):
            eid_a, eid_b = active_ids[i], active_ids[j]
            score_a, score_b = speed_by_id.get(eid_a, 0), speed_by_id.get(eid_b, 0)
            if score_a <= 0 or score_b <= 0:
                continue
            closeness = abs(score_a - score_b) / max(score_a, score_b)
            if closeness > 0.05:
                continue
            aggr_a = driver_cache.get(eid_a, {}).get("aggression", 40)
            aggr_b = driver_cache.get(eid_b, {}).get("aggression", 40)
            corner_severity = float(track.get("corner_severity") or 0.4)
            contact_chance = corner_severity * 0.08 * (1.0 + ((aggr_a + aggr_b) / 2) * 0.005)
            if rng.random() < contact_chance:
                victim = rng.choice([eid_a, eid_b])
                spotter = crew_cache.get(victim, {}).get("spotter", 0)
                if spotter > 0 and rng.random() < spotter * cfg.spotter_dodge_chance_per_level:
                    continue
                dmg_val = rng.uniform(0.02, 0.08)
                old_dmg = float(car_states.get(victim, {}).get("damage") or 0)
                car_states[victim]["damage"] = min(0.25, old_dmg + dmg_val)
                new_incidents.append(
                    {
                        "lap": lap_num,
                        "entrant_ids": [eid_a, eid_b],
                        "damaged": victim,
                        "damage_pct": round(dmg_val * 100, 1),
                    }
                )
                lap_events.append({"type": "contact", "damaged": victim})

    crash_dnf_chance = 0.012 if not is_wet else 0.018
    for eid in active_ids:
        if eid in dnf_ids:
            continue
        dmg = float(car_states.get(eid, {}).get("damage") or 0)
        if dmg > 0.18 and rng.random() < crash_dnf_chance + dmg * 0.06:
            dnf_ids.append(eid)
            new_dnfs.append(eid)
            car_states[eid]["dnf"] = True
            lap_events.append({"type": "dnf_crash", "entrant_id": eid})

    for e in entrants:
        eid = e.get("user_id") or e.get("id")
        if eid in dnf_ids:
            continue
        cs = car_states.get(eid, {})
        up = upgrades_map.get(e.get("racing_car_instance_id") or e.get("id") or "") or {}
        rel = int(up.get("reliability_level") or 0)
        rnd_b = get_rnd(eid, e)
        wear_mult_rel = max(0.5, 1.0 - rel * cfg.reliability_wear_reduction_per_level)

        if eid in pitting:
            cs["tyre_wear"] = 100.0
        else:
            crew = crew_cache.get(eid, {})
            tyre_tech = crew.get("tyre_tech", 0)
            logistics = crew.get("logistics", 0)
            compound = (cs.get("compound") or "medium").lower()
            comp_wear = 1.0
            for c in cfg.tire_compounds:
                if c.get("id") == compound:
                    comp_wear = float(c.get("wear_mult", 1.0))
                    break
            crew_wear_reduction = (
                1.0
                - tyre_tech * cfg.tyre_tech_wear_reduction_per_level
                - logistics * cfg.logistics_wear_reduction_per_level
            )
            _, _, wear_mode_mult = pace_mode_to_levels(cs.get("pace_mode"), int(cs.get("push_level") or 3))
            wear_this_lap = (
                (cfg.tire_wear_per_lap + rng.uniform(-2, 2))
                * tire_wear_mult
                * comp_wear
                * wear_mult_rel
                * max(0.7, crew_wear_reduction)
                * wear_mode_mult
            )
            wear_this_lap *= 1.0 - float(rnd_b.get("tyre_wear_reduction", 0) or 0)
            drv_tire_mgmt = driver_cache.get(eid, {}).get("tire_management", 50)
            wear_this_lap *= max(0.7, 1.0 - drv_tire_mgmt * 0.003)
            cs["tyre_wear"] = max(0, float(cs.get("tyre_wear") or 100) - wear_this_lap)

        cooling = int(up.get("cooling_level") or 0)
        eng_wear_mult = max(0, 1.0 - cooling * cfg.cooling_wear_reduction_per_level)
        eng_wear_increment = engine_wear_per_lap * eng_wear_mult * (1.0 - float(rnd_b.get("engine_wear_reduction", 0) or 0))
        cs["engine_wear"] = min(cfg.engine_wear_max, float(cs.get("engine_wear") or 0) + eng_wear_increment)
        cs["fuel_pct"] = max(0, 100.0 * (total_laps - lap_num) / max(1, total_laps))
        cs["last_lap_time"] = round(lap_time_sec.get(eid, 0), 3)

    for i, eid in enumerate(order):
        if eid in car_states:
            car_states[eid]["position"] = i + 1

    out_sc = incoming_sc
    if incoming_sc > 0:
        out_sc = incoming_sc - 1
        if out_sc == 0:
            safety_car_just_ended = True
            lap_events.append({"type": "safety_car_in"})
    elif lap_num > 1 and rng.random() < 0.032:
        severe = sum(1 for ev in lap_events if ev.get("type") == "failed_overtake_contact")
        if rng.random() < 0.045 + severe * 0.025:
            out_sc = rng.randint(1, 3)
            lap_events.append({"type": "safety_car_deployed", "laps": out_sc})

    gaps = update_gaps_to_ahead(order, lap_time_sec, prev_gaps_to_ahead, sc_active, rng)

    for eid in list(car_states.keys()):
        car_states[eid].pop("_lap_speed_base", None)
        car_states[eid].pop("_lap_grip_base", None)

    return InteractiveLapResult(
        order=order,
        new_pit_stops=new_pit_stops,
        new_incidents=new_incidents,
        car_states=car_states,
        new_dnfs=new_dnfs,
        lap_events=lap_events,
        lap_time_sec={k: round(v, 3) for k, v in lap_time_sec.items()},
        gaps_to_ahead=gaps,
        weather_id=new_weather,
        weather_changed=weather_changed,
        safety_car_laps_remaining=out_sc,
        safety_car_just_ended=safety_car_just_ended,
    )
