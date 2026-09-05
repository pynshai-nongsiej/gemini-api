#!/usr/bin/env bash
# ==============================================================================
# run_mac.sh - macOS Native Launcher for Mission LDA Exam Platform
# Supporting MPSC LDA (State Cadre) & DSC West Khasi Hills (District Cadre)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-8080}"
GEMINI_PORT="${GEMINI_PORT:-8081}"
HOST="${HOST:-0.0.0.0}"
MODEL="${MODEL:-gemini-3.6-flash}"

# macOS Terminal ANSI Colors
C_RESET="\033[0m"
C_BOLD="\033[1m"
C_CYAN="\033[38;2;43;176;237m"
C_BLUE="\033[38;2;0;74;198m"
C_GREEN="\033[38;2;16;185;129m"
C_GOLD="\033[38;2;217;154;43m"
C_DIM="\033[2m"

clear 2>/dev/null || true

cat << "EOF"
  🏛️  MISSION LDA EXAM PLATFORM · macOS
  Disciplined Swiss Editorial Prep · Spaced Repetition · Gemini 3.6
  Target Cadres: MPSC LDA & DSC West Khasi Hills LDA-cum-Typist
EOF
echo ""
echo -e "${C_BOLD}======================================================================${C_RESET}"
echo -e "  ${C_CYAN}macOS Native Deployment System${C_RESET} - Target Model: ${C_GOLD}${MODEL}${C_RESET}"
echo -e "${C_BOLD}======================================================================${C_RESET}"

# 1. Environment & Package Check
if ! command -v python3 &> /dev/null; then
    echo -e "❌ ${C_BOLD}Error: python3 is not installed.${C_RESET}"
    echo "   Please install Python 3 via Xcode Command Line Tools: xcode-select --install"
    exit 1
fi
echo -e "  ${C_GREEN}✓${C_RESET} Python Runtime: $(python3 --version)"

# Ensure storage directories
mkdir -p data/questions
mkdir -p web
mkdir -p static

# 2. Check & Start gemini-web2api on port 8081
echo -e "  ${C_CYAN}🔍 Checking local Gemini daemon on port ${GEMINI_PORT}...${C_RESET}"
GEMINI_PID=""
if curl -s -m 2 "http://127.0.0.1:${GEMINI_PORT}/" > /dev/null 2>&1; then
    echo -e "  ${C_GREEN}✓${C_RESET} gemini-web2api is already active on port ${GEMINI_PORT}"
else
    echo -e "  ${C_GOLD}🚀 Starting gemini-web2api daemon (${MODEL})...${C_RESET}"
    export DEFAULT_MODEL="${MODEL}"
    python3 gemini_web2api.py --port "${GEMINI_PORT}" > gemini.log 2>&1 &
    GEMINI_PID=$!
    
    # Wait for daemon to become ready
    for i in {1..10}; do
        if curl -s -m 1 "http://127.0.0.1:${GEMINI_PORT}/" > /dev/null 2>&1; then
            echo -e "  ${C_GREEN}✓${C_RESET} gemini-web2api initialized on port ${GEMINI_PORT}"
            break
        fi
        sleep 1
    done
fi

# 3. Clean exit handler
cleanup() {
    echo ""
    echo -e "${C_BOLD}Shutting down Mission LDA services...${C_RESET}"
    if [ -n "$GEMINI_PID" ]; then
        kill "$GEMINI_PID" 2>/dev/null || true
    fi
    exit 0
}
trap cleanup SIGINT SIGTERM

# 4. Display URLs
echo -e "${C_BOLD}----------------------------------------------------------------------${C_RESET}"
echo -e "  ${C_GOLD}★ MISSION LDA WEB APP:${C_RESET}       ${C_CYAN}http://localhost:${PORT}/${C_RESET}"
echo -e "  📖 Legacy Prep Log:           http://localhost:${PORT}/legacy"
echo -e "  ⚡ Gemini API Direct:         http://localhost:${GEMINI_PORT}/"

# macOS Local Network IP Discovery
MAC_IP=$(ipconfig getifaddr en0 2>/dev/null || ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)
if [ -n "$MAC_IP" ]; then
    echo -e "  📱 LAN Access (iPhone/iPad):  ${C_BLUE}http://${MAC_IP}:${PORT}/${C_RESET}"
fi
echo -e "${C_BOLD}----------------------------------------------------------------------${C_RESET}"
echo -e "  Listening on ${HOST}:${PORT}... Press ${C_BOLD}Ctrl+C${C_RESET} to halt."
echo ""

# 5. Start main macOS server
exec python3 server.py \
    --host "$HOST" \
    --port "$PORT" \
    --gemini-url "http://127.0.0.1:${GEMINI_PORT}/v1" \
    --model "$MODEL"
