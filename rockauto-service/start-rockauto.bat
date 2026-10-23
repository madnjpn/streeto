@echo off
REM RockAuto Service Startup Script for Windows
REM ============================================
REM This script starts the RockAuto microservice alongside the STREETO Node.js app
REM Uses portable Python environment in python-portable/ folder

cd /d "%~dp0"

echo ============================================================
echo  STREETO RockAuto Service
echo ============================================================
echo.

REM Use portable Python environment
set PORTABLE_PYTHON=%~dp0python-portable\Scripts\python.exe
set PORTABLE_PIP=%~dp0python-portable\Scripts\pip.exe

if not exist "%PORTABLE_PYTHON%" (
    echo [x] Portable Python not found at %PORTABLE_PYTHON%
    echo     Run: python -m venv python-portable
    echo     Then: python-portable\Scripts\pip.exe install -r requirements.txt
    echo.
    pause
    exit /b 1
)

REM Check for .env file
if not exist ".env" (
    echo [.] No .env file found. Copying from example...
    copy .env.example .env
    echo [i] Edit .env with your settings (especially RockAuto credentials)
    echo.
)

REM Start the service
echo [.] Starting RockAuto service on http://localhost:8001
echo [.] Health check: http://localhost:8001/health
echo [.] Press Ctrl+C to stop
echo.

"%PORTABLE_PYTHON%" main.py

echo.
echo [.] Service stopped.
pause