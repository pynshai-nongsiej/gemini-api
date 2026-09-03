#!/usr/bin/env bash
# ==============================================================================
# run_arch.sh - Arch Linux Launcher for DSC West Khasi Hills LDA Mission Log
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-8080}"
GEMINI_PORT="${GEMINI_PORT:-8081}"
HOST="${HOST:-0.0.0.0}"
MODEL="${MODEL:-gemini-3.5-flash-thinking}"

echo "======================================================================"
echo "  🏛️  DSC West Khasi Hills — LDA Mission Log on Arch Linux"
echo "======================================================================"

# Check Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: python3 is not installed."
    echo "   On Arch Linux, run: sudo pacman -S python"
    exit 1
fi

echo "  ✓ Python: $(python3 --version)"

# Check if gemini-web2api is running on localhost:$GEMINI_PORT
echo "  🔍 Checking gemini-web2api on port $GEMINI_PORT..."
if curl -s -m 2 "http://127.0.0.1:${GEMINI_PORT}/" > /dev/null 2>&1; then
    echo "  ✓ gemini-web2api is already running on http://127.0.0.1:${GEMINI_PORT}"
else
    echo "  ⚠️ gemini-web2api is NOT currently running on port ${GEMINI_PORT}."
    echo "     If you want to start it in background, run:"
    echo "     nohup python3 gemini_web2api.py --port ${GEMINI_PORT} > gemini.log 2>&1 &"
    echo ""
fi

# Detect IP addresses on Arch Linux
echo "  🌐 Network interfaces:"
if command -v ip &> /dev/null; then
    ip -4 addr show scope global | grep inet | awk '{print "     • http://" $2 ":'"${PORT}"'"} ' | sed -e 's/\/.*:/ :/'
fi

echo "----------------------------------------------------------------------"
echo "  Starting Arch Listener on ${HOST}:${PORT}..."
echo "  Open your browser at: http://localhost:${PORT}"
echo "----------------------------------------------------------------------"

exec python3 arch_server.py \
    --host "$HOST" \
    --port "$PORT" \
    --gemini-url "http://127.0.0.1:${GEMINI_PORT}/v1" \
    --model "$MODEL"
