# Rebuild the desktop control panel.
# Requires Windows' built-in .NET Framework compiler (Windows 10/11).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
  throw 'The .NET Framework C# compiler (csc.exe) was not found.'
}

& $csc /nologo /target:winexe /out:"$root\STREETO Control.exe" `
  /reference:System.dll `
  /reference:System.Core.dll `
  /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll `
  /reference:System.Security.dll `
  "$root\STREETO-Control.cs"

if ($LASTEXITCODE -ne 0) { throw "The control panel did not compile (exit $LASTEXITCODE)." }
Write-Host "Built $root\STREETO Control.exe" -ForegroundColor Green
