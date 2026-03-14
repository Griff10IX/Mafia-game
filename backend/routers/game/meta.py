# Meta endpoints: ranks list, cars list (reference data)
from fastapi import Depends

from server import get_current_user, RANKS, CARS


async def get_meta_ranks(current_user: dict = Depends(get_current_user)):
    return {"ranks": [{"id": int(r["id"]), "name": r["name"]} for r in RANKS]}


async def get_meta_cars(current_user: dict = Depends(get_current_user)):
    return {"cars": [{"id": c["id"], "name": c["name"], "rarity": c.get("rarity")} for c in CARS]}


def register(router):
    router.add_api_route("/meta/ranks", get_meta_ranks, methods=["GET"])
    router.add_api_route("/meta/cars", get_meta_cars, methods=["GET"])
