param(
  [string]$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$OpenCodeConfigRoot = "$HOME\.config\opencode"
)

$ErrorActionPreference = "Stop"

$pluginRoot   = Join-Path $RepoRoot "plugins\huaweicloud-core"
$integRoot    = Join-Path $RepoRoot "integrations\opencode"
$targetBase   = Join-Path $OpenCodeConfigRoot "huaweicloud-plugins"

$map = @{
  "skills"     = @{ src = "$pluginRoot\skills";              dst = "$OpenCodeConfigRoot\skills" }
  "commands"   = @{ src = "$integRoot\commands";             dst = "$OpenCodeConfigRoot\commands" }
  "src"        = @{ src = "$pluginRoot\src";                 dst = "$targetBase\src" }
  "safety"     = @{ src = "$pluginRoot\safety";              dst = "$targetBase\safety" }
}

foreach ($entry in $map.GetEnumerator()) {
  $name   = $entry.Key
  $srcDir = $entry.Value.src
  $dstDir = $entry.Value.dst

  New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
  Copy-Item -Recurse -Force -Path "$srcDir\*" -Destination $dstDir
  Write-Host "Synced $name -> $dstDir"
}

# skill-tracker.js hook file
$hookSrc = Join-Path $integRoot "hooks\skill-tracker.js"
$pluginDst = Join-Path $OpenCodeConfigRoot "plugins"
New-Item -ItemType Directory -Force -Path $pluginDst | Out-Null
Copy-Item -LiteralPath $hookSrc -Destination (Join-Path $pluginDst "skill-tracker.js") -Force
Write-Host "Synced hook skill-tracker.js -> $pluginDst\skill-tracker.js"

Write-Host ""
Write-Host "Sync complete."