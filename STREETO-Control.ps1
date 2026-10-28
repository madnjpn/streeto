# STREETO Control
# One window for the live server and the Cloudflare Tunnel.
# Double-click "STREETO Control.vbs" to open it without a command prompt.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path $node)) {
  [System.Windows.Forms.MessageBox]::Show('Node.js was not found. Install Node.js 22.5 or newer.', 'STREETO Control') | Out-Null
  exit 1
}

# Services and scheduled tasks need administrator rights.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', "`"$PSCommandPath`""
  ) | Out-Null
  exit
}

$dark = [Drawing.Color]::FromArgb(8, 10, 15)
$panel = [Drawing.Color]::FromArgb(17, 21, 29)
$line = [Drawing.Color]::FromArgb(42, 49, 63)
$text = [Drawing.Color]::FromArgb(242, 246, 250)
$muted = [Drawing.Color]::FromArgb(145, 156, 174)
$neon = [Drawing.Color]::FromArgb(31, 224, 255)
$green = [Drawing.Color]::FromArgb(61, 220, 151)
$red = [Drawing.Color]::FromArgb(255, 91, 108)
$amber = [Drawing.Color]::FromArgb(255, 190, 72)

$font = New-Object Drawing.Font('Segoe UI', 9)
$fontSmall = New-Object Drawing.Font('Segoe UI', 8.5)
$fontTitle = New-Object Drawing.Font('Segoe UI', 18, [Drawing.FontStyle]::Bold)
$fontMono = New-Object Drawing.Font('Consolas', 8.5)

$form = New-Object Windows.Forms.Form
$form.Text = 'STREETO Control'
$form.ClientSize = New-Object Drawing.Size(760, 560)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.BackColor = $dark
$form.ForeColor = $text
$form.Font = $font

$title = New-Object Windows.Forms.Label
$title.Text = 'STREETO'
$title.Font = $fontTitle
$title.ForeColor = $neon
$title.Location = New-Object Drawing.Point(24, 18)
$title.AutoSize = $true
$form.Controls.Add($title)

$subtitle = New-Object Windows.Forms.Label
$subtitle.Text = 'Server and Cloudflare Tunnel control'
$subtitle.Font = $fontSmall
$subtitle.ForeColor = $muted
$subtitle.Location = New-Object Drawing.Point(27, 52)
$subtitle.AutoSize = $true
$form.Controls.Add($subtitle)

function New-StatusLabel($top, $caption) {
  $label = New-Object Windows.Forms.Label
  $label.Text = $caption
  $label.Location = New-Object Drawing.Point(28, $top)
  $label.Size = New-Object Drawing.Size(140, 24)
  $label.ForeColor = $muted
  $form.Controls.Add($label)

  $value = New-Object Windows.Forms.Label
  $value.Text = 'Checking...'
  $value.Location = New-Object Drawing.Point(172, $top)
  $value.Size = New-Object Drawing.Size(540, 24)
  $value.ForeColor = $text
  $form.Controls.Add($value)
  return $value
}

$serverStatus = New-StatusLabel 92 'Web server'
$tunnelStatus = New-StatusLabel 120 'Cloudflare Tunnel'
$localStatus = New-StatusLabel 148 'Local HTTPS (443)'
$publicStatus = New-StatusLabel 176 'Public site'

$rule = New-Object Windows.Forms.Panel
$rule.Location = New-Object Drawing.Point(24, 212)
$rule.Size = New-Object Drawing.Size(712, 1)
$rule.BackColor = $line
$form.Controls.Add($rule)

$buttons = @(
  @{ Text = 'Install / Repair'; X = 24; Action = 'install'; Primary = $true },
  @{ Text = 'Start'; X = 166; Action = 'start'; Primary = $false },
  @{ Text = 'Stop'; X = 252; Action = 'stop'; Primary = $false },
  @{ Text = 'Restart'; X = 338; Action = 'restart'; Primary = $false },
  @{ Text = 'Open site'; X = 438; Action = 'open'; Primary = $false },
  @{ Text = 'Logs'; X = 538; Action = 'logs'; Primary = $false },
  @{ Text = 'Refresh'; X = 624; Action = 'refresh'; Primary = $false }
)

$buttonMap = @{}
foreach ($spec in $buttons) {
  $button = New-Object Windows.Forms.Button
  $button.Text = $spec.Text
  $button.Location = New-Object Drawing.Point($spec.X, 230)
  $button.Size = New-Object Drawing.Size($(if ($spec.Action -eq 'install') { 130 } else { 82 }), 32)
  $button.FlatStyle = 'Flat'
  $button.FlatAppearance.BorderSize = 1
  $button.FlatAppearance.BorderColor = $line
  $button.BackColor = $panel
  $button.ForeColor = $text
  $button.Cursor = [Windows.Forms.Cursors]::Hand
  if ($spec.Primary) {
    $button.BackColor = $neon
    $button.ForeColor = [Drawing.Color]::FromArgb(4, 18, 26)
    $button.FlatAppearance.BorderColor = $neon
  }
  $button.Tag = $spec.Action
  $form.Controls.Add($button)
  $buttonMap[$spec.Action] = $button
}

$logLabel = New-Object Windows.Forms.Label
$logLabel.Text = 'Activity'
$logLabel.Location = New-Object Drawing.Point(24, 282)
$logLabel.Size = New-Object Drawing.Size(100, 20)
$logLabel.ForeColor = $muted
$logLabel.Font = $fontSmall
$form.Controls.Add($logLabel)

$logBox = New-Object Windows.Forms.TextBox
$logBox.Location = New-Object Drawing.Point(24, 304)
$logBox.Size = New-Object Drawing.Size(712, 210)
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = 'Vertical'
$logBox.BackColor = [Drawing.Color]::FromArgb(4, 6, 10)
$logBox.ForeColor = [Drawing.Color]::FromArgb(190, 205, 220)
$logBox.BorderStyle = 'FixedSingle'
$logBox.Font = $fontMono
$form.Controls.Add($logBox)

$footer = New-Object Windows.Forms.Label
$footer.Text = 'Services keep running when this window is closed.'
$footer.Location = New-Object Drawing.Point(24, 526)
$footer.Size = New-Object Drawing.Size(500, 20)
$footer.ForeColor = $muted
$footer.Font = $fontSmall
$form.Controls.Add($footer)

function Append-Activity([string]$message) {
  if (-not $message) { return }
  $stamp = (Get-Date).ToString('HH:mm:ss')
  $logBox.AppendText("[$stamp] $message`r`n")
}

function Invoke-Control([string]$command, [switch]$AsJson) {
  $arguments = "`"$root\scripts\service-control.mjs`" $command"
  if ($AsJson) { $arguments += ' --json' }

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $node
  $startInfo.Arguments = $arguments
  $startInfo.WorkingDirectory = $root
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
  $startInfo.StandardErrorEncoding = [Text.Encoding]::UTF8

  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  [void]$process.Start()
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  while (-not $process.HasExited) {
    [Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 100
  }
  $out = $stdout.Result.Trim()
  $err = $stderr.Result.Trim()
  $code = $process.ExitCode
  $process.Dispose()

  if ($code -ne 0) {
    $detail = if ($err) { $err } else { $out }
    throw ($detail -replace '\s+', ' ')
  }
  return $out
}

function Set-StateLabel($label, [string]$state, [string]$detail = '') {
  $value = ($state + ' ' + $detail).Trim()
  $label.Text = $value
  if ($state -match '^(running|ready|ok|listening|installed)$') { $label.ForeColor = $green }
  elseif ($state -match '^(stopped|down|missing|not installed|free)$') { $label.ForeColor = $red }
  else { $label.ForeColor = $amber }
}

function Refresh-Status {
  try {
    $raw = Invoke-Control 'status' -AsJson
    if (-not $raw) { throw 'The service controller returned no status.' }
    $status = $raw | ConvertFrom-Json
    $appInstalled = [bool]$status.services.app.installed
    $tunnelInstalled = [bool]$status.services.tunnel.installed

    Set-StateLabel $serverStatus $status.services.app.state $(if ($appInstalled) { '· installed' } else { '· not installed' })
    Set-StateLabel $tunnelStatus $status.services.tunnel.state $(if ($tunnelInstalled) { '· installed' } else { '· not installed' })
    Set-StateLabel $localStatus $status.local "· port 443 $($status.port443)"
    if ($status.public.health -eq 'ok') { Set-StateLabel $publicStatus 'ok' "· $($status.public.url)" }
    else { Set-StateLabel $publicStatus 'down' "· $($status.public.url)" }

    $buttonMap['install'].Text = if ($appInstalled -and $tunnelInstalled) { 'Repair services' } else { 'Install services' }
  } catch {
    Set-StateLabel $serverStatus 'unknown' '· status unavailable'
    Set-StateLabel $tunnelStatus 'unknown' ''
    Set-StateLabel $localStatus 'unknown' ''
    Set-StateLabel $publicStatus 'unknown' ''
    Append-Activity "Status check failed: $($_.Exception.Message)"
  }
}

function Run-Action([string]$action) {
  $buttonMap[$action].Enabled = $false
  try {
    if ($action -eq 'open') {
      Start-Process 'https://streeto.net'
      return
    }
    if ($action -eq 'logs') {
      $file = Join-Path $root 'data\logs\server.log'
      if (Test-Path $file) { Start-Process notepad.exe -ArgumentList "`"$file`"" }
      else { Append-Activity 'No service log yet. Start the services first.' }
      return
    }
    if ($action -eq 'refresh') {
      Refresh-Status
      return
    }

    $label = $buttonMap[$action].Text
    Append-Activity "$label requested. This can take a few seconds..."
    [Windows.Forms.Application]::DoEvents()
    $output = Invoke-Control $action
    if ($output) { Append-Activity $output }
    Refresh-Status
    Append-Activity 'Done.'
  } catch {
    Append-Activity "Failed: $($_.Exception.Message)"
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'STREETO Control', 'OK', 'Warning') | Out-Null
  } finally {
    $buttonMap[$action].Enabled = $true
  }
}

foreach ($key in @('install', 'start', 'stop', 'restart', 'open', 'logs', 'refresh')) {
  $buttonMap[$key].Add_Click({ param($sender, $eventArgs) Run-Action $sender.Tag })
}

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 12000
$timer.Add_Tick({ Refresh-Status })

$form.Add_Shown({
  Append-Activity 'Checking the services...'
  Refresh-Status
  $timer.Start()
})

$form.Add_FormClosed({
  $timer.Stop()
  $timer.Dispose()
})

[void]$form.ShowDialog()
