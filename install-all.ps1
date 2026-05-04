[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$EnableDebugMode = $true
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSCommandPath
Write-Host "[O'Tool] Project root: $projectRoot"

# Find every sibling folder named O'... that has its own install.ps1
$pluginDirs = Get-ChildItem -Directory -LiteralPath $projectRoot |
    Where-Object { $_.Name -like "O'*" } |
    Sort-Object Name

$installed = 0
$failed = @()

foreach ($dir in $pluginDirs) {
    $script = Join-Path $dir.FullName "install.ps1"
    if (-not (Test-Path -LiteralPath $script)) {
        Write-Host "[O'Tool] Skipping $($dir.Name) — no install.ps1"
        continue
    }
    Write-Host ""
    Write-Host "[O'Tool] >>> Installing $($dir.Name)" -ForegroundColor Cyan
    try {
        if ($EnableDebugMode) {
            & $script -EnableDebugMode
        } else {
            & $script
        }
        $installed++
    } catch {
        Write-Host "[O'Tool] FAILED: $($dir.Name) — $($_.Exception.Message)" -ForegroundColor Red
        $failed += $dir.Name
    }
}

Write-Host ""
Write-Host "[O'Tool] ============================================" -ForegroundColor Green
Write-Host "[O'Tool] Installed $installed plugin(s)." -ForegroundColor Green
if ($failed.Count -gt 0) {
    Write-Host "[O'Tool] Failed: $($failed -join ', ')" -ForegroundColor Yellow
}
Write-Host "[O'Tool] Restart Illustrator (or close + reopen panels) to see changes." -ForegroundColor Green
Write-Host "[O'Tool] Open the hub: Window > Extensions > O'Hub" -ForegroundColor Green
Write-Host "[O'Tool] ============================================" -ForegroundColor Green
