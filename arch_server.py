#!/usr/bin/env python3
"""
arch_server.py - Backward-compatible shim.
Redirects execution to server.py (macOS Native Mission LDA Server).
"""
import sys
import os

if __name__ == "__main__":
    import server
    server.main()
