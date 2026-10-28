# Copy the machine's Node and cloudflared into the project so the whole
# STREETO folder can be moved to another Windows server.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$nodeDir = Join-Path $root 'runtime\node'
$cfDir = Join-Path $root 'runtime\cloudflared'
New-Item -ItemType Directory -Force -Path $nodeDir, $cfDir | Out-Null

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
}
if (-not (Test-Path $node)) { throw 'Node.js was not found.' }
Copy-Item $node (Join-Path $nodeDir 'node.exe') -Force
Write-Host "Node copied to $nodeDir\node.exe"

$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\cloudflared\cloudflared.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'),
  (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe')
)
$cloudflared = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $cloudflared) { throw 'cloudflared.exe was not found.' }
Copy-Item $cloudflared (Join-Path $cfDir 'cloudflared.exe') -Force
Write-Host "cloudflared copied to $cfDir\cloudflared.exe"
