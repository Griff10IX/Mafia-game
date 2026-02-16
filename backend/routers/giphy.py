# Giphy: proxy GIF search (API key from backend .env)
import os

import httpx
from fastapi import Depends, HTTPException, Query


def register(router):
    """Register giphy routes. Dependencies from server to avoid circular imports."""
    import server as srv

    get_current_user = srv.get_current_user

    @router.get("/giphy/search")
    async def giphy_search(
        q: str = Query(..., min_length=1, max_length=50),
        current_user: dict = Depends(get_current_user),
    ):
        """Proxy Giphy GIF search. API key is read from backend .env (GIPHY_API_KEY)."""
        api_key = (os.environ.get("GIPHY_API_KEY") or "").strip()
        if not api_key:
            raise HTTPException(
                status_code=503,
                detail="Giphy not configured. Add GIPHY_API_KEY to backend/.env and restart the backend.",
            )
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://api.giphy.com/v1/gifs/search",
                params={
                    "api_key": api_key,
                    "q": q,
                    "limit": 20,
                    "rating": "pg-13",
                },
            )
        data = resp.json()
        if data.get("meta", {}).get("status") != 200:
            raise HTTPException(
                status_code=502,
                detail=data.get("meta", {}).get("msg") or "Giphy error",
            )
        return {"data": data.get("data") or []}
