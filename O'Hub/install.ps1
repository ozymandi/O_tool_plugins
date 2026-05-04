[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ExtensionName = "OHub",
    [string]$DestinationRoot = (Join-Path $env:APPDATA "Adobe\CEP\extensions"),
    [switch]$EnableDebugMode
)

$ErrorActionPreference = "Stop"

function Write-Step { param([string]$Message) Write-Host "[OHub] $Message" }
function Get-ProjectRoot { return Split-Path -Parent $PSCommandPath }
function Get-DestinationPath { param([string]$Root, [string]$Name) return Join-Path $Root $Name }

function Install-ExtensionFiles {
    param([string]$ProjectRoot, [string]$DestinationPath)
    if (-not (Test-Path -LiteralPath $DestinationPath)) {
        Write-Step "Creating $DestinationPath"
        New-Item -ItemType Directory -Path $DestinationPath -Force | Out-Null
    }
    $items = Get-ChildItem -LiteralPath $ProjectRoot -Force | Where-Object {
        $_.Name -notin @(".git", ".gitignore", ".vscode", "dist")
    }
    foreach ($item in $items) {
        $target = Join-Path $DestinationPath $item.Name
        if ($item.PSIsContainer) {
            if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
            Copy-Item -LiteralPath $item.FullName -Destination $target -Recurse -Force
            continue
        }
        Copy-Item -LiteralPath $item.FullName -Destination $target -Force
    }
}

function Enable-CepDebugMode {
    $adobeKey = "HKCU:\Software\Adobe"
    $csxsKeys = @()
    if (Test-Path -LiteralPath $adobeKey) {
        $csxsKeys = Get-ChildItem -LiteralPath $adobeKey | Where-Object { $_.PSChildName -match "^CSXS\.\d+$" }
    }
    if ($csxsKeys.Count -eq 0) {
        $fallback = Join-Path $adobeKey "CSXS.12"
        Write-Step "No CSXS keys found. Creating fallback key $fallback"
        if (-not (Test-Path -LiteralPath $fallback)) { New-Item -Path $fallback -Force | Out-Null }
        $csxsKeys = @(Get-Item -LiteralPath $fallback)
    }
    foreach ($key in $csxsKeys) {
        Write-Step "Enabling PlayerDebugMode in $($key.PSChildName)"
        New-ItemProperty -Path $key.PSPath -Name "PlayerDebugMode" -Value "1" -PropertyType String -Force | Out-Null
    }
}

$projectRoot = Get-ProjectRoot
$destinationPath = Get-DestinationPath -Root $DestinationRoot -Name $ExtensionName

Write-Step "Project root: $projectRoot"
Write-Step "CEP destination: $destinationPath"

if ($PSCmdlet.ShouldProcess($destinationPath, "Install CEP extension")) {
    if (-not (Test-Path -LiteralPath $DestinationRoot)) {
        Write-Step "Creating CEP root folder $DestinationRoot"
        New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
    }
    Install-ExtensionFiles -ProjectRoot $projectRoot -DestinationPath $destinationPath
    if ($EnableDebugMode) { Enable-CepDebugMode }
    Write-Step "Install complete."
}
