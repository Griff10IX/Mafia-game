# Full project backup to Desktop (excludes node_modules and large caches to avoid path length errors)
$date = Get-Date -Format "yyyy-MM-dd_HH-mm"
$desk = [Environment]::GetFolderPath('Desktop')
$dest = Join-Path $desk ("Game files mafia backup $date")
$src = $PSScriptRoot

New-Item -ItemType Directory -Path $dest -Force | Out-Null

$exclude = @('node_modules', '.git', '__pycache__', '.cache', 'dist', 'build')
$include = @('backend', 'src', 'public', 'package.json', 'package-lock.json', 'README.md', 'MISSIONS_PLAN.md', '.env.example')

foreach ($item in $include) {
    $full = Join-Path $src $item
    if (Test-Path $full) {
        $target = Join-Path $dest $item
        if (Test-Path $target) { Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue }
        Copy-Item -Path $full -Destination $target -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Output "Backup created: $dest (backend, src, public, root config - no node_modules)"
Write-Output "Run from project root: .\backup_to_desktop.ps1"
