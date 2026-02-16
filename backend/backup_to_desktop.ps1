$d = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$desk = [Environment]::GetFolderPath('Desktop')
$dest = Join-Path $desk ("Game files mafia backend backup " + $d)
$backend = Split-Path $PSScriptRoot -Parent | Join-Path -ChildPath "backend"
Copy-Item -Path $backend -Destination $dest -Recurse -Force
Write-Output "Backup created: $dest"
