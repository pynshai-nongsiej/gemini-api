#!/usr/bin/env python3
"""
db.py - SQLite Database Management Layer for DSC West Khasi Hills LDA Prep
Handles:
1. User authentication & sessions (PBKDF2-HMAC-SHA256 password hashing with salt).
2. User progress & full exam attempt history.
3. Category-specific question databases (data/questions/<category>.db).
Zero external dependencies - standard library sqlite3, hashlib, secrets only.
"""

import os
import re
import sqlite3
import hashlib
import secrets
import json
import time

VALID_CATEGORIES = ["gk", "english", "math", "computer", "science", "reasoning"]

def hash_password(password: str, salt: str = None) -> tuple:
    """Hash password using PBKDF2-HMAC-SHA256 with 100,000 iterations."""
    if not salt:
        salt = secrets.token_hex(16)
    pwd_bytes = password.encode("utf-8")
    salt_bytes = salt.encode("utf-8")
    pwd_hash = hashlib.pbkdf2_hmac("sha256", pwd_bytes, salt_bytes, 100000).hex()
    return pwd_hash, salt

def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    """Verify password against stored salt and expected hash."""
    pwd_bytes = password.encode("utf-8")
    salt_bytes = salt.encode("utf-8")
    computed_hash = hashlib.pbkdf2_hmac("sha256", pwd_bytes, salt_bytes, 100000).hex()
    return secrets.compare_digest(computed_hash, expected_hash)


class AppDatabase:
    """Manages users, authentication sessions, user progress, and exam history."""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        self._init_db()

    def _get_conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_db(self):
        with self._get_conn() as conn:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                last_login INTEGER
            );

            CREATE TABLE IF NOT EXISTS user_sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_progress (
                user_id INTEGER PRIMARY KEY,
                current_day INTEGER DEFAULT 1,
                streak INTEGER DEFAULT 0,
                last_completed_ts INTEGER,
                lifetime_answered INTEGER DEFAULT 0,
                lifetime_correct INTEGER DEFAULT 0,
                by_subject_json TEXT DEFAULT '{}',
                completed_json TEXT DEFAULT '{}',
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_exam_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                exam_title TEXT NOT NULL,
                subject_key TEXT,
                day_num INTEGER,
                score INTEGER NOT NULL,
                total INTEGER NOT NULL,
                accuracy REAL NOT NULL,
                submitted_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_gamification (
                user_id INTEGER PRIMARY KEY,
                xp INTEGER DEFAULT 0,
                level INTEGER DEFAULT 1,
                rank_title TEXT DEFAULT 'Recruit Typist',
                streak_count INTEGER DEFAULT 0,
                streak_shields INTEGER DEFAULT 1,
                highest_combo INTEGER DEFAULT 0,
                badges_json TEXT DEFAULT '[]',
                bounties_json TEXT DEFAULT '{}',
                stats_json TEXT DEFAULT '{}',
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token);
            CREATE INDEX IF NOT EXISTS idx_attempts_user ON user_exam_attempts(user_id);
            """)

    def register_user(self, username: str, password: str) -> dict:
        """Register a new user with username and password only."""
        username = username.strip()
        if not username or len(username) < 3:
            return {"error": "Username must be at least 3 characters"}
        if not password or len(password) < 4:
            return {"error": "Password must be at least 4 characters"}

        pwd_hash, salt = hash_password(password)
        now = int(time.time())

        try:
            with self._get_conn() as conn:
                cur = conn.cursor()
                cur.execute(
                    "INSERT INTO users (username, password_hash, salt, created_at, last_login) VALUES (?, ?, ?, ?, ?)",
                    (username, pwd_hash, salt, now, now)
                )
                user_id = cur.lastrowid
                
                # Initialize default progress
                cur.execute(
                    """INSERT INTO user_progress 
                       (user_id, current_day, streak, last_completed_ts, lifetime_answered, lifetime_correct, by_subject_json, completed_json, updated_at)
                       VALUES (?, 1, 0, NULL, 0, 0, '{}', '{}', ?)""",
                    (user_id, now)
                )
                
                # Create session token
                token = secrets.token_hex(32)
                expires_at = now + (30 * 24 * 3600)  # 30 days session
                cur.execute(
                    "INSERT INTO user_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                    (token, user_id, now, expires_at)
                )
                conn.commit()

            return {
                "success": True,
                "token": token,
                "user": {"id": user_id, "username": username, "created_at": now},
                "progress": self.get_user_progress(user_id)
            }
        except sqlite3.IntegrityError:
            return {"error": "Username is already registered. Please choose another or log in."}
        except Exception as e:
            return {"error": f"Registration failed: {str(e)}"}

    def login_user(self, username: str, password: str) -> dict:
        """Authenticate user with username and password only."""
        username = username.strip()
        if not username or not password:
            return {"error": "Username and password required"}

        with self._get_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id, username, password_hash, salt, created_at FROM users WHERE username = ?", (username,))
            row = cur.fetchone()
            if not row:
                return {"error": "Invalid username or password"}

            user_id = row["id"]
            if not verify_password(password, row["salt"], row["password_hash"]):
                return {"error": "Invalid username or password"}

            now = int(time.time())
            cur.execute("UPDATE users SET last_login = ? WHERE id = ?", (now, user_id))

            token = secrets.token_hex(32)
            expires_at = now + (30 * 24 * 3600)
            cur.execute(
                "INSERT INTO user_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (token, user_id, now, expires_at)
            )
            conn.commit()

        return {
            "success": True,
            "token": token,
            "user": {"id": user_id, "username": row["username"], "created_at": row["created_at"]},
            "progress": self.get_user_progress(user_id)
        }

    def get_user_by_token(self, token: str) -> dict:
        """Resolve a session token to user information."""
        if not token:
            return None
        now = int(time.time())
        with self._get_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT u.id, u.username, u.created_at, u.last_login 
                FROM user_sessions s
                JOIN users u ON s.user_id = u.id
                WHERE s.token = ? AND s.expires_at > ?
            """, (token, now))
            row = cur.fetchone()
            if row:
                return dict(row)
        return None

    def logout_user(self, token: str):
        """Invalidate session token."""
        if not token:
            return
        with self._get_conn() as conn:
            conn.execute("DELETE FROM user_sessions WHERE token = ?", (token,))

    def revoke_session(self, token: str):
        """Alias for logout_user."""
        return self.logout_user(token)

    def get_leaderboard(self, current_user_id: int = None, limit: int = 50) -> list:
        """Fetch real leaderboard rankings computed from registered users in SQLite."""
        with self._get_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT 
                    u.id,
                    u.username,
                    COALESCE(p.streak, 0) as streak_days,
                    COUNT(a.id) as total_attempts,
                    COALESCE(SUM(a.score), 0) as total_correct,
                    COALESCE(SUM(a.total), 0) as total_questions,
                    COALESCE(g.xp, 0) as gamification_xp
                FROM users u
                LEFT JOIN user_progress p ON u.id = p.user_id
                LEFT JOIN user_exam_attempts a ON u.id = a.user_id
                LEFT JOIN user_gamification g ON u.id = g.user_id
                GROUP BY u.id
            """)
            rows = cur.fetchall()

        avatar_palettes = [
            "bg:#ffe08b;hair:long;face:happy;glasses:0",
            "bg:#cae6ff;hair:short;face:nerd;glasses:1",
            "bg:#d0f4de;hair:cap;face:focused;glasses:0",
            "bg:#e2dfff;hair:short;face:happy;glasses:1",
            "bg:#ffdad6;hair:long;face:focused;glasses:0",
            "bg:#cae6ff;hair:short;face:happy;glasses:0",
            "bg:#ffe08b;hair:headband;face:happy;glasses:1",
            "bg:#d0f4de;hair:grad;face:nerd;glasses:1"
        ]

        entries = []
        for r in rows:
            u_id = r["id"]
            uname = r["username"]
            streak = r["streak_days"] or 0
            attempts = r["total_attempts"] or 0
            correct = r["total_correct"] or 0
            total_q = r["total_questions"] or 0
            acc = round((correct * 100.0) / total_q, 1) if total_q > 0 else 0.0
            
            # Real score: 10 pts per correct answer, 25 pts per completed test, 50 pts per streak day
            calculated_pts = (correct * 10) + (attempts * 25) + (streak * 50)
            points = max(calculated_pts, r["gamification_xp"] or 0)
            avatar_cfg = avatar_palettes[u_id % len(avatar_palettes)]

            entries.append({
                "id": u_id,
                "username": uname,
                "avatar_url": avatar_cfg,
                "streak_days": streak,
                "points": points,
                "accuracy": acc,
                "total_attempts": attempts,
                "is_current": bool(current_user_id and u_id == current_user_id)
            })

        # Sort strictly by points DESC, then accuracy DESC, then streak DESC
        entries.sort(key=lambda x: (x["points"], x["accuracy"], x["streak_days"]), reverse=True)

        # Assign ranks
        for idx, entry in enumerate(entries):
            entry["rank"] = idx + 1

        return entries[:limit]

    def get_user_progress(self, user_id: int) -> dict:
        """Get formatted user progress dict matching the frontend schema."""
        with self._get_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT current_day, streak, last_completed_ts, lifetime_answered, lifetime_correct, by_subject_json, completed_json
                FROM user_progress WHERE user_id = ?
            """, (user_id,))
            row = cur.fetchone()
            if not row:
                return {
                    "currentDay": 1,
                    "streak": 0,
                    "lastCompletedTs": None,
                    "completed": {},
                    "lifetime": {"answered": 0, "correct": 0},
                    "bySubject": {
                        "gk": {"a": 0, "c": 0},
                        "english": {"a": 0, "c": 0},
                        "math": {"a": 0, "c": 0},
                        "computer": {"a": 0, "c": 0},
                        "science": {"a": 0, "c": 0},
                        "reasoning": {"a": 0, "c": 0}
                    }
                }

            by_subj = json.loads(row["by_subject_json"] or "{}")
            for k in VALID_CATEGORIES:
                if k not in by_subj:
                    by_subj[k] = {"a": 0, "c": 0}

            completed = json.loads(row["completed_json"] or "{}")

            return {
                "currentDay": row["current_day"] or 1,
                "streak": row["streak"] or 0,
                "lastCompletedTs": row["last_completed_ts"],
                "completed": completed,
                "lifetime": {
                    "answered": row["lifetime_answered"] or 0,
                    "correct": row["lifetime_correct"] or 0
                },
                "bySubject": by_subj
            }

    def save_user_progress(self, user_id: int, progress_data: dict) -> bool:
        """Save progress dictionary for a given user."""
        current_day = progress_data.get("currentDay", 1)
        streak = progress_data.get("streak", 0)
        last_completed_ts = progress_data.get("lastCompletedTs")
        lifetime = progress_data.get("lifetime", {})
        lifetime_answered = lifetime.get("answered", 0)
        lifetime_correct = lifetime.get("correct", 0)
        by_subj_json = json.dumps(progress_data.get("bySubject", {}), ensure_ascii=False)
        completed_json = json.dumps(progress_data.get("completed", {}), ensure_ascii=False)
        now = int(time.time())

        with self._get_conn() as conn:
            conn.execute("""
                INSERT INTO user_progress (user_id, current_day, streak, last_completed_ts, lifetime_answered, lifetime_correct, by_subject_json, completed_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    current_day = excluded.current_day,
                    streak = excluded.streak,
                    last_completed_ts = excluded.last_completed_ts,
                    lifetime_answered = excluded.lifetime_answered,
                    lifetime_correct = excluded.lifetime_correct,
                    by_subject_json = excluded.by_subject_json,
                    completed_json = excluded.completed_json,
                    updated_at = excluded.updated_at
            """, (user_id, current_day, streak, last_completed_ts, lifetime_answered, lifetime_correct, by_subj_json, completed_json, now))
        return True

    def record_exam_attempt(self, user_id: int, attempt: dict) -> int:
        """Record an exam attempt in SQL."""
        title = attempt.get("exam_title") or attempt.get("title") or "Practice Drill"
        subject_key = attempt.get("subject_key") or attempt.get("subjectKey")
        day_num = attempt.get("day_num") or attempt.get("dayNum")
        score = int(attempt.get("score", 0))
        total = int(attempt.get("total", 0))
        accuracy = round((score / total * 100), 1) if total > 0 else 0.0
        now = int(time.time())

        with self._get_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO user_exam_attempts (user_id, exam_title, subject_key, day_num, score, total, accuracy, submitted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (user_id, title, subject_key, day_num, score, total, accuracy, now))
            return cur.lastrowid

    def get_user_attempts(self, user_id: int, limit: int = 50) -> list:
        """Retrieve recent exam attempts for user."""
        with self._get_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, exam_title, subject_key, day_num, score, total, accuracy, submitted_at
                FROM user_exam_attempts
                WHERE user_id = ?
                ORDER BY submitted_at DESC
                LIMIT ?
            """, (user_id, limit))
            return [dict(r) for r in cur.fetchall()]

    def get_user_gamification(self, user_id: int) -> dict:
        """Get candidate gamification profile (XP, level, rank, streak shields, badges)."""
        with self._get_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT xp, level, rank_title, streak_count, streak_shields, highest_combo, badges_json, bounties_json, stats_json, updated_at
                FROM user_gamification WHERE user_id = ?
            """, (user_id,))
            row = cur.fetchone()
            if not row:
                return {
                    "xp": 0,
                    "level": 1,
                    "rankTitle": "Recruit Typist",
                    "streakCount": 0,
                    "streakShields": 1,
                    "highestCombo": 0,
                    "badges": [],
                    "bounties": {},
                    "stats": {}
                }
            try:
                badges = json.loads(row["badges_json"])
            except Exception:
                badges = []
            try:
                bounties = json.loads(row["bounties_json"])
            except Exception:
                bounties = {}
            try:
                stats = json.loads(row["stats_json"])
            except Exception:
                stats = {}

            return {
                "xp": row["xp"] or 0,
                "level": row["level"] or 1,
                "rankTitle": row["rank_title"] or "Recruit Typist",
                "streakCount": row["streak_count"] or 0,
                "streakShields": row["streak_shields"] if row["streak_shields"] is not None else 1,
                "highestCombo": row["highest_combo"] or 0,
                "badges": badges,
                "bounties": bounties,
                "stats": stats
            }

    def save_user_gamification(self, user_id: int, data: dict) -> bool:
        """Persist candidate gamification profile."""
        xp = int(data.get("xp", 0))
        level = int(data.get("level", 1))
        rank_title = str(data.get("rankTitle", "Recruit Typist"))
        streak_count = int(data.get("streakCount", 0))
        streak_shields = int(data.get("streakShields", 1))
        highest_combo = int(data.get("highestCombo", 0))
        badges_json = json.dumps(data.get("badges", []), ensure_ascii=False)
        bounties_json = json.dumps(data.get("bounties", {}), ensure_ascii=False)
        stats_json = json.dumps(data.get("stats", {}), ensure_ascii=False)
        now = int(time.time())

        with self._get_conn() as conn:
            conn.execute("""
                INSERT INTO user_gamification (user_id, xp, level, rank_title, streak_count, streak_shields, highest_combo, badges_json, bounties_json, stats_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    xp = excluded.xp,
                    level = excluded.level,
                    rank_title = excluded.rank_title,
                    streak_count = excluded.streak_count,
                    streak_shields = excluded.streak_shields,
                    highest_combo = excluded.highest_combo,
                    badges_json = excluded.badges_json,
                    bounties_json = excluded.bounties_json,
                    stats_json = excluded.stats_json,
                    updated_at = excluded.updated_at
            """, (user_id, xp, level, rank_title, streak_count, streak_shields, highest_combo, badges_json, bounties_json, stats_json, now))
        return True


class QuestionsDatabaseManager:
    """
    Manages dedicated category-specific question databases:
    data/questions/<category>.db (e.g. gk.db, english.db, math.db, computer.db, science.db, reasoning.db)
    """

    def __init__(self, questions_dir: str):
        self.questions_dir = questions_dir
        os.makedirs(self.questions_dir, exist_ok=True)
        for cat in VALID_CATEGORIES:
            self._init_category_db(cat)
        self._seed_initial_questions()

    def _get_db_path(self, category: str) -> str:
        cat = category.lower().strip()
        if cat not in VALID_CATEGORIES:
            cat = "gk"
        return os.path.join(self.questions_dir, f"{cat}.db")

    def _get_conn(self, category: str):
        db_path = self._get_db_path(category)
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_category_db(self, category: str):
        with self._get_conn(category) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS questions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    q_hash TEXT UNIQUE NOT NULL,
                    question TEXT NOT NULL,
                    option_a TEXT NOT NULL,
                    option_b TEXT NOT NULL,
                    option_c TEXT NOT NULL,
                    option_d TEXT NOT NULL,
                    correct_option TEXT NOT NULL,
                    tip TEXT,
                    topic TEXT,
                    model TEXT,
                    created_at INTEGER NOT NULL,
                    times_used INTEGER DEFAULT 0
                );
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_q_topic ON questions(topic);")

    def _hash_question(self, q_text: str) -> str:
        # Strict alphanumeric normalization to avoid duplicates differing by punctuation, case or spaces
        clean = re.sub(r'[^a-zA-Z0-9]', '', q_text).lower()
        return hashlib.sha256(clean.encode("utf-8")).hexdigest()

    def save_questions(self, category: str, questions: list, topic: str = "General", model: str = "seed") -> int:
        """
        Insert questions into the category's specific database file.
        Strictly deduplicates questions using unique question hash (INSERT OR IGNORE).
        Returns the count of newly inserted unique questions.
        """
        category = category.lower().strip()
        if category not in VALID_CATEGORIES:
            category = "gk"
        
        now = int(time.time())
        inserted = 0

        with self._get_conn(category) as conn:
            cur = conn.cursor()
            for q in questions:
                if not isinstance(q, dict):
                    continue
                q_text = q.get("q") or q.get("question")
                opt_a = q.get("a") or q.get("option_a")
                opt_b = q.get("b") or q.get("option_b")
                opt_c = q.get("c") or q.get("option_c")
                opt_d = q.get("d") or q.get("option_d")
                correct = (q.get("correct") or q.get("correct_option") or "").strip().lower()
                tip = q.get("tip") or ""
                q_topic = q.get("topic") or topic

                if not (q_text and opt_a and opt_b and opt_c and opt_d and correct in ["a", "b", "c", "d"]):
                    continue

                q_hash = self._hash_question(q_text)
                cur.execute("""
                    INSERT OR IGNORE INTO questions (q_hash, question, option_a, option_b, option_c, option_d, correct_option, tip, topic, model, created_at, times_used)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                """, (q_hash, q_text.strip(), opt_a.strip(), opt_b.strip(), opt_c.strip(), opt_d.strip(), correct, tip.strip(), q_topic, model, now))
                if cur.rowcount > 0:
                    inserted += 1
            conn.commit()

        return inserted

    def get_questions(self, category: str, topic: str = None, limit: int = 50, random_order: bool = False) -> list:
        """Fetch questions from a specific category database."""
        category = category.lower().strip()
        if category not in VALID_CATEGORIES:
            category = "gk"

        order_by = "RANDOM()" if random_order else "id DESC"
        with self._get_conn(category) as conn:
            cur = conn.cursor()
            if topic and topic.strip():
                cur.execute(f"""
                    SELECT id, question, option_a, option_b, option_c, option_d, correct_option, tip, topic, created_at
                    FROM questions
                    WHERE topic LIKE ?
                    ORDER BY {order_by}
                    LIMIT ?
                """, (f"%{topic.strip()}%", limit))
            else:
                cur.execute(f"""
                    SELECT id, question, option_a, option_b, option_c, option_d, correct_option, tip, topic, created_at
                    FROM questions
                    ORDER BY {order_by}
                    LIMIT ?
                """, (limit,))
            rows = cur.fetchall()

            result = []
            for r in rows:
                result.append({
                    "id": r["id"],
                    "q": r["question"],
                    "a": r["option_a"],
                    "b": r["option_b"],
                    "c": r["option_c"],
                    "d": r["option_d"],
                    "correct": r["correct_option"],
                    "tip": r["tip"],
                    "topic": r["topic"],
                    "category": category
                })
            return result

    def get_all_stats(self) -> dict:
        """Return question counts and file sizes across all category databases."""
        stats = {}
        total = 0
        for cat in VALID_CATEGORIES:
            db_path = self._get_db_path(cat)
            count = 0
            size_bytes = 0
            if os.path.exists(db_path):
                size_bytes = os.path.getsize(db_path)
                try:
                    with self._get_conn(cat) as conn:
                        cur = conn.cursor()
                        cur.execute("SELECT COUNT(*) FROM questions")
                        count = cur.fetchone()[0]
                except Exception:
                    count = 0
            stats[cat] = {
                "count": count,
                "database_file": f"{cat}.db",
                "size_bytes": size_bytes
            }
            total += count
        stats["total_questions"] = total
        return stats

    def _seed_initial_questions(self):
        """Seed authentic curated DSC West Khasi Hills LDA questions if database is fresh."""
        stats = self.get_all_stats()
        if stats.get("total_questions", 0) > 0:
            return

        gk_qs = [
            {
                "q": "Which town serves as the administrative district headquarters of West Khasi Hills, Meghalaya?",
                "a": "Mairang", "b": "Nongstoin", "c": "Mawkyrwat", "d": "Resubelpara",
                "correct": "b", "tip": "Nongstoin is the headquarters of West Khasi Hills district.",
                "topic": "West Khasi Hills Local Knowledge (Nongstoin, Mawkyrwat)"
            },
            {
                "q": "The famous Langshiang Falls is situated on which river in West Khasi Hills district?",
                "a": "Kynshi River", "b": "Umiam River", "c": "Myntdu River", "d": "Simsang River",
                "correct": "a", "tip": "Langshiang Falls is formed by the Kynshi River.",
                "topic": "Meghalaya Geography, Districts & Rivers"
            },
            {
                "q": "In which year was Meghalaya conferred full statehood under the North Eastern Areas (Reorganisation) Act?",
                "a": "1970", "b": "1971", "c": "1972", "d": "1975",
                "correct": "c", "tip": "Meghalaya became a full-fledged state on 21 January 1972.",
                "topic": "Meghalaya History, Culture & Festivals"
            },
            {
                "q": "Who was the legendary Khasi freedom fighter and Syiem of Nongkhlaw who resisted British occupation?",
                "a": "U Kiang Nangbah", "b": "U Tirot Sing Syiem", "c": "Pa Togan Sangma", "d": "Babu Jeebon Roy",
                "correct": "b", "tip": "U Tirot Sing Syiem fought the Anglo-Khasi War (1829-1833).",
                "topic": "Meghalaya History, Culture & Festivals"
            },
            {
                "q": "Under the Indian Constitution, the administration of tribal areas in Meghalaya is governed under which Schedule?",
                "a": "Fifth Schedule", "b": "Sixth Schedule", "c": "Seventh Schedule", "d": "Eighth Schedule",
                "correct": "b", "tip": "The Sixth Schedule governs autonomous district councils in Meghalaya.",
                "topic": "Indian Polity & Constitution"
            }
        ]
        self.save_questions("gk", gk_qs, topic="Meghalaya & West Khasi Hills", model="curated-seed")

        english_qs = [
            {
                "q": "Choose the correct preposition: 'The Deputy Commissioner presided _____ the DSC review meeting.'",
                "a": "on", "b": "over", "c": "at", "d": "with",
                "correct": "b", "tip": "'Preside over' is the standard administrative preposition.",
                "topic": "Prepositions, Articles & Sentence Correction"
            },
            {
                "q": "Identify the synonym for the word 'METICULOUS' commonly required in official file drafting:",
                "a": "Careless", "b": "Painstaking and precise", "c": "Sluggish", "d": "Hastened",
                "correct": "b", "tip": "Meticulous means showing great attention to detail.",
                "topic": "Vocabulary — Synonyms & Antonyms"
            },
            {
                "q": "Choose the correctly punctuated sentence suitable for government correspondence:",
                "a": "The applicants documents were verified yesterday.",
                "b": "The applicant's documents were verified yesterday.",
                "c": "The applicants's documents were verified yesterday.",
                "d": "The applicants document's were verified yesterday.",
                "correct": "b", "tip": "Singular possessive uses apostrophe before 's'.",
                "topic": "Grammar — Parts of Speech & Sentence Structure"
            },
            {
                "q": "What is the one-word substitution for: 'A written declaration made solemnly under oath before an authorized magistrate'?",
                "a": "Affidavit", "b": "Memorandum", "c": "Gazette", "d": "Minutes",
                "correct": "a", "tip": "An affidavit is a sworn statement under oath.",
                "topic": "Vocabulary — One-word Substitution & Word Pairs"
            }
        ]
        self.save_questions("english", english_qs, topic="General English & Official Drafting", model="curated-seed")

        math_qs = [
            {
                "q": "If 12 clerks can process 240 files in 4 days, how many files can 8 clerks process in 6 days at the same rate?",
                "a": "200", "b": "240", "c": "280", "d": "320",
                "correct": "b", "tip": "Rate = 240/(12*4) = 5 files/clerk/day. 8 * 6 * 5 = 240 files.",
                "topic": "Time & Work"
            },
            {
                "q": "A government office purchased stationery worth Rs. 4,500 after a trade discount of 10%. What was the original catalog price?",
                "a": "Rs. 4,950", "b": "Rs. 5,000", "c": "Rs. 5,200", "d": "Rs. 5,500",
                "correct": "b", "tip": "Original Price = 4500 / 0.90 = Rs. 5,000.",
                "topic": "Percentage, Profit & Loss"
            },
            {
                "q": "Find the simple interest on Rs. 15,000 at 6% per annum for 3 years:",
                "a": "Rs. 2,400", "b": "Rs. 2,700", "c": "Rs. 3,000", "d": "Rs. 3,200",
                "correct": "b", "tip": "SI = (15000 * 6 * 3) / 100 = Rs. 2,700.",
                "topic": "Simple & Compound Interest"
            }
        ]
        self.save_questions("math", math_qs, topic="Elementary Mathematics", model="curated-seed")

        computer_qs = [
            {
                "q": "In Microsoft Excel, which function key is standardly used to edit the active cell or formula?",
                "a": "F1", "b": "F2", "c": "F4", "d": "F7",
                "correct": "b", "tip": "F2 allows editing directly inside an active spreadsheet cell.",
                "topic": "MS Word & Excel Essentials for Office Work"
            },
            {
                "q": "What is the primary function of an Operating System (OS) in office computing?",
                "a": "Creating spreadsheets only",
                "b": "Managing computer hardware, memory and executing software",
                "c": "Connecting to electrical power",
                "d": "Designing official logos",
                "correct": "b", "tip": "An OS acts as the bridge between hardware and software.",
                "topic": "Windows OS, Security & File Management"
            },
            {
                "q": "Which keyboard shortcut in MS Word aligns paragraph text to both left and right margins (Justify)?",
                "a": "Ctrl + J", "b": "Ctrl + E", "c": "Ctrl + R", "d": "Ctrl + L",
                "correct": "a", "tip": "Ctrl + J justifies the selected text.",
                "topic": "MS Word & Excel Essentials for Office Work"
            }
        ]
        self.save_questions("computer", computer_qs, topic="Computer Knowledge", model="curated-seed")

        science_qs = [
            {
                "q": "Which gas is primarily responsible for the greenhouse effect in the Earth's atmosphere?",
                "a": "Nitrogen", "b": "Oxygen", "c": "Carbon Dioxide", "d": "Argon",
                "correct": "c", "tip": "CO2 traps heat in the lower atmosphere.",
                "topic": "Physics & Ecology"
            },
            {
                "q": "Which organ in the human body is primarily responsible for filtering metabolic wastes from blood?",
                "a": "Liver", "b": "Kidney", "c": "Lungs", "d": "Heart",
                "correct": "b", "tip": "Kidneys filter waste products and excess fluid.",
                "topic": "Biology — Human Body, Health & Ecology"
            }
        ]
        self.save_questions("science", science_qs, topic="General Science", model="curated-seed")

        reasoning_qs = [
            {
                "q": "In a certain code, MEGHALAYA is written as NFHIBMZB. How is NONGSTOIN written?",
                "a": "OPOHTUPJO", "b": "OPOHTUOJP", "c": "OPOHTUPJN", "d": "OPPHTUPJO",
                "correct": "a", "tip": "Each letter is shifted forward by +1 position.",
                "topic": "Coding-Decoding"
            },
            {
                "q": "Find the missing number in the series: 3, 7, 15, 31, 63, ___",
                "a": "125", "b": "127", "c": "129", "d": "131",
                "correct": "b", "tip": "Each term is (previous * 2) + 1. 63 * 2 + 1 = 127.",
                "topic": "Number & Letter Series"
            }
        ]
        self.save_questions("reasoning", reasoning_qs, topic="Reasoning & Aptitude", model="curated-seed")
