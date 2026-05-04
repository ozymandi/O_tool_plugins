[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSCommandPath
Write-Host "[O'Tool] Project root: $projectRoot"

$pluginDirs = Get-ChildItem -Directory -LiteralPath $projectRoot |
    Where-Object { $_.Name -like "O'*" } |
    Sort-Object Name

$removed = 0

foreach ($dir in $pluginDirs) {
    $script = Join-Path $dir.FullName "uninstall.ps1"
    if (-not (Test-Path -LiteralPath $script)) { continue }
    Write-Host ""
    Write-Host "[O'Tool] >>> Uninstalling $($dir.Name)" -ForegroundColor Cyan
    try {
        & $script
        $removed++
    } catch {
        Write-Host "[O'Tool] FAILED on $($dir.Name): $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "[O'Tool] ============================================" -ForegroundColor Green
Write-Host "[O'Tool] Removed $removed plugin(s)." -ForegroundColor Green
Write-Host "[O'Tool] ============================================" -ForegroundColor Green
