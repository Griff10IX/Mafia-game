# Push updates (go live)

## On your PC (after making code changes)

**Easiest:** double-click **`push-live.bat`**  
- Commits all changes with message "Update" and pushes to both repos.

**With a custom message:** in terminal:
```powershell
.\push-live.bat "Fixed families page"
```
or
```powershell
.\push-live.ps1 "Fixed families page"
```

**Manual (if you prefer):**
```powershell
git add -A
git commit -m "Your message"
git push origin MAfiaGame2
git push mafia2 MAfiaGame2
```

---

## On the server (to deploy the new code)

SSH into the server, then:

```bash
cd /opt/mafia-app
git fetch origin
git reset --hard origin/MAfiaGame2
npm run build
```

Then restart your app/server if needed so it serves the new `build` folder.
