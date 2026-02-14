# Mafia Game – Backend

FastAPI backend for the Mafia game. API is mounted at `/api`.

## Structure

```
backend/
├── server.py          # Main app: config, DB, auth, middleware, most routes
├── routers/           # Modular route groups (included by server.py)
│   ├── __init__.py
│   ├── crimes.py      # /api/crimes, commit crime
│   ├── gta.py         # /api/gta/* (options, attempt, garage, melt)
│   ├── jail.py        # /api/jail/* (players, bust)
│   ├── oc.py          # /api/oc/* (organised crime heists)
│   ├── hitlist.py     # /api/hitlist/* (bounties, buy off, reveal, NPCs)
│   ├── meta.py        # /api/meta/ranks, /api/meta/cars
│   ├── weapons.py     # /api/weapons/* (list, equip, unequip, buy, sell)
│   └── armour.py      # /api/armour/* (options, buy, equip, unequip, sell)
├── requirements.txt
├── .env               # MONGO_URL, DB_NAME, JWT_SECRET_KEY, CORS_ORIGINS, etc.
└── README.md          # This file
```

## How routers work

- **server.py** defines `api_router` (prefix `/api`), shared dependencies (`get_current_user`), DB (`db`), and helpers (`send_notification`, `get_rank_info`, etc.).
- Each router in **routers/** imports what it needs from `server` and exposes a `register(router)` that calls `router.add_api_route(...)` for its endpoints.
- At the bottom of **server.py**, routers are imported and registered: `hitlist.register(api_router)` etc. So all hitlist routes live under `/api/hitlist/*`.

## Running

From the `backend` directory:

```bash
pip install -r requirements.txt
# Set .env (MONGO_URL, DB_NAME, JWT_SECRET_KEY, etc.)
uvicorn server:app --reload
```

API root: `http://localhost:8000/`  
Docs: `http://localhost:8000/docs`

## Adding a new router

1. Create `routers/myfeature.py` with endpoints and `def register(router): ...`.
2. In `server.py`: `from routers import myfeature` and `myfeature.register(api_router)`.
3. In `routers/__init__.py`: add `myfeature` to imports and `__all__`.
