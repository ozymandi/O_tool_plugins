[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$SignToolPath,
    [Parameter(Mandatory = $true)] [string]$CertPath,
    [Parameter(Mandatory = $true)] [string]$CertPassword,
    [string]$OutputDir = '.\dist',
    [string]$TimestampUrl = '',
    [switch]$KeepStage
)

$ErrorActionPreference = 'Stop'

function Resolve-ExistingPath {
    param([Parameter(Mandatory = $true)][string]$PathValue)
    return (Resolve-Path -LiteralPath $PathValue).Path
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifestPath = Join-Path $projectRoot 'CSXS\manifest.xml'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Manifest not found at $manifestPath" }

[xml]$manifest = Get-Content -Raw -LiteralPath $manifestPath
$bundleVersion = $manifest.ExtensionManifest.ExtensionBundleVersion
$bundleId = $manifest.ExtensionManifest.ExtensionBundleId
$menuName = $manifest.ExtensionManifest.DispatchInfoList.Extension.DispatchInfo.UI.Menu

$signTool = Resolve-ExistingPath $SignToolPath
$certificate = Resolve-ExistingPath $CertPath

$outputRoot = Join-Path $projectRoot $OutputDir
$stageRoot = Join-Path $outputRoot 'stage'
$stageDir = Join-Path $stageRoot 'OFill'
$runtimeItems = @('CSXS', 'css', 'host', 'js', 'icons', 'index.html')

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

foreach ($item in $runtimeItems) {
    $source = Join-Path $projectRoot $item
    if (-not (Test-Path -LiteralPath $source)) { throw "Required runtime item missing: $source" }
    Copy-Item -LiteralPath $source -Destination $stageDir -Recurse -Force
}

$safeName = ($menuName -replace '[^A-Za-z0-9._-]', '')
if (-not $safeName) { $safeName = 'OFill' }

$zxpPath = Join-Path $outputRoot ('{0}-{1}.zxp' -f $safeName, $bundleVersion)
if (Test-Path -LiteralPath $zxpPath) { Remove-Item -LiteralPath $zxpPath -Force }

$signArgs = @('-sign', $stageDir, $zxpPath, $certificate, $CertPassword)
if ($TimestampUrl) { $signArgs += @('-tsa', $TimestampUrl) }

Write-Host ('[OFill] Building signed package: {0}' -f $zxpPath)
& $signTool @signArgs

if (-not (Test-Path -LiteralPath $zxpPath)) { throw "ZXPSignCmd did not produce $zxpPath" }
if (-not $KeepStage) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }

Write-Host '[OFill] ZXP build complete.'
Write-Host ('[OFill] Output: {0}' -f $zxpPath)
