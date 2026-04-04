from typing import List


def player_can_act(p: dict) -> bool:
    return (p or {}).get("status") not in ("folded", "all_in", "busted")


def next_actionable_index(players: List[dict], start_idx: int) -> int:
    n = len(players or [])
    if n <= 0:
        return -1
    idx = start_idx % n
    for _ in range(n):
        if player_can_act(players[idx]):
            return idx
        idx = (idx + 1) % n
    return start_idx % n


def is_betting_round_complete(players: List[dict]) -> bool:
    if not players:
        return True
    max_bet = max(int(x.get("current_bet") or 0) for x in players)
    for p in players:
        status = (p or {}).get("status")
        if status in ("folded", "all_in", "busted"):
            continue
        if not bool(p.get("acted_this_street")):
            return False
        if int(p.get("current_bet") or 0) != max_bet:
            return False
    return True


def reset_acted_this_street_for_raise(players: List[dict], actor_index: int) -> None:
    for i, other in enumerate(players):
        if i == actor_index:
            continue
        if player_can_act(other):
            other["acted_this_street"] = False


def tournament_survivors(players: List[dict]) -> List[dict]:
    return [p for p in (players or []) if int(p.get("stack") or 0) > 0]
