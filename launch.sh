#!/usr/bin/env bash
# ==============================================================================
# launch.sh - All-in-One Unified Server Launcher
# ==============================================================================
# Manages and orchestrates all project services:
#   1. Gemini Web2API Daemon          -> http://localhost:8081
#   2. YouTube Automation Studio      -> http://localhost:3456
#   3. Mission LDA Exam Platform      -> http://localhost:8080
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Configuration defaults
GEMINI_PORT="${GEMINI_PORT:-8081}"
LDA_PORT="${PORT:-8080}"
YOUTUBE_PORT="${YOUTUBE_PORT:-3456}"
OPERATOR_PORT="${OPERATOR_PORT:-3457}"
HOST="${HOST:-0.0.0.0}"
MODEL="${MODEL:-gemini-3.6-flash}"

LOGS_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOGS_DIR"
touch "$LOGS_DIR/gemini.log" "$LOGS_DIR/lda.log" "$LOGS_DIR/youtube.log" "$LOGS_DIR/operator.log"
mkdir -p "$SCRIPT_DIR/data/questions" "$SCRIPT_DIR/web" "$SCRIPT_DIR/static"

# Color Palette
C_RESET="\033[0m"
C_BOLD="\033[1m"
C_DIM="\033[2m"
C_RED="\033[38;2;239;68;68m"
C_GREEN="\033[38;2;16;185;129m"
C_BLUE="\033[38;2;59;130;246m"
C_CYAN="\033[38;2;6;182;212m"
C_GOLD="\033[38;2;245;158;11m"
C_PURPLE="\033[38;2;168;85;247m"

# Track PIDs started in this session
STARTED_PIDS=()

banner() {
    clear 2>/dev/null || true
    echo -e "${C_BOLD}${C_CYAN}╔════════════════════════════════════════════════════════════════════════════╗${C_RESET}"
    echo -e "${C_BOLD}${C_CYAN}║${C_RESET}                   ${C_BOLD}🚀 UNIFIED SYSTEM LAUNCHER${C_RESET}                              ${C_BOLD}${C_CYAN}║${C_RESET}"
    echo -e "${C_BOLD}${C_CYAN}║${C_RESET}     ${C_DIM}Gemini Web2API · YouTube Automation Studio · Mission LDA Exam${C_RESET}     ${C_BOLD}${C_CYAN}║${C_RESET}"
    echo -e "${C_BOLD}${C_CYAN}╚════════════════════════════════════════════════════════════════════════════╝${C_RESET}"
    echo ""
}

is_port_in_use() {
    local port="$1"
    lsof -i :"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0 || return 1
}

get_port_pid() {
    local port="$1"
    (lsof -ti :"$port" 2>/dev/null || true) | head -n 1
}

cleanup() {
    echo ""
    echo -e "${C_BOLD}${C_GOLD}🛑 Shutting down services started by this script...${C_RESET}"
    for pid in "${STARTED_PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    sleep 0.5
    echo -e "${C_GREEN}✓ Clean exit complete.${C_RESET}"
    exit 0
}

trap cleanup SIGINT SIGTERM

start_gemini() {
    if is_port_in_use "$GEMINI_PORT"; then
        local existing_pid
        existing_pid=$(get_port_pid "$GEMINI_PORT")
        echo -e "  ${C_GREEN}✓${C_RESET} ${C_BOLD}Gemini Web2API${C_RESET} is already running on port ${C_CYAN}${GEMINI_PORT}${C_RESET} ${C_DIM}(PID: ${existing_pid})${C_RESET}"
    else
        echo -e "  ${C_GOLD}⏳ Starting Gemini Web2API on port ${GEMINI_PORT}...${C_RESET}"
        export DEFAULT_MODEL="${MODEL}"
        python3 gemini_web2api.py --port "${GEMINI_PORT}" > "$LOGS_DIR/gemini.log" 2>&1 &
        local pid=$!
        STARTED_PIDS+=("$pid")

        # Wait for daemon ready
        local ready=0
        for _ in {1..12}; do
            if curl -s -m 1 "http://127.0.0.1:${GEMINI_PORT}/" > /dev/null 2>&1; then
                ready=1
                break
            fi
            sleep 0.5
        done

        if [ "$ready" -eq 1 ]; then
            echo -e "  ${C_GREEN}✓${C_RESET} ${C_BOLD}Gemini Web2API${C_RESET} started on port ${C_CYAN}${GEMINI_PORT}${C_RESET} ${C_DIM}(PID: ${pid})${C_RESET}"
        else
            echo -e "  ${C_RED}✗ Failed to verify Gemini Web2API on port ${GEMINI_PORT}. Check logs/gemini.log${C_RESET}"
        fi
    fi
}

start_lda() {
    if is_port_in_use "$LDA_PORT"; then
        local existing_pid
        existing_pid=$(get_port_pid "$LDA_PORT")
        echo -e "  ${C_GREEN}✓${C_RESET} ${C_BOLD}Mission LDA Server${C_RESET} is already running on port ${C_CYAN}${LDA_PORT}${C_RESET} ${C_DIM}(PID: ${existing_pid})${C_RESET}"
    else
        echo -e "  ${C_GOLD}⏳ Starting Mission LDA Platform on port ${LDA_PORT}...${C_RESET}"
        python3 server.py --host "$HOST" --port "$LDA_PORT" --gemini-port "$GEMINI_PORT" --default-model "$MODEL" > "$LOGS_DIR/lda.log" 2>&1 &
        local pid=$!
        STARTED_PIDS+=("$pid")

        local ready=0
        for _ in {1..10}; do
            if curl -s -m 1 "http://127.0.0.1:${LDA_PORT}/" > /dev/null 2>&1; then
                ready=1
                break
            fi
            sleep 0.5
        done

        if [ "$ready" -eq 1 ]; then
            echo -e "  ${C_GREEN}✓${C_RESET} ${C_BOLD}Mission LDA Platform${C_RESET} started on port ${C_CYAN}${LDA_PORT}${C_RESET} ${C_DIM}(PID: ${pid})${C_RESET}"
        else
            echo -e "  ${C_RED}✗ Failed to verify Mission LDA Server on port ${LDA_PORT}. Check logs/lda.log${C_RESET}"
        fi
    fi
}

start_youtube() {
    if is_port_in_use "$YOUTUBE_PORT"; then
        local existing_pid
        existing_pid=$(get_port_pid "$YOUTUBE_PORT")
        echo -e "  ${C_GREEN}✓${C_RESET} ${C_BOLD}YouTube Automation Studio${C_RESET} is already running on port ${C_CYAN}${YOUTUBE_PORT}${C_RESET} ${C_DIM}(PID: ${existing_pid})${C_RESET}"
    else
        echo -e "  ${C_GOLD}⏳ Starting YouTube Automation Studio on port ${YOUTUBE_PORT}...${C_RESET}"
        (cd "$SCRIPT_DIR/youtube-automation-agent" && PORT="$YOUTUBE_PORT" node index.js > "$LOGS_DIR/youtube.log" 2>&1) &
        local pid=$!
        STARTED_PIDS+=("$pid")

        local ready=0
        for _ in {1..15}; do
            if curl -s -m 1 "http://127.0.0.1:${YOUTUBE_PORT}/health" > /dev/null 2>&1; then
                ready=1
                break
            fi
            sleep 0.5
        done

        if [ "$ready" -eq 1 ]; then
            echo -e "  ${C_GREEN}✓${C_RESET} ${C_BOLD}YouTube Automation Studio${C_RESET} started on port ${C_CYAN}${YOUTUBE_PORT}${C_RESET} ${C_DIM}(PID: ${pid})${C_RESET}"
        else
            echo -e "  ${C_RED}✗ YouTube Automation Studio initialization taking longer or had an issue. Check logs/youtube.log${C_RESET}"
        fi
    fi
}

start_operator() {
    if is_port_in_use "$OPERATOR_PORT"; then
        local existing_pid
        existing_pid=$(get_port_pid "$OPERATOR_PORT")
        echo -e "  ${C_GREEN}✓${C_RESET} ${C_BOLD}Local Shorts Operator${C_RESET} is already running on port ${C_CYAN}${OPERATOR_PORT}${C_RESET} ${C_DIM}(PID: ${existing_pid})${C_RESET}"
    else
        echo -e "${C_GOLD}⏳ Starting Local Shorts Operator on port ${OPERATOR_PORT}...${C_RESET}"
        (cd "$SCRIPT_DIR/claude-faceless-shorts-creator" && OPERATOR_PORT="$OPERATOR_PORT" node operator/server.js > "$LOGS_DIR/operator.log" 2>&1) &
        local pid=$!
        STARTED_PIDS+=("$pid")

        local ready=0
        for _ in {1..20}; do
            if curl -s -m 1 "http://127.0.0.1:${OPERATOR_PORT}/health" > /dev/null 2>&1; then
                ready=1
                break
            fi
            sleep 0.5
        done

        if [ "$ready" -eq 1 ]; then
            echo -e "  ${C_GREEN}✓${C_RESET} ${C_BOLD}Local Shorts Operator${C_RESET} started on port ${C_CYAN}${OPERATOR_PORT}${C_RESET} ${C_DIM}(PID: ${pid})${C_RESET} ${C_DIM}→ http://localhost:${OPERATOR_PORT}${C_RESET}"
        else
            echo -e "  ${C_RED}✗ Local Shorts Operator failed to start. Check logs/operator.log${C_RESET}"
        fi
    fi
}

show_status() {
    echo -e "${C_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━ SYSTEM STATUS ━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
    printf "  %-30s %-8s %-12s %s\n" "SERVICE" "PORT" "STATUS" "PID"
    echo -e "  ─────────────────────────────────────────────────────────────"

    # Gemini
    local g_pid
    g_pid=$(get_port_pid "$GEMINI_PORT")
    if [ -n "$g_pid" ]; then
        printf "  %-30s %-8s ${C_GREEN}%-12s${C_RESET} %s\n" "Gemini Web2API" "$GEMINI_PORT" "RUNNING" "$g_pid"
    else
        printf "  %-30s %-8s ${C_RED}%-12s${C_RESET} %s\n" "Gemini Web2API" "$GEMINI_PORT" "STOPPED" "-"
    fi

    # YouTube Agent
    local y_pid
    y_pid=$(get_port_pid "$YOUTUBE_PORT")
    if [ -n "$y_pid" ]; then
        printf "  %-30s %-8s ${C_GREEN}%-12s${C_RESET} %s\n" "YouTube Studio & Agent" "$YOUTUBE_PORT" "RUNNING" "$y_pid"
    else
        printf "  %-30s %-8s ${C_RED}%-12s${C_RESET} %s\n" "YouTube Studio & Agent" "$YOUTUBE_PORT" "STOPPED" "-"
    fi

    # Mission LDA
    local l_pid
    l_pid=$(get_port_pid "$LDA_PORT")
    if [ -n "$l_pid" ]; then
        printf "  %-30s %-8s ${C_GREEN}%-12s${C_RESET} %s\n" "Mission LDA Platform" "$LDA_PORT" "RUNNING" "$l_pid"
    else
        printf "  %-30s %-8s ${C_RED}%-12s${C_RESET} %s\n" "Mission LDA Platform" "$LDA_PORT" "STOPPED" "-"
    fi

    # Local Shorts Operator
    local o_pid
    o_pid=$(get_port_pid "$OPERATOR_PORT")
    if [ -n "$o_pid" ]; then
        printf "  %-30s %-8s ${C_GREEN}%-12s${C_RESET} %s\n" "Local Shorts Operator" "$OPERATOR_PORT" "RUNNING" "$o_pid"
    else
        printf "  %-30s %-8s ${C_RED}%-12s${C_RESET} %s\n" "Local Shorts Operator" "$OPERATOR_PORT" "STOPPED" "-"
    fi
    echo -e "${C_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
    echo ""
}

stop_all() {
    echo -e "${C_BOLD}${C_GOLD}🛑 Stopping all services...${C_RESET}"
    local ports=("$GEMINI_PORT" "$LDA_PORT" "$YOUTUBE_PORT" "$OPERATOR_PORT")
    for p in "${ports[@]}"; do
        local pid
        pid=$(get_port_pid "$p")
        if [ -n "$pid" ]; then
            echo -e "  Stopping process on port $p (PID: $pid)..."
            kill "$pid" 2>/dev/null || true
        fi
    done
    sleep 1
    echo -e "${C_GREEN}✓ All services stopped.${C_RESET}"
}

print_endpoints() {
    local lan_ip
    lan_ip=$(ipconfig getifaddr en0 2>/dev/null || ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1 || true)

    echo ""
    echo -e "${C_BOLD}${C_GREEN}🌟 ALL ACTIVE ENDPOINTS:${C_RESET}"
    echo -e "${C_CYAN}──────────────────────────────────────────────────────────────────────${C_RESET}"
    echo -e "  🎬 ${C_BOLD}YouTube Automation Studio:${C_RESET}  ${C_CYAN}http://localhost:${YOUTUBE_PORT}/${C_RESET}"
    echo -e "     • Operator Hub:                ${C_DIM}http://localhost:${YOUTUBE_PORT}/?view=operator${C_RESET}"
    echo -e "     • Generation Review:           ${C_DIM}http://localhost:${YOUTUBE_PORT}/?view=content${C_RESET}"
    echo -e "     • Production Health API:       ${C_DIM}http://localhost:${YOUTUBE_PORT}/health${C_RESET}"
    echo ""
    echo -e "  🏛️  ${C_BOLD}Mission LDA Exam Platform:${C_RESET}  ${C_CYAN}http://localhost:${LDA_PORT}/${C_RESET}"
    echo -e "     • Legacy Exam Interface:       ${C_DIM}http://localhost:${LDA_PORT}/legacy${C_RESET}"
    if [ -n "$lan_ip" ]; then
        echo -e "     • Mobile / iPad LAN Access:    ${C_BLUE}http://${lan_ip}:${LDA_PORT}/${C_RESET}"
    fi
    echo ""
    echo -e "  ⚡ ${C_BOLD}Gemini Web2API Bridge:${C_RESET}      ${C_CYAN}http://localhost:${GEMINI_PORT}/${C_RESET}"
    echo -e "     • OpenAI Compatible Base URL:  ${C_DIM}http://127.0.0.1:${GEMINI_PORT}/v1${C_RESET}"
    echo -e "${C_CYAN}──────────────────────────────────────────────────────────────────────${C_RESET}"
    echo -e "  📁 Log outputs: ${C_DIM}$LOGS_DIR/{gemini,youtube,lda}.log${C_RESET}"
    echo -e "  🛑 Press ${C_BOLD}Ctrl + C${C_RESET} anytime to stop services started in this session."
    echo ""
}

# Main command dispatcher
COMMAND="${1:-all}"

case "$COMMAND" in
    status)
        banner
        show_status
        ;;
    stop)
        banner
        stop_all
        show_status
        ;;
    gemini)
        banner
        echo -e "${C_BOLD}Starting Gemini Web2API daemon only...${C_RESET}"
        start_gemini
        echo ""
        show_status
        ;;
    youtube)
        banner
        echo -e "${C_BOLD}Starting YouTube Automation Studio & Gemini backend...${C_RESET}"
        start_gemini
        start_youtube
        print_endpoints
        echo -e "${C_DIM}Streaming YouTube Studio logs (Press Ctrl+C to exit)...${C_RESET}"
        tail -f "$LOGS_DIR/youtube.log"
        ;;
    short)
        banner
        echo -e "${C_BOLD}Local Shorts Factory (claude-faceless-shorts-creator)...${C_RESET}"
        start_gemini
        TOPIC_ARGS=()
        STYLE_ARGS=()
        while [[ $# -ge 2 ]]; do
            case "$2" in
                --style) STYLE_ARGS=(--style "$3"); shift 2 ;;
                *) TOPIC_ARGS+=("$2"); shift ;;
            esac
        done
        if [ ${#TOPIC_ARGS[@]} -eq 0 ]; then
            echo -e "  ${C_RED}Usage: ./launch.sh short \"your topic here\" [--style \"niche\"]${C_RESET}"
            exit 1
        fi
        (cd "$SCRIPT_DIR/claude-faceless-shorts-creator" && python3 tools/make_short.py --topic "${TOPIC_ARGS[*]}" "${STYLE_ARGS[@]}")
        ;;
    lda)
        banner
        echo -e "${C_BOLD}Starting Mission LDA Exam Platform & Gemini backend...${C_RESET}"
        start_gemini
        start_lda
        print_endpoints
        echo -e "${C_DIM}Streaming Mission LDA logs (Press Ctrl+C to exit)...${C_RESET}"
        tail -f "$LOGS_DIR/lda.log"
        ;;
    operator)
        banner
        echo -e "${C_BOLD}Starting Local Shorts Operator (new video generator)...${C_RESET}"
        start_gemini
        start_operator
        print_endpoints
        echo -e "${C_DIM}Streaming Operator logs (Press Ctrl+C to exit)...${C_RESET}"
        tail -f "$LOGS_DIR/operator.log"
        ;;
    all|start)
        banner
        echo -e "${C_BOLD}Launching full ecosystem...${C_RESET}"
        start_gemini
        start_operator
        start_youtube
        start_lda
        print_endpoints

        # Keep alive in foreground so Ctrl+C gracefully stops everything
        echo -e "${C_DIM}Services running in background. Live tail of latest logs (Ctrl+C to quit all)...${C_RESET}"
        tail -f "$LOGS_DIR/youtube.log" "$LOGS_DIR/lda.log" 2>/dev/null
        ;;
    help|--help|-h)
        banner
        echo -e "${C_BOLD}Usage:${C_RESET} ./launch.sh [command]"
        echo ""
        echo "Commands:"
        echo "  all      Launch Gemini Web2API, Shorts Operator, YouTube Studio, and Mission LDA (Default)"
        echo "  operator Launch Gemini Web2API + Local Shorts Operator (dashboard :3457)"
        echo "  short    Generate a local short end-to-end: ./launch.sh short \"topic\" [--style \"niche\"]"
        echo "  youtube  Launch Gemini Web2API + old YouTube Automation Studio"
        echo "  lda      Launch Gemini Web2API + Mission LDA Exam Platform"
        echo "  gemini   Launch Gemini Web2API only"
        echo "  status   Show current status of all services and ports"
        echo "  stop     Stop all running services on ports 8081, 8080, 3456"
        echo "  help     Display this help message"
        echo ""
        ;;
    *)
        echo -e "${C_RED}Unknown command: $COMMAND${C_RESET}"
        echo "Run ./launch.sh help for available options."
        exit 1
        ;;
esac
