<# ci/bepp.ps1 — Windows helper to package extension for local dev/testing #>
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Path $MyInvocation.MyCommand.Path)
Push-Location $root

if (-not (Test-Path -Path dist)) { New-Item -ItemType Directory -Path dist | Out-Null }

$src = Join-Path $root 'extension'
$tmp = Join-Path $root '.tmp_build'
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Path $tmp | Out-Null
Copy-Item (Join-Path $src '*') $tmp -Recurse -Force

# Sanitize manifest.json for CI/production: remove localhost and 127.0.0.1 entries
$manifestPath = Join-Path $tmp 'manifest.json'
if (Test-Path $manifestPath) {
  Write-Host '[bepp.ps1] Sanitizing manifest for production (removing localhost/127.0.0.1 entries)'
  $m = Get-Content $manifestPath -Raw | ConvertFrom-Json
  if ($m.host_permissions) {
    $m.host_permissions = $m.host_permissions | Where-Object { $_ -notmatch 'localhost|127.0.0.1' }
  }
  if ($m.content_scripts) {
    foreach ($cs in $m.content_scripts) {
      if ($cs.matches) {
        $cs.matches = $cs.matches | Where-Object { ($_ -notmatch 'localhost|127.0.0.1') -and ($_ -ne '*://localhost/*') -and ($_ -ne '*://127.0.0.1/*') }
      }
    }
  }
  $m | ConvertTo-Json -Depth 10 | Set-Content -Path $manifestPath -Encoding UTF8
}
if (-not (Test-Path -Path $src)) { Write-Error 'extension/ directory not found'; exit 1 }

Write-Host '[bepp.ps1] Packaging webextension from extension/ as zip...'
$zipPath = Join-Path $root 'dist\citizen-hangar-webextension.zip'
if (Get-Command Compress-Archive -ErrorAction SilentlyContinue) {
  Remove-Item -Force -ErrorAction SilentlyContinue $zipPath
  Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $zipPath
  Write-Host "[bepp.ps1] webextension zip -> $zipPath"
} else { Write-Host '[bepp.ps1] Compress-Archive not available; skipping webextension zip.' }

Write-Host '[bepp.ps1] Creating per-browser copies for Chromium-family...'
Copy-Item $zipPath (Join-Path $root 'dist\citizen-hangar-chromium.zip') -Force -ErrorAction SilentlyContinue
Copy-Item $zipPath (Join-Path $root 'dist\citizen-hangar-chrome.zip') -Force -ErrorAction SilentlyContinue
Copy-Item $zipPath (Join-Path $root 'dist\citizen-hangar-brave.zip') -Force -ErrorAction SilentlyContinue
Copy-Item $zipPath (Join-Path $root 'dist\citizen-hangar-edge.zip') -Force -ErrorAction SilentlyContinue
Copy-Item $zipPath (Join-Path $root 'dist\citizen-hangar-opera.zip') -Force -ErrorAction SilentlyContinue
Copy-Item $zipPath (Join-Path $root 'dist\citizen-hangar-opera-gx.zip') -Force -ErrorAction SilentlyContinue
Copy-Item $zipPath (Join-Path $root 'dist\citizen-hangar-yandex.zip') -Force -ErrorAction SilentlyContinue

Write-Host '[bepp.ps1] Building Firefox XPI with web-ext (if available)'
if (Get-Command web-ext -ErrorAction SilentlyContinue) {
  web-ext build --source-dir $tmp --overwrite-dest --artifacts-dir "$root\dist"
  Write-Host '[bepp.ps1] web-ext build complete'
} else { Write-Host '[bepp.ps1] web-ext not found; install via npm install --global web-ext' }

Write-Host '[bepp.ps1] Safari packaging note: requires macOS/Xcode and Apple Developer account.'

if ($env:CHROME_PEM_BASE64) {
  Write-Host '[bepp.ps1] Decoding CHROME_PEM_BASE64 to chrome.pem'
  [System.IO.File]::WriteAllBytes("$root\chrome.pem", [System.Convert]::FromBase64String($env:CHROME_PEM_BASE64))
  Write-Host '[bepp.ps1] chrome.pem written'
}

if ($env:BEPP_API_KEY) {
  if (Get-Command bepp -ErrorAction SilentlyContinue) {
    Write-Host '[bepp.ps1] Running bepp publish (placeholder)'
    bepp publish --api-key $env:BEPP_API_KEY --artifacts "$root\dist" | Out-Null
  } else { Write-Host '[bepp.ps1] BEPP_API_KEY present but bepp CLI not installed.' }
}

Pop-Location
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
Pop-Location
