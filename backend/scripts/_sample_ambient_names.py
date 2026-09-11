code = open("/opt/mafia-app/backend/scripts/_ambient_roster_daily.py").read().split("COUNTRY_PROFILES")[0]
ns = {}
exec(code, ns)
print("samples:")
for _ in range(20):
    name, group = ns["_rand_username"]()
    print(f"  [{group}] {name}")
