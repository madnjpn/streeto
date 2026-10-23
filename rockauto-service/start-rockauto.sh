#!/bin/bash
# RockAuto Service Startup Script for Linux/macOS
# ==============================================
# This script starts the RockAuto microservice alongside the STREETO Node.js app
# Uses portable Python environment in python-portable/ folder

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================================"
echo "  STREETO RockAuto Service"
echo "============================================================"
echo

# Use portable Python environment
PORTABLE_PYTHON="$SCRIPT_DIR/python-portable/bin/python"
PORTABLE_PIP="$SCRIPT_DIR/python-portable/bin/pip"

if [ ! -f "$PORTABLE_PYTHON" ]; then
    echo "[x] Portable Python not found at $PORTABLE_PYTHON"
    echo "    Run: python3 -m venv python-portable"
    echo "    Then: python-portable/bin/pip install -r requirements.txt"
    exit 1
fi

# Check for .env file
if [ ! -f ".env" ]; then
    echo "[.] No .env file found. Copying from example..."
    cp .env.example .env
    echo "[i] Edit .env with your settings (especially RockAuto credentials)"
    echo
fi

# Start the service
echo "[.] Starting RockAuto service on http://localhost:8001"
echo "[.] Health check: http://localhost:8001/health"
echo "[.] Press Ctrl+C to stop"
echo

"$PORTABLE_PYTHON" main.py

echo
echo "[.] Service stopped."