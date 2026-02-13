# Push updates to both repos and go live
# Usage: .\push-live.ps1
#        .\push-live.ps1 "Your commit message here"

param(
    [Parameter(Position = 0)]
    [string]$Message = "Update"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Mafia push live ===" -ForegroundColor Cyan

# 1. Show status
Write-Host "`n1. Checking for changes..." -ForegroundColor Yellow
$status = git status --short
if (-not $status) {
    Write-Host "   No changes to commit. Working tree clean." -ForegroundColor Gray
    $pushOnly = $true
} else {
    Write-Host $status
    # 2. Add all
    Write-Host "`n2. Staging all changes..." -ForegroundColor Yellow
    git add -A
    # 3. Commit
    Write-Host "`n3. Committing: $Message" -ForegroundColor Yellow
    git commit -m $Message
    $pushOnly = $false
}

# 4. Push to both remotes
Write-Host "`n4. Pushing to origin (Mafia-game)..." -ForegroundColor Yellow
git push origin MAfiaGame2
Write-Host "`n5. Pushing to mafia2 (Mafia-Game-2 - server)..." -ForegroundColor Yellow
git push mafia2 MAfiaGame2

# 6. Deploy on server (SSH)
Write-Host "`n6. Deploying on server (SSH)..." -ForegroundColor Yellow
ssh root@178.128.38.68 "cd /opt/mafia-app && ([ -f backend/.env ] && cp backend/.env /tmp/env-backup); git fetch origin && git reset --hard origin/MAfiaGame2 && ([ -f /tmp/env-backup ] && cp /tmp/env-backup backend/.env); npm run build && sudo systemctl restart mafia-backend && sudo systemctl reload nginx"

Write-Host "`n=== Done - pushed and deployed ===" -ForegroundColor Green
