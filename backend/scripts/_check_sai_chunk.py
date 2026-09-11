from pathlib import Path
import json
m = json.loads(Path("/opt/mafia-app/build/asset-manifest.json").read_text())
files = m.get("files") or {}
for k, v in files.items():
    if "121" in k or "system" in k.lower() or "AdminSystem" in k:
        print(k, "->", v)
# chunk map in runtime
main = Path("/opt/mafia-app/build/static/js")
for p in main.glob("main.*.js"):
    t = p.read_text(errors="ignore")
    idx = t.find("system-ai-reports")
    if idx >= 0:
        print("main", p.name, "ctx", t[idx - 60 : idx + 100])
