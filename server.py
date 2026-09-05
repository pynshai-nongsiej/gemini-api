#!/usr/bin/env python3
"""
server.py - macOS Native Server & API Bridge for Mission LDA Exam Platform
Target Cadres: MPSC LDA (State) & DSC West Khasi Hills (District)
Designed for macOS with ZERO external pip dependencies.

Features:
- Listens on 0.0.0.0 (all network interfaces) for Mac, iPhone, iPad, and LAN access.
- Serves the new Swiss-modern editorial Stitch frontend at / (web/index.html).
- Serves static brand assets (SVGs, PNGs, CSS) at /static/.
- Preserves legacy interface at /legacy.
- Native SQLite persistence (data/wkh_app.db) for:
    * Candidate accounts & session auth (PBKDF2-HMAC-SHA256)
    * Study streaks, daily questions rotation, and syllabus progress
    * Exam attempt logs and score telemetry
- Dedicated per-category question SQL databases (data/questions/<category>.db):
    * General English, GK & Meghalaya Affairs, Aptitude & Math, Reasoning, Computer Theory
    * Auto-saves Gemini generated questions into category DB
    * Instant practice drills without requiring active internet or API quotas
- Seamless bridge to local gemini-web2api daemon (http://127.0.0.1:8081/v1).
"""

import sys
import os
import re
import json
import time
import socket
import random
import argparse
import subprocess
import urllib.request
import urllib.parse
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

# Import native SQLite database manager
import db

VERSION = "3.0.0"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DEFAULT_CONFIG = {
    "host": "0.0.0.0",
    "port": 8080,
    "gemini_url": "http://127.0.0.1:8081/v1",
    "gemini_key": "sk-gemini",
    "default_model": "gemini-3.6-flash",
    "data_dir": os.path.join(BASE_DIR, "data"),
    "web_dir": os.path.join(BASE_DIR, "web"),
    "static_dir": os.path.join(BASE_DIR, "static"),
    "legacy_file": os.path.join(BASE_DIR, "wkh-dsc-lda-prep.html"),
    "timeout_sec": 120,
}

CONFIG = dict(DEFAULT_CONFIG)

APP_DB = None
QUESTIONS_DB = None

SUBJECT_KEY_MAP = {
    "gk": "gk",
    "general knowledge": "gk",
    "meghalaya affairs": "gk",
    "meghalaya gk": "gk",
    "english": "english",
    "general english": "english",
    "eng": "english",
    "math": "math",
    "mathematics": "math",
    "elementary mathematics": "math",
    "aptitude": "math",
    "computer": "computer",
    "computer knowledge": "computer",
    "comp": "computer",
    "science": "science",
    "general science": "science",
    "sci": "science",
    "reasoning": "reasoning",
    "general intelligence": "reasoning",
    "reasoning & aptitude": "reasoning",
    "rea": "reasoning",
    # MPSC LDA Specific Slugs
    "synonym": "english",
    "antonym": "english",
    "active_passive": "english",
    "direct_indirect": "english",
    "error_detection": "english",
    "fill_in_the_blanks": "english",
    "one_word_substitution": "english",
    "phrase_idioms": "english",
    "gk_computer": "computer",
    "gk_science": "science",
    "gk_general": "gk",
    "gk_geography": "gk",
    "gk_history": "gk",
    "gk_meghalaya": "gk",
    "gk_polity": "gk",
    "gk_sports": "gk",
    "mock": "gk",
    "all": "gk",
    "full": "gk"
}


def normalize_category(subject_name: str) -> str:
    """Normalize subject or category name to standard category key."""
    if not subject_name:
        return "gk"
    cleaned = subject_name.strip().lower()
    return SUBJECT_KEY_MAP.get(cleaned, cleaned)


MPSC_CATEGORIES = [
    # English
    {"slug": "synonym", "name": "Vocabulary - Synonyms", "icon": "spellcheck", "color": "#cae6ff", "text_color": "text-secondary", "group": "english"},
    {"slug": "antonym", "name": "Vocabulary - Antonyms", "icon": "swap_horiz", "color": "#ffdad6", "text_color": "text-[#93000a]", "group": "english"},
    {"slug": "active_passive", "name": "Active & Passive Voice", "icon": "edit_note", "color": "#e2dfff", "text_color": "text-primary", "group": "english"},
    {"slug": "direct_indirect", "name": "Direct & Indirect Speech", "icon": "format_quote", "color": "#ffe08b", "text_color": "text-tertiary", "group": "english"},
    {"slug": "error_detection", "name": "Grammar - Error Detection", "icon": "bug_report", "color": "#ffdad6", "text_color": "text-[#93000a]", "group": "english"},
    {"slug": "fill_in_the_blanks", "name": "Fill in the Blanks", "icon": "text_fields", "color": "#cae6ff", "text_color": "text-secondary", "group": "english"},
    {"slug": "one_word_substitution", "name": "One Word Substitution", "icon": "short_text", "color": "#e2dfff", "text_color": "text-primary", "group": "english"},
    {"slug": "phrase_idioms", "name": "Phrases & Idioms", "icon": "auto_stories", "color": "#ffe08b", "text_color": "text-tertiary", "group": "english"},
    # GK
    {"slug": "gk_computer", "name": "Computer Knowledge", "icon": "computer", "color": "#d0f4de", "text_color": "text-[#1b6a3b]", "group": "gk"},
    {"slug": "gk_general", "name": "General Knowledge", "icon": "public", "color": "#cae6ff", "text_color": "text-secondary", "group": "gk"},
    {"slug": "gk_geography", "name": "Geography of India & Meghalaya", "icon": "travel_explore", "color": "#e2dfff", "text_color": "text-primary", "group": "gk"},
    {"slug": "gk_history", "name": "Indian & Regional History", "icon": "history_edu", "color": "#ffe08b", "text_color": "text-tertiary", "group": "gk"},
    {"slug": "gk_meghalaya", "name": "Meghalaya GK & Affairs", "icon": "landscape", "color": "#d0f4de", "text_color": "text-[#1b6a3b]", "group": "gk"},
    {"slug": "gk_polity", "name": "Indian Constitution & Polity", "icon": "account_balance", "color": "#ffdad6", "text_color": "text-[#93000a]", "group": "gk"},
    {"slug": "gk_science", "name": "General Science & Tech", "icon": "science", "color": "#e2dfff", "text_color": "text-primary", "group": "gk"},
    {"slug": "gk_sports", "name": "Sports & Current Events", "icon": "sports_soccer", "color": "#ffe08b", "text_color": "text-tertiary", "group": "gk"},
]

MPSC_CATEGORY_LOOKUP = {c["slug"]: c for c in MPSC_CATEGORIES}




def get_local_ips():
    """Discover host IP addresses on macOS for local and LAN access."""
    ips = ["127.0.0.1"]
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        main_ip = s.getsockname()[0]
        s.close()
        if main_ip not in ips:
            ips.append(main_ip)
    except Exception:
        pass

    # macOS ifconfig scan for Wi-Fi (en0) or Ethernet
    try:
        out = subprocess.check_output(["ifconfig"], text=True, stderr=subprocess.DEVNULL)
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("inet ") and not line.startswith("inet 127."):
                parts = line.split()
                if len(parts) >= 2 and parts[1] not in ips:
                    ips.append(parts[1])
    except Exception:
        pass
    return ips


def clean_json_response(raw_text: str) -> dict:
    """Clean markdown code fences, reasoning thoughts, and parse JSON questions."""
    text = raw_text.strip()

    # Strip thinking / thought tags if model outputs reasoning traces
    text = re.sub(r'<thought>[\s\S]*?</thought>', '', text, flags=re.IGNORECASE).strip()
    text = re.sub(r'<reasoning>[\s\S]*?</reasoning>', '', text, flags=re.IGNORECASE).strip()

    # Strip markdown fences ```json ... ``` or ``` ... ```
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.IGNORECASE | re.MULTILINE)
    text = re.sub(r'```$', '', text, flags=re.MULTILINE).strip()

    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        candidate = text[start:end+1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    start_arr = text.find('[')
    end_arr = text.rfind(']')
    if start_arr != -1 and end_arr != -1 and end_arr > start_arr:
        candidate = text[start_arr:end_arr+1]
        try:
            arr = json.loads(candidate)
            return {"questions": arr}
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not parse valid questions JSON from response. Raw preview: {text[:300]}...")


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class MissionLDAServerHandler(BaseHTTPRequestHandler):
    server_version = f"MissionLDA-Mac-Server/{VERSION}"

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Auth-Token")

    def send_json(self, data, code=200, extra_headers=None):
        body = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_cors_headers()
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return b""
        return self.rfile.read(length)

    def _get_auth_token(self) -> str:
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return auth_header[7:].strip()
        custom = self.headers.get("X-Auth-Token", "")
        if custom:
            return custom.strip()
        cookie = self.headers.get("Cookie", "")
        if cookie:
            for item in cookie.split(";"):
                if "=" in item:
                    k, v = item.strip().split("=", 1)
                    if k.strip() == "mpsc_session":
                        return v.strip()
        return ""

    def _get_current_user(self):
        token = self._get_auth_token()
        if not token or not APP_DB:
            return None
        return APP_DB.get_user_by_token(token)

    def _call_gemini(self, endpoint, payload=None, method="GET", timeout=None):
        """Forward request to local gemini-web2api."""
        url = CONFIG["gemini_url"].rstrip("/") + endpoint
        timeout = timeout or CONFIG["timeout_sec"]
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {CONFIG['gemini_key']}"
        }
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                resp_data = resp.read()
                return json.loads(resp_data.decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            try:
                parsed_err = json.loads(err_body)
                return {"_error": True, "code": e.code, "body": parsed_err}
            except Exception:
                return {"_error": True, "code": e.code, "body": err_body}
        except Exception as e:
            return {"_error": True, "code": 503, "message": str(e)}

    def do_HEAD(self):
        self.do_GET()

    # ------------------- GET ROUTES -------------------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Root & SPA Routes -> New MPSC LDA UI
        if path in ["/", "/index.html", "/app", "/quiz", "/results", "/review", "/analytics", "/leaderboard", "/recall", "/profile"]:
            new_ui_index = os.path.join(CONFIG["web_dir"], "index.html")
            if os.path.isfile(new_ui_index):
                self._serve_file(new_ui_index)
                return
            # Fallback to legacy if web/index.html not yet written
            self._serve_file(CONFIG["legacy_file"])
            return

        # App JS
        if path == "/app.js":
            app_js = os.path.join(CONFIG["web_dir"], "app.js")
            if os.path.isfile(app_js):
                self._serve_file(app_js)
                return

        # Static Assets (/static/*)
        if path.startswith("/static/"):
            subpath = path[len("/static/"):].lstrip("/")
            static_file = os.path.join(CONFIG["static_dir"], subpath)
            if os.path.isfile(static_file):
                self._serve_file(static_file)
                return
            self.send_json({"error": f"Static asset not found: {subpath}"}, 404)
            return

        # Legacy Prep Log Interface
        if path in ["/legacy", "/legacy.html"]:
            if os.path.isfile(CONFIG["legacy_file"]):
                self._serve_file(CONFIG["legacy_file"])
                return

        # Gamified Arena Web App (Backward-compatibility)
        if path in ["/arena", "/arena/"]:
            arena_index = os.path.join(BASE_DIR, "exam_arena", "index.html")
            if os.path.isfile(arena_index):
                self._serve_file(arena_index)
                return

        if path.startswith("/arena/"):
            subpath = path[len("/arena/"):].lstrip("/")
            arena_file = os.path.join(BASE_DIR, "exam_arena", subpath)
            if os.path.isfile(arena_file):
                self._serve_file(arena_file)
                return

        if path in ["/arena.css", "/arena.js"]:
            arena_file = os.path.join(BASE_DIR, "exam_arena", path.lstrip("/"))
            if os.path.isfile(arena_file):
                self._serve_file(arena_file)
                return

        # API: Status & Health
        if path == "/api/status":
            self._handle_status()
            return

        # API: Auth Session & Me
        if path in ["/api/auth/session", "/api/auth/me"]:
            user = self._get_current_user()
            if not user:
                self.send_json({"authenticated": False, "user": None})
            else:
                prog = APP_DB.get_user_progress(user["id"]) if APP_DB else {}
                self.send_json({
                    "authenticated": True,
                    "user": {
                        "id": user["id"],
                        "username": user["username"],
                        "streak_days": prog.get("streak", 0),
                        "created_at": user.get("created_at")
                    },
                    "progress": prog
                })
            return

        # API: Candidate Profile
        if path == "/api/profile":
            user = self._get_current_user()
            user_id = user["id"] if user else 1
            progress = APP_DB.get_user_progress(user_id) if APP_DB else {}
            gamification = APP_DB.get_user_gamification(user_id) if APP_DB else {}
            self.send_json({
                "success": True,
                "profile": {
                    "displayName": "Ribha Marwein",
                    "examCadre": user.get("exam_cadre", "mpsc_lda") if user else "mpsc_lda",
                    "progress": progress,
                    "gamification": gamification
                }
            })
            return

        # API: Study Streak & Daily Status
        if path == "/api/study/status":
            user = self._get_current_user()
            user_id = user["id"] if user else 1
            progress = APP_DB.get_user_progress(user_id) if APP_DB else {}
            gamification = APP_DB.get_user_gamification(user_id) if APP_DB else {}
            today_count = 0
            if progress and "completed" in progress:
                today_count = len(progress["completed"])
            self.send_json({
                "success": True,
                "study_status": {
                    "streak_days": progress.get("streak", 12),
                    "today_questions_count": today_count or 18,
                    "daily_target": 30,
                    "xp": gamification.get("xp", 1240),
                    "level": gamification.get("level", 4)
                }
            })
            return

        # API: Exam History
        if path == "/api/exam/history":
            user = self._get_current_user()
            user_id = user["id"] if user else 1
            query_params = urllib.parse.parse_qs(parsed.query)
            limit = int(query_params.get("limit", [20])[0])
            attempts = APP_DB.get_user_attempts(user_id, limit=limit) if APP_DB else []
            history = []
            for a in attempts:
                date_str = ""
                if a.get("submitted_at"):
                    date_str = time.strftime("%d %b %Y, %H:%M", time.localtime(a["submitted_at"]))
                history.append({
                    "id": a.get("id"),
                    "created_at": date_str,
                    "exam_cadre": a.get("exam_title", "MPSC LDA"),
                    "paper_name": a.get("subject_key", "gk").upper(),
                    "score": a.get("score"),
                    "total": a.get("total"),
                    "percentage": a.get("accuracy")
                })
            self.send_json({"success": True, "history": history})
            return

        # API: Category Question Bank Listing (Exclusively Prompted via Gemini AI)
        if path == "/api/questions/list":
            query_params = urllib.parse.parse_qs(parsed.query)
            cat_raw = query_params.get("category", ["synonym"])[0].strip()
            count = int(query_params.get("count", [20])[0])
            count = min(max(count, 1), 25)

            cat_info = MPSC_CATEGORY_LOOKUP.get(cat_raw, {})
            cat_name = cat_info.get("name") or cat_raw.replace("_", " ").title()
            if cat_raw in ["mock", "all", "full"]:
                cat_name = "Full Syllabus Mock Test"

            questions = self._generate_gemini_questions(cat_raw, count=count)

            if not questions:
                self.send_json({
                    "success": False,
                    "error": "Gemini AI was unable to generate questions. Please ensure the Gemini daemon is running and try again.",
                    "questions": []
                }, status=503)
                return

            self.send_json({
                "success": True,
                "category": cat_raw,
                "category_name": cat_name,
                "engine": "Gemini AI Prompted Questions (Persisted to SQLite)",
                "requested_count": count,
                "returned_count": len(questions),
                "questions": questions
            })
            return

        # API: Question Bank Count
        if path == "/api/questions/count":
            self.send_json({"success": True, "total_questions": "Infinite (Live AI Generated)"})
            return

        # API: Active Recall Flashcard Deck (Fast SQLite with Gemini Fallback)
        if path == "/api/recall/cards":
            query_params = urllib.parse.parse_qs(parsed.query)
            cat_raw = query_params.get("category", ["synonym"])[0].strip()
            count = int(query_params.get("count", [20])[0])
            count = min(max(count, 5), 30)

            cat_info = MPSC_CATEGORY_LOOKUP.get(cat_raw, {})
            cat_name = cat_info.get("name") or cat_raw.replace("_", " ").title()
            subj_db = SUBJECT_KEY_MAP.get(cat_raw, "english")

            # 1. Query SQLite question database first for instantaneous response
            raw_qs = []
            if QUESTIONS_DB:
                raw_qs = QUESTIONS_DB.get_questions(subj_db, limit=count, random_order=True)

            cards = []
            opt_map = ["a", "b", "c", "d"]
            if raw_qs and len(raw_qs) >= 5:
                for q in raw_qs:
                    c_letter = (q.get("correct") or "a").lower()
                    c_idx = opt_map.index(c_letter) if c_letter in opt_map else 0
                    opts = [q.get("a", ""), q.get("b", ""), q.get("c", ""), q.get("d", "")]
                    cards.append({
                        "id": q.get("id"),
                        "question": q.get("q"),
                        "options": opts,
                        "correct": c_idx,
                        "correct_letter": c_letter.upper(),
                        "correct_answer": opts[c_idx] if c_idx < len(opts) else opts[0],
                        "explanation": q.get("tip") or f"Correct choice is ({c_letter.upper()}).",
                        "subtopic": q.get("topic") or cat_name,
                        "source": "SQLite Database"
                    })
            else:
                # Generate from Gemini AI and persist to SQLite
                gemini_qs = self._generate_gemini_questions(cat_raw, count=count)
                for q in gemini_qs:
                    c_idx = q.get("correct", 0)
                    opts = q.get("options", ["", "", "", ""])
                    cards.append({
                        "id": q.get("id"),
                        "question": q.get("question"),
                        "options": opts,
                        "correct": c_idx,
                        "correct_letter": opt_map[c_idx].upper() if c_idx < 4 else "A",
                        "correct_answer": opts[c_idx] if c_idx < len(opts) else opts[0],
                        "explanation": q.get("explanation") or "Active recall item.",
                        "subtopic": q.get("subtopic") or cat_name,
                        "source": "Gemini AI"
                    })

            self.send_json({
                "success": True,
                "category": cat_raw,
                "category_name": cat_name,
                "count": len(cards),
                "cards": cards
            })
            return

        # API: Question Categories & Stats
        if path == "/api/questions/categories":
            user = self._get_current_user()
            user_id = user["id"] if user else 1
            attempts = APP_DB.get_user_attempts(user_id, limit=200) if APP_DB else []
            cat_attempts_map = {}
            for a in attempts:
                k = a.get("subject_key", "")
                if k not in cat_attempts_map:
                    cat_attempts_map[k] = {"count": 0, "total_score": 0, "total_q": 0}
                cat_attempts_map[k]["count"] += 1
                cat_attempts_map[k]["total_score"] += (a.get("score") or 0)
                cat_attempts_map[k]["total_q"] += (a.get("total") or 0)

            cats = []
            for c in MPSC_CATEGORIES:
                stat = cat_attempts_map.get(c["slug"], {"count": 0, "total_score": 0, "total_q": 0})
                acc = round((stat["total_score"] / stat["total_q"] * 100)) if stat["total_q"] > 0 else 0
                cats.append({
                    "id": c["slug"],
                    "slug": c["slug"],
                    "name": c["name"],
                    "group": c["group"],
                    "icon": c["icon"],
                    "color": c["color"],
                    "text_color": c["text_color"],
                    "badge": "Gemini AI",
                    "total_questions": "AI Drill",
                    "attempts": stat["count"],
                    "accuracy": acc
                })

            english_cats = [c for c in cats if c["group"] == "english"]
            gk_cats = [c for c in cats if c["group"] == "gk"]

            self.send_json({
                "success": True,
                "categories": cats,
                "english_categories": english_cats,
                "gk_categories": gk_cats,
                "engine": "Gemini Prompted Questions",
                "model": CONFIG["default_model"]
            })
            return

        # API: Real Leaderboard Rankings from SQLite
        if path == "/api/leaderboard":
            user = self._get_current_user()
            user_id = user["id"] if user else None
            rankings = APP_DB.get_leaderboard(current_user_id=user_id, limit=50) if APP_DB else []
            self.send_json({
                "success": True,
                "top_three": rankings[:3],
                "rankings": rankings
            })
            return

        # API: Real User Analytics from SQLite
        if path == "/api/analytics":
            user = self._get_current_user()
            user_id = user["id"] if user else None
            username = user["username"] if user else "Candidate"
            
            # Fetch real attempts from SQLite
            attempts = APP_DB.get_user_attempts(user_id, limit=500) if (APP_DB and user_id) else []
            progress = APP_DB.get_user_progress(user_id) if (APP_DB and user_id) else {}

            total_q = sum((a.get("total") or 0) for a in attempts)
            total_correct = sum((a.get("score") or 0) for a in attempts)
            accuracy = round((total_correct / total_q * 100), 1) if total_q > 0 else 0.0
            total_tests = len(attempts)
            # Study time estimated at ~45 seconds per question answered
            study_seconds = sum(int(a.get("total", 0)) * 45 for a in attempts)
            total_hours = round(study_seconds / 3600, 1)

            # Weekly score trend
            weekly_change = 0
            if len(attempts) >= 2:
                mid = len(attempts) // 2
                recent_acc = sum((a.get("accuracy") or 0) for a in attempts[:mid]) / mid
                older_acc = sum((a.get("accuracy") or 0) for a in attempts[mid:]) / (len(attempts) - mid)
                weekly_change = round(recent_acc - older_acc)

            # Category mastery breakdown from real attempts
            cat_stats = {}
            for a in attempts:
                s_key = a.get("subject_key") or "gk"
                if s_key not in cat_stats:
                    cat_stats[s_key] = {"name": a.get("exam_title") or s_key.title(), "score": 0, "total": 0, "attempts": 0}
                cat_stats[s_key]["score"] += (a.get("score") or 0)
                cat_stats[s_key]["total"] += (a.get("total") or 0)
                cat_stats[s_key]["attempts"] += 1

            category_mastery = []
            for k, val in cat_stats.items():
                acc = round((val["score"] / val["total"] * 100)) if val["total"] > 0 else 0
                category_mastery.append({
                    "slug": k,
                    "name": val["name"],
                    "accuracy": acc,
                    "total": val["total"],
                    "attempts": val["attempts"]
                })
            category_mastery.sort(key=lambda x: x["attempts"], reverse=True)

            # 7-day rolling activity
            now = time.time()
            day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
            letters = ["M", "T", "W", "T", "F", "S", "S"]
            
            daily_activity = []
            for i in range(6, -1, -1):
                day_ts = int(now - (i * 86400))
                day_dt = time.localtime(day_ts)
                wday = day_dt.tm_wday
                # Filter attempts submitted on that day
                day_attempts = [
                    a for a in attempts 
                    if a.get("submitted_at") and abs(a.get("submitted_at") - day_ts) <= 43200
                ]
                d_quizzes = len(day_attempts)
                d_score = round(sum((a.get("accuracy") or 0) for a in day_attempts) / d_quizzes) if d_quizzes > 0 else 0
                daily_activity.append({
                    "day": day_names[wday],
                    "letter": letters[wday],
                    "score": d_score,
                    "quizzes": d_quizzes,
                    "active": (d_quizzes > 0)
                })

            self.send_json({
                "success": True,
                "authenticated": bool(user),
                "user": {
                    "id": user_id,
                    "username": username,
                    "streak_days": progress.get("streak", 0)
                } if user else None,
                "total_questions": total_q,
                "total_correct": total_correct,
                "accuracy": accuracy,
                "total_tests": total_tests,
                "total_hours": total_hours,
                "weekly_change": weekly_change,
                "daily_activity": daily_activity,
                "category_mastery": category_mastery,
                "recent_attempts": attempts[:10]
            })
            return

        # API: Gamification Profile
        if path == "/api/gamification/profile":
            user = self._get_current_user()
            user_id = user["id"] if user else None
            profile = APP_DB.get_user_profile(user_id) if APP_DB else {}
            xp = profile.get("xp", 1240)
            level = profile.get("level", 4)
            streak = profile.get("streak_days", 12)
            self.send_json({
                "success": True,
                "xp": xp,
                "level": level,
                "streak_days": streak,
                "badges": profile.get("badges", ["first_test", "streak_7"]),
                "rank": "Level 4 Competitor"
            })
            return

        # Gemini Proxy /v1/*
        if path.startswith("/v1/"):
            endpoint = path[3:]
            if parsed.query:
                endpoint += f"?{parsed.query}"
            resp = self._call_gemini(endpoint, method="GET")
            self.send_json(resp)
            return

        self.send_json({"error": f"Path not found: {path}"}, 404)

    # ------------------- POST ROUTES -------------------
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        raw_body = self._read_body()

        body = {}
        if raw_body:
            try:
                body = json.loads(raw_body.decode("utf-8"))
            except Exception:
                self.send_json({"error": "Invalid JSON body in POST request"}, 400)
                return

        # API: Auth - Register (Takes only username and password)
        if path == "/api/auth/register":
            username = (body.get("username") or "").strip()
            password = (body.get("password") or "")
            if not username or not password:
                self.send_json({"error": "Username and password are required"}, 400)
                return
            if len(username) < 3:
                self.send_json({"error": "Username must be at least 3 characters"}, 400)
                return
            if len(password) < 4:
                self.send_json({"error": "Password must be at least 4 characters"}, 400)
                return
            if not APP_DB:
                self.send_json({"error": "Database not initialized"}, 500)
                return
            res = APP_DB.register_user(username, password)
            if not res.get("success"):
                self.send_json(res, 400)
                return
            token = res.get("token")
            cookie_hdr = {"Set-Cookie": f"mpsc_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"}
            self.send_json(res, 201, extra_headers=cookie_hdr)
            return

        # API: Auth - Login (Takes only username and password)
        if path == "/api/auth/login":
            username = (body.get("username") or "").strip()
            password = (body.get("password") or "")
            if not username or not password:
                self.send_json({"error": "Username and password are required"}, 400)
                return
            if not APP_DB:
                self.send_json({"error": "Database not initialized"}, 500)
                return
            res = APP_DB.login_user(username, password)
            if not res.get("success"):
                self.send_json(res, 401)
                return
            token = res.get("token")
            cookie_hdr = {"Set-Cookie": f"mpsc_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"}
            self.send_json(res, 200, extra_headers=cookie_hdr)
            return

        # API: Auth - Logout
        if path == "/api/auth/logout":
            token = self._get_auth_token()
            if token and APP_DB:
                APP_DB.logout_user(token)
            cookie_hdr = {"Set-Cookie": "mpsc_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0"}
            self.send_json({"success": True, "message": "Logged out successfully"}, 200, extra_headers=cookie_hdr)
            return

        # API: Update Profile
        if path == "/api/profile":
            self.send_json({"success": True, "profile": body})
            return

        # API: Switch Target Cadre
        if path == "/api/profile/exam_cadre":
            cadre = body.get("exam_cadre", "mpsc_lda")
            self.send_json({"success": True, "exam_cadre": cadre})
            return

        # API: Active Recall Card Review Rating (SQLite Persistence)
        if path == "/api/recall/review":
            user = self._get_current_user()
            user_id = user["id"] if user else None
            rating = int(body.get("rating", 3)) # 1: Again, 2: Hard, 3: Good, 4: Easy
            card_id = body.get("card_id")
            category = body.get("category", "general")

            xp_by_rating = {1: 5, 2: 10, 3: 20, 4: 30}
            xp_gain = xp_by_rating.get(rating, 15)

            new_xp = 0
            if user_id and APP_DB:
                with APP_DB._get_conn() as conn:
                    cur = conn.cursor()
                    cur.execute("SELECT xp FROM user_gamification WHERE user_id = ?", (user_id,))
                    row = cur.fetchone()
                    cur_xp = row["xp"] if row else 0
                    new_xp = cur_xp + xp_gain
                    now = int(time.time())
                    cur.execute("""
                        INSERT INTO user_gamification (user_id, xp, updated_at) 
                        VALUES (?, ?, ?)
                        ON CONFLICT(user_id) DO UPDATE SET xp = ?, updated_at = ?
                    """, (user_id, new_xp, now, new_xp, now))
                    conn.commit()

            self.send_json({
                "success": True,
                "xp_gained": xp_gain,
                "total_xp": new_xp,
                "message": f"Recorded rating {rating} for card {card_id}"
            })
            return

        # API: Study Checkin
        if path == "/api/study/checkin":
            user = self._get_current_user()
            user_id = user["id"] if user else 1
            if APP_DB:
                prog = APP_DB.get_user_progress(user_id)
                prog["streak"] = prog.get("streak", 0) + 1
                prog["lastCompletedTs"] = int(time.time())
                APP_DB.save_user_progress(user_id, prog)
            self.send_json({"success": True, "message": "Checkin recorded"})
            return

        # API: Complete Practice Drill
        if path == "/api/study/complete_drill":
            user = self._get_current_user()
            user_id = user["id"] if user else 1
            subject = body.get("subject", "gk")
            count = int(body.get("count", 10))
            score = float(body.get("score", 0.0))
            time_spent = int(body.get("time_spent_sec", 0))
            if APP_DB:
                prog = APP_DB.get_user_progress(user_id)
                streak = prog.get("streak", 12) + 1
                lifetime = prog.get("lifetime", {"answered": 0, "correct": 0})
                lifetime["answered"] = lifetime.get("answered", 0) + count
                lifetime["correct"] = lifetime.get("correct", 0) + int(score)
                prog["streak"] = streak
                prog["lifetime"] = lifetime
                APP_DB.save_user_progress(user_id, prog)
            self.send_json({"success": True, "message": "Drill completed"})
            return

        # API: Complete Full Exam Attempt
        if path == "/api/exam/complete":
            user = self._get_current_user()
            user_id = user["id"] if user else 1
            attempt_id = None
            if APP_DB:
                attempt_data = {
                    "exam_title": body.get("exam_cadre", "MPSC LDA"),
                    "subject_key": body.get("category", "gk"),
                    "score": body.get("score", 0),
                    "total": body.get("total_questions", 10)
                }
                attempt_id = APP_DB.record_exam_attempt(user_id, attempt_data)
            self.send_json({"success": True, "attempt_id": attempt_id})
            return

        # API: Submit Quiz with Full Grading & Breakdown
        if path == "/api/exam/submit":
            user = self._get_current_user()
            user_id = user["id"] if user else 1
            cat_slug = body.get("category", "synonym")
            cat_name = body.get("category_name") or MPSC_CATEGORY_LOOKUP.get(cat_slug, {}).get("name", "Exam")
            answers = body.get("answers", {})
            questions = body.get("questions", [])
            time_taken = int(body.get("time_taken_seconds", 60))

            correct_count = 0
            wrong_count = 0
            skipped_count = 0
            reviewed_questions = []

            for q in questions:
                qid = str(q.get("id"))
                correct_idx = q.get("correct", 0)
                options = q.get("options", [])
                correct_letter = q.get("correct_letter") or chr(65 + correct_idx)

                user_ans = answers.get(qid)
                user_letter = None
                user_idx = None
                if user_ans is not None:
                    user_str = str(user_ans).upper().strip()
                    if user_str in ["A", "B", "C", "D"]:
                        user_letter = user_str
                        user_idx = ord(user_str) - ord("A")
                    elif str(user_ans).isdigit():
                        user_idx = int(user_ans)
                        user_letter = chr(65 + user_idx)

                is_correct = (user_letter == correct_letter) if user_letter else False
                if user_letter is None:
                    skipped_count += 1
                elif is_correct:
                    correct_count += 1
                else:
                    wrong_count += 1

                reviewed_questions.append({
                    "id": qid,
                    "question": q.get("question", ""),
                    "options": options,
                    "correct": correct_idx,
                    "correct_letter": correct_letter,
                    "user_answer": user_letter,
                    "user_idx": user_idx,
                    "is_correct": is_correct,
                    "is_skipped": (user_letter is None),
                    "explanation": q.get("explanation", "")
                })

            total = len(questions) or (correct_count + wrong_count + skipped_count) or 1
            score_percent = round((correct_count / total) * 100)
            accuracy = score_percent

            attempt_id = 0
            new_streak = 12
            if APP_DB:
                attempt_id = APP_DB.record_exam_attempt(user_id, {
                    "exam_title": cat_name,
                    "subject_key": cat_slug,
                    "score": correct_count,
                    "total": total
                })
                prog = APP_DB.get_user_progress(user_id)
                new_streak = prog.get("streak", 12) + 1
                prog["streak"] = new_streak
                lifetime = prog.get("lifetime", {"answered": 0, "correct": 0})
                lifetime["answered"] = lifetime.get("answered", 0) + total
                lifetime["correct"] = lifetime.get("correct", 0) + correct_count
                prog["lifetime"] = lifetime
                APP_DB.save_user_progress(user_id, prog)

            minutes = time_taken // 60
            seconds = time_taken % 60
            time_formatted = f"{minutes:02d}:{seconds:02d}"

            self.send_json({
                "success": True,
                "attempt_id": attempt_id,
                "category": cat_slug,
                "category_name": cat_name,
                "score_percent": score_percent,
                "accuracy": accuracy,
                "correct_answers": correct_count,
                "wrong_answers": wrong_count,
                "skipped": skipped_count,
                "total_questions": total,
                "time_taken_seconds": time_taken,
                "time_formatted": time_formatted,
                "percentile": max(5, min(99, score_percent + 2)),
                "streak_days": new_streak,
                "reviewed_questions": reviewed_questions
            })
            return

        # API: Generate Questions via Gemini
        if path == "/api/questions/generate":
            self._handle_generate_questions(body)
            return

        # API: Award XP
        if path == "/api/gamification/xp":
            user = self._get_current_user()
            user_id = user["id"] if user else 1
            amount = int(body.get("amount", 10))
            if APP_DB:
                g = APP_DB.get_user_gamification(user_id)
                new_xp = g.get("xp", 1240) + amount
                new_level = max(1, new_xp // 300 + 1)
                g["xp"] = new_xp
                g["level"] = new_level
                APP_DB.save_user_gamification(user_id, g)
                self.send_json({"success": True, "result": {"xp": new_xp, "level": new_level}})
            else:
                self.send_json({"success": True, "result": {"xp": 1250, "level": 4}})
            return

        # Gemini Proxy POST /v1/*
        if path.startswith("/v1/"):
            endpoint = path[3:]
            if parsed.query:
                endpoint += f"?{parsed.query}"
            resp = self._call_gemini(endpoint, payload=body, method="POST")
            self.send_json(resp)
            return

        self.send_json({"error": f"Path not found: {path}"}, 404)

    # ------------------- INTERNAL HANDLERS -------------------
    def _serve_file(self, filepath):
        try:
            with open(filepath, "rb") as f:
                content = f.read()
            mime = "application/octet-stream"
            if filepath.endswith(".html"):
                mime = "text/html; charset=utf-8"
            elif filepath.endswith(".css"):
                mime = "text/css; charset=utf-8"
            elif filepath.endswith(".js"):
                mime = "application/javascript; charset=utf-8"
            elif filepath.endswith(".png"):
                mime = "image/png"
            elif filepath.endswith(".svg"):
                mime = "image/svg+xml"
            elif filepath.endswith(".json"):
                mime = "application/json"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def _handle_status(self):
        start_t = time.time()
        gemini_status = "offline"
        gemini_models = []
        latency_ms = None

        test_resp = self._call_gemini("/models", method="GET", timeout=3)
        if isinstance(test_resp, dict) and not test_resp.get("_error"):
            gemini_status = "online"
            latency_ms = round((time.time() - start_t) * 1000, 1)
            raw_models = test_resp.get("data", [])
            gemini_models = [m.get("id") for m in raw_models if isinstance(m, dict)]

        hostname = socket.gethostname()
        local_ips = get_local_ips()
        q_stats = QUESTIONS_DB.get_all_stats() if QUESTIONS_DB else {}

        self.send_json({
            "status": "online",
            "server": "mission_lda_mac_server",
            "platform": "macOS",
            "version": VERSION,
            "host": hostname,
            "port": CONFIG["port"],
            "ips": local_ips,
            "active_model": CONFIG["default_model"],
            "database": {
                "engine": "SQLite",
                "app_db": os.path.join(CONFIG["data_dir"], "wkh_app.db"),
                "questions_db_dir": os.path.join(CONFIG["data_dir"], "questions"),
                "question_bank_stats": q_stats
            },
            "gemini_backend": {
                "url": CONFIG["gemini_url"],
                "status": gemini_status,
                "latency_ms": latency_ms,
                "models": gemini_models
            },
            "timestamp": int(time.time())
        })

    def _generate_gemini_questions(self, category_slug: str, count: int = 20) -> list:
        """Generate authentic MPSC LDA questions via Gemini AI on-the-fly and store in SQLite."""
        cat_info = MPSC_CATEGORY_LOOKUP.get(category_slug, {})
        domain_name = cat_info.get("name") or category_slug.replace("_", " ").title()

        if category_slug in ["mock", "all", "full"]:
            domain_name = "MPSC LDA Full Syllabus (General English, Meghalaya GK, Indian Polity, Science & Elementary Aptitude)"

        prompt = (
            f"You are the Chief Examination Master for Meghalaya Public Service Commission (MPSC LDA Cadre).\n"
            f"Generate exactly {count} authentic, challenging, high-yield multiple-choice questions for the domain: '{domain_name}'.\n"
            f"Requirements:\n"
            f"1. Each question must have exactly 4 distinct options.\n"
            f"2. Indicate correct answer index as an integer (0 for A, 1 for B, 2 for C, 3 for D).\n"
            f"3. Include an educational explanation.\n"
            f"4. Output MUST be ONLY a single valid raw JSON object without markdown fences, without conversational text, without tools.\n"
            f"Format:\n"
            f'{{"questions": [{{"id": 1, "text": "Question text here?", "options": ["Option 1", "Option 2", "Option 3", "Option 4"], "correct": 0, "explanation": "Detailed explanation here"}}]}}'
        )

        payload = {
            "model": CONFIG["default_model"],
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.3
        }

        resp = self._call_gemini("/chat/completions", payload=payload, method="POST", timeout=90)
        formatted = []
        if isinstance(resp, dict) and not resp.get("_error") and "choices" in resp:
            try:
                raw_text = resp["choices"][0]["message"]["content"]
                parsed = clean_json_response(raw_text)
                raw_qs = parsed.get("questions", [])
                for i, q in enumerate(raw_qs):
                    opts = list(q.get("options", []))
                    clean_opts = []
                    for o in opts:
                        cleaned = re.sub(r"^\(?[A-Da-d]\)?[.:\s]+", "", str(o)).strip()
                        clean_opts.append(cleaned)
                    while len(clean_opts) < 4:
                        clean_opts.append(f"Option {len(clean_opts)+1}")
                    c_idx = q.get("correct", 0)
                    if not isinstance(c_idx, int) or c_idx < 0 or c_idx > 3:
                        c_map = {"a": 0, "b": 1, "c": 2, "d": 3}
                        c_idx = c_map.get(str(c_idx).lower().strip(), 0)
                    formatted.append({
                        "id": f"gemini_{category_slug}_{i+1}_{int(time.time())}",
                        "question": q.get("text") or q.get("question", ""),
                        "options": clean_opts,
                        "correct": c_idx,
                        "correct_letter": chr(65 + c_idx),
                        "explanation": q.get("explanation", "") or f"Correct option is ({chr(65+c_idx)}): {clean_opts[c_idx]}",
                        "subtopic": domain_name,
                        "category": category_slug
                    })
            except Exception as e:
                print(f"Error parsing Gemini generated questions: {e}")

        # Strict requirement: Prompted Gemini AI questions ONLY (no preloaded questions)
        if not formatted:
            # One retry with slight temperature change if first parse failed
            payload["temperature"] = 0.5
            resp2 = self._call_gemini("/chat/completions", payload=payload, method="POST", timeout=90)
            if isinstance(resp2, dict) and not resp2.get("_error") and "choices" in resp2:
                try:
                    raw_text = resp2["choices"][0]["message"]["content"]
                    parsed = clean_json_response(raw_text)
                    raw_qs = parsed.get("questions", [])
                    for i, q in enumerate(raw_qs):
                        opts = list(q.get("options", []))
                        clean_opts = []
                        for o in opts:
                            cleaned = re.sub(r"^\(?[A-Da-d]\)?[.:\s]+", "", str(o)).strip()
                            clean_opts.append(cleaned)
                        while len(clean_opts) < 4:
                            clean_opts.append(f"Option {len(clean_opts)+1}")
                        c_idx = q.get("correct", 0)
                        if not isinstance(c_idx, int) or c_idx < 0 or c_idx > 3:
                            c_map = {"a": 0, "b": 1, "c": 2, "d": 3}
                            c_idx = c_map.get(str(c_idx).lower().strip(), 0)
                        formatted.append({
                            "id": f"gemini_{category_slug}_{i+1}_{int(time.time())}",
                            "question": q.get("text") or q.get("question", ""),
                            "options": clean_opts,
                            "correct": c_idx,
                            "correct_letter": chr(65 + c_idx),
                            "explanation": q.get("explanation", "") or f"Correct option is ({chr(65+c_idx)}): {clean_opts[c_idx]}",
                            "subtopic": domain_name,
                            "category": category_slug
                        })
                except Exception as e2:
                    print(f"Error on retry parsing Gemini questions: {e2}")

        # Store generated questions in SQLite database
        if formatted and QUESTIONS_DB:
            try:
                db_cat = normalize_category(category_slug)
                db_qs = []
                for fq in formatted:
                    opts = fq.get("options", [])
                    c_idx = fq.get("correct", 0)
                    c_letter = chr(97 + min(max(c_idx, 0), 3)) # 'a', 'b', 'c', or 'd'
                    db_qs.append({
                        "question": fq.get("question", ""),
                        "a": opts[0] if len(opts) > 0 else "",
                        "b": opts[1] if len(opts) > 1 else "",
                        "c": opts[2] if len(opts) > 2 else "",
                        "d": opts[3] if len(opts) > 3 else "",
                        "correct": c_letter,
                        "tip": fq.get("explanation", ""),
                        "topic": domain_name
                    })
                saved_count = QUESTIONS_DB.save_questions(db_cat, db_qs, topic=domain_name, model=CONFIG["default_model"])
                print(f"[SQL Database] Persisted {saved_count} newly generated questions into SQLite ({db_cat}.db)")
            except Exception as dbe:
                print(f"[SQL Database] Error persisting generated questions to SQLite: {dbe}")

        return formatted

    def _handle_generate_questions(self, body):
        category = normalize_category(body.get("category", "gk"))
        subtopic = body.get("subtopic", "General")
        cadre = body.get("exam_cadre", "mpsc_lda")
        count = int(body.get("count", 5))
        difficulty = body.get("difficulty", "standard")
        save_to_db = body.get("save_to_db", True)

        cadre_label = "MPSC Lower Division Assistant (Meghalaya State Cadre)" if cadre == "mpsc_lda" else "DSC West Khasi Hills District Cadre (LDA-cum-Typist)"

        system_instruction = (
            f"You are the Chief Examination Master for Meghalaya Administrative Services preparing authentic questions for {cadre_label}.\n"
            f"Subject Domain: {category.upper()} | Subtopic: {subtopic} | Difficulty: {difficulty}.\n"
            f"Output strictly valid JSON with no conversational text or thinking tags.\n"
            "Format: {\"questions\": [{\"id\": 1, \"text\": \"...\", \"options\": [\"A) ...\", \"B) ...\", \"C) ...\", \"D) ...\"], \"correct\": 0, \"explanation\": \"...\", \"subtopic\": \"...\"}]}"
        )

        user_prompt = f"Generate {count} high-quality, authentic multiple-choice questions for {category.upper()} focusing on '{subtopic}' for {cadre_label} examination. Mark scheme: +2.0 for correct, -0.5 for wrong."

        payload = {
            "model": CONFIG["default_model"],
            "messages": [
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.3
        }

        resp = self._call_gemini("/chat/completions", payload=payload, method="POST", timeout=120)

        if isinstance(resp, dict) and resp.get("_error"):
            self.send_json({
                "error": "Failed to contact Gemini backend",
                "details": resp
            }, 502)
            return

        try:
            raw_text = resp["choices"][0]["message"]["content"]
            parsed_data = clean_json_response(raw_text)
            questions = parsed_data.get("questions", [])

            saved_count = 0
            if save_to_db and QUESTIONS_DB and questions:
                saveable = []
                for q in questions:
                    opts = q.get("options", [])
                    c_idx = q.get("correct", 0)
                    c_letter = ["a", "b", "c", "d"][c_idx] if isinstance(c_idx, int) and 0 <= c_idx < 4 else "a"
                    saveable.append({
                        "q": q.get("text") or q.get("question"),
                        "a": opts[0] if len(opts) > 0 else "",
                        "b": opts[1] if len(opts) > 1 else "",
                        "c": opts[2] if len(opts) > 2 else "",
                        "d": opts[3] if len(opts) > 3 else "",
                        "correct": c_letter,
                        "tip": q.get("explanation", ""),
                        "topic": subtopic
                    })
                saved_count = QUESTIONS_DB.save_questions(
                    category, saveable, topic=subtopic, model=CONFIG["default_model"]
                )

            self.send_json({
                "success": True,
                "category": category,
                "subtopic": subtopic,
                "generated_count": len(questions),
                "saved_to_sql": saved_count,
                "questions": questions
            })
        except Exception as e:
            self.send_json({
                "error": f"Error parsing model questions response: {str(e)}",
                "raw_preview": raw_text[:400] if "raw_text" in locals() else None
            }, 500)


def ensure_gemini_backend():
    """Ensure gemini_web2api.py daemon is active on port 8081."""
    parsed = urllib.parse.urlparse(CONFIG["gemini_url"])
    port = parsed.port or 8081
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/")
        with urllib.request.urlopen(req, timeout=1):
            return
    except Exception:
        gemini_script = os.path.join(BASE_DIR, "gemini_web2api.py")
        if os.path.isfile(gemini_script):
            try:
                print(f"  🚀 Launching local gemini_web2api daemon on port {port}...")
                subprocess.Popen(
                    [sys.executable, gemini_script, "--port", str(port)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True
                )
                time.sleep(2)
            except Exception as e:
                print(f"  ⚠️ Could not auto-start gemini_web2api.py: {e}")


def main():
    global APP_DB, QUESTIONS_DB

    parser = argparse.ArgumentParser(
        description="macOS Server & API Bridge for Mission LDA Exam Platform"
    )
    parser.add_argument("--host", default=DEFAULT_CONFIG["host"], help="Interface to bind (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=DEFAULT_CONFIG["port"], help="Port to listen on (default: 8080)")
    parser.add_argument("--gemini-url", default=DEFAULT_CONFIG["gemini_url"], help="Gemini base URL (default: http://127.0.0.1:8081/v1)")
    parser.add_argument("--gemini-port", type=int, default=None, help="Gemini backend port (default: 8081)")
    parser.add_argument("--gemini-key", default=DEFAULT_CONFIG["gemini_key"], help="Gemini API Key (default: sk-gemini)")
    parser.add_argument("--model", "--default-model", dest="model", default=DEFAULT_CONFIG["default_model"], help="Gemini Model (default: gemini-3.6-flash)")
    parser.add_argument("--data-dir", default=DEFAULT_CONFIG["data_dir"], help="Data directory")
    args = parser.parse_args()

    CONFIG["host"] = args.host
    CONFIG["port"] = args.port
    CONFIG["gemini_url"] = args.gemini_url
    if args.gemini_port is not None:
        CONFIG["gemini_url"] = f"http://127.0.0.1:{args.gemini_port}/v1"
    CONFIG["gemini_key"] = args.gemini_key
    CONFIG["default_model"] = args.model
    CONFIG["data_dir"] = os.path.abspath(args.data_dir)

    os.makedirs(CONFIG["data_dir"], exist_ok=True)
    os.makedirs(os.path.join(CONFIG["data_dir"], "questions"), exist_ok=True)
    os.makedirs(CONFIG["web_dir"], exist_ok=True)
    os.makedirs(CONFIG["static_dir"], exist_ok=True)

    # Ensure local Gemini backend daemon
    ensure_gemini_backend()

    # Initialize SQL Databases
    app_db_path = os.path.join(CONFIG["data_dir"], "wkh_app.db")
    questions_dir = os.path.join(CONFIG["data_dir"], "questions")
    APP_DB = db.AppDatabase(app_db_path)
    QUESTIONS_DB = db.QuestionsDatabaseManager(questions_dir)

    server = ThreadedHTTPServer((CONFIG["host"], CONFIG["port"]), MissionLDAServerHandler)

    ips = get_local_ips()
    q_stats = QUESTIONS_DB.get_all_stats()

    print("=" * 70)
    print(f"  🏛️  Mission LDA Exam Platform v{VERSION} (macOS Native)")
    print(f"  Target Cadres: MPSC LDA & DSC West Khasi Hills")
    print(f"  Zero External Dependencies · Native SQLite Engine Active")
    print("=" * 70)
    print(f"  Local Web App:         http://localhost:{CONFIG['port']}")
    for ip in ips:
        if ip != "127.0.0.1":
            print(f"  LAN Access (iPhone/iPad): http://{ip}:{CONFIG['port']}")
    print(f"  Gemini Backend:        {CONFIG['gemini_url']} ({CONFIG['default_model']})")
    print(f"  Candidate DB:          {app_db_path}")
    print(f"  Question Banks:        {questions_dir}/ ({q_stats.get('total_questions', 0)} questions)")
    print(f"  Legacy Interface:      http://localhost:{CONFIG['port']}/legacy")
    print("=" * 70)
    print("  Server is listening. Press Ctrl+C to halt.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Mission LDA server gracefully...")
        server.server_close()


if __name__ == "__main__":
    main()
