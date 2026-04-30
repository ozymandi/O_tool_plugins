[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ExtensionName = "OTrim",
    [string]$DestinationRoot = (Join-Path $env:APPDATA "Adobe\CEP\extensions")
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[OTrim] $Message"
}

$destinationPath = Join-Path $DestinationRoot $ExtensionName

Write-Step "CEP destination: $destinationPath"

if (-not (Test-Path -LiteralPath $destinationPath)) {
    Write-Step "Nothing to remove."
    return
}

if ($PSCmdlet.ShouldProcess($destinationPath, "Remove CEP extension")) {
    Remove-Item -LiteralPath $destinationPath -Recurse -Force
    Write-Step "Uninstall complete."
}
