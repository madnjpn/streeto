@echo off
setlocal EnableExtensions EnableDelayedExpansion
title STREETO - streeto.net

rem ---------------------------------------------------------------------------
rem  Starts the two things the live site needs:
rem
rem    1. the cloudflared connector  - carries the Cloudflare Tunnel
rem    2. the STREETO server         - the app itself, on https://localhost:443
rem
rem  Both run in the foreground, so closing this window stops the site.
rem  The tunnel gets its own window so you can see its connections.
rem
rem  Double-click this file, or run it from a terminal.
rem ---------------------------------------------------------------------------

cd /d "%~dp0"
set "PROJECT=%CD%"

echo.
echo   ==========================================================
echo      STREETO  -  streeto.net
echo   ==========================================================
echo.

rem --- 1. node ---------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo   [x] Node.js was not found in PATH.
  echo       Install Node.js 22.5 or newer from https://nodejs.org
  echo       and run this file again.
  echo.
  pause
  exit /b 1
)

rem --- 2. dependencies -------------------------------------------------------
if not exist "%PROJECT%\node_modules\express" (
  echo   [.] Installing dependencies, this takes a minute...
  call npm install --omit=dev
  if errorlevel 1 (
    echo   [x] npm install failed.
    pause
    exit /b 1
  )
)

rem --- 3. the production environment -----------------------------------------
if not exist "%PROJECT%\.env.production" (
  echo   [x] .env.production is missing.
  echo       Run:  npm run golive
  echo.
  pause
  exit /b 1
)

rem --- 4. the tunnel token ---------------------------------------------------
set "TUNNEL_TOKEN="
for /f "usebackq tokens=1,* delims==" %%A in (".env.production") do (
  if "%%A"=="CF_TUNNEL_TOKEN" set "TUNNEL_TOKEN=%%B"
)
if not defined TUNNEL_TOKEN (
  rem Fall back to the token the Windows service was installed with.
  for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "$p = (Get-CimInstance Win32_Service -Filter \"Name='Cloudflared'\").PathName; if ($p -match '--token\s+(\S+)') { $Matches[1] }"`) do (
    set "TUNNEL_TOKEN=%%T"
  )
)
if not defined TUNNEL_TOKEN (
  echo   [x] No tunnel token found.
  echo       Run:  npm run golive
  echo.
  pause
  exit /b 1
)

rem --- 5. cloudflared --------------------------------------------------------
set "CLOUDFLARED="
if exist "%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe" set "CLOUDFLARED=%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe"
if not defined CLOUDFLARED if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CLOUDFLARED=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not defined CLOUDFLARED if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CLOUDFLARED=%ProgramFiles%\cloudflared\cloudflared.exe"
if not defined CLOUDFLARED (
  echo   [.] Downloading cloudflared...
  if not exist "%LOCALAPPDATA%\Programs\cloudflared" mkdir "%LOCALAPPDATA%\Programs\cloudflared"
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe' -UseBasicParsing"
  if exist "%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe" set "CLOUDFPDIR=%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe"
  if exist "%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe" set "CLOUDFLARED=%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe"
)
if not defined CLOUDFLARED (
  echo   [x] Could not download cloudflared.
  echo.
  pause
  exit /b 1
)

rem --- 6. free port 443 ------------------------------------------------------
set "OLDPID="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"`) do (
  if not "%%P"=="" set "OLDPID=%%P"
)
if defined OLDPID (
  set "CMDLINE="
  for /f "usebackq delims=" %%C in (`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=!OLDPID!').CommandLine"`) do (
    set "CMDLINE=%%C"
  )
  echo !CMDLINE! | findstr /i "server.js" >nul && (
    echo   [.] Stopping the server that is already using port 443 ^(pid !OLDPID!^)
    taskkill /pid !OLDPID! /f >nul 2>&1
    timeout /t 2 /nobreak >nul
  )
  if not "!CMDLINE!"=="" (
    echo !CMDLINE! | findstr /i "server.js" >nul || (
      echo   [x] Port 443 is used by another program ^(pid !OLDPID!^).
      echo       Close it and run this file again.
      echo.
      pause
      exit /b 1
    )
  )
)

rem --- 7. the tunnel ---------------------------------------------------------
tasklist /fi "IMAGENAME eq cloudflared.exe" 2>nul | find /i "cloudflared.exe" >nul
if not errorlevel 1 (
  echo   [.] A cloudflared connector is already running.
) else (
  echo   [.] Starting the Cloudflare Tunnel...
  rem Start-Process detaches cleanly - cmd's "start" trips over a redirected
  rem stdin, which is exactly what happens when this file is run from a
  rem pipeline or a terminal that pipes its output.
  rem One line only: a " ^" continuation inside this if/else block would be
  rem parsed as part of the block and break the command.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%CLOUDFLARED%' -ArgumentList 'tunnel','--no-autoupdate','run','--token','!TUNNEL_TOKEN!' -WindowStyle Minimized"
  timeout /t 5 /nobreak >nul
)

rem --- 8. the app -----------------------------------------------------------
echo   [.] Starting the STREETO server on https://localhost:443
echo.
echo   ==========================================================
echo      Live at   https://streeto.net
echo      Local at  https://localhost:443
echo   ==========================================================
echo.
echo   Press Ctrl+C to stop the server. The tunnel keeps running
echo   in its own window - close that window to stop it as well.
echo.

node --env-file="%PROJECT%\.env.production" "%PROJECT%\server.js"

echo.
echo   The server stopped.
timeout /t 5 /nobreak >nul
endlocal
