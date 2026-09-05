#!/usr/bin/env bash
# Forwarding script: redirects to macOS-native launcher run_mac.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/run_mac.sh" "$@"
