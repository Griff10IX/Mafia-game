# Commit, push to Git (both remotes), then deploy on server
# Usage: .\push-live.ps1
#        .\push-live.ps1 "Your commit message here"

param(
    [Parameter(Position = 0)]
    [string]$Message = "Update"
)

# ======= CONFIGURATION =======
# Set your SSH password here (requires sshpass to be installed: choco install sshpass)
# Leave empty to use SSH key authentication (recommended)
$SSH_PASSWORD = ""
# =============================

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Mafia: commit, push Git, deploy ===" -ForegroundColor Cyan

# 1. Show status
Write-Host "`n1. Checking for changes..." -ForegroundColor Yellow
$status = git status --short
if (-not $status) {
    Write-Host "   No changes to commit. Working tree clean." -ForegroundColor Gray
} else {
    Write-Host $status
    Write-Host "`n2. Staging all changes..." -ForegroundColor Yellow
    git add -A
    Write-Host "`n3. Committing: $Message" -ForegroundColor Yellow
    git commit -m $Message
}

# 4. Push to Git (both remotes)
Write-Host "`n4. Push to Git: origin (Mafia-game)..." -ForegroundColor Yellow
git push origin MAfiaGame2
Write-Host "`n5. Push to Git: mafia2 (Mafia-Game-2)..." -ForegroundColor Yellow
git push mafia2 MAfiaGame2

# 6. Deploy on server (SSH)
Write-Host "`n6. Deploying on server (SSH)..." -ForegroundColor Yellow
$sshCommand = "cd /opt/mafia-app && ([ -f backend/.env ] && cp backend/.env /tmp/env-backup); git fetch origin && git reset --hard origin/MAfiaGame2 && ([ -f /tmp/env-backup ] && cp /tmp/env-backup backend/.env); npm run build && sudo systemctl restart mafia-backend && sudo systemctl reload nginx"
if ($SSH_PASSWORD) {
    sshpass -p $SSH_PASSWORD ssh root@178.128.38.68 $sshCommand
} else {
    ssh root@178.128.38.68 $sshCommand
}

Write-Host "`n=== Done - pushed and deployed ===" -ForegroundColor Green
