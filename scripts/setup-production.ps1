<#
  Run the production setup with administrator rights.

  The real work lives in scripts/go-live.mjs - this script only makes sure
  it runs elevated, because registering a Windows service and a scheduled
  task needs it. Right-click > "Run with PowerShell" or:

      powershell -ExecutionPolicy Bypass -File scripts\setup-production.ps1

  If the window is not already elevated it re-launches itself as
  administrator.
#>

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$script = Join-Path $project 'scripts\go-live.mjs'

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host 'Administrator rights are needed - re-launching elevated...' -ForegroundColor Yellow
  Start-Process powershell.exe -Verb RunAs -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`""
  )
  return
}

Set-Location $project
Write-Host 'Running the production setup...' -ForegroundColor Cyan
& node $script runtime
$code = $LASTEXITCODE

if ($code -eq 0) {
  Write-Host ''
  Write-Host 'Done. The site is served from https://streeto.net.' -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host 'Something did not work - the output above says what.' -ForegroundColor Red
}
exit $code
