/**
 * SQLite layer via node:sqlite (built into Node 22+; no native deps).
 * Schema copied in spirit from the previous youtube-automation-agent:
 * jobs, shorts (productions), topics history, publish queue, operator runs,
 * notifications, settings.
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { config, ensureDataDir, DEFAULT_SETTINGS } = require('./config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  style TEXT,
  voice TEXT,
  music TEXT,
  source TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'queued',        -- queued|running|completed|failed|cancelled
  proj_id TEXT,
  operator_run_id TEXT,
  error TEXT,
  log TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS shorts (
  id TEXT PRIMARY KEY,                 -- proj_id (auto-N-slug)
  job_id TEXT,
  title TEXT,
  status TEXT DEFAULT 'needs_review',  -- needs_review|approved|rejected|published
  final_path TEXT,
  beats_path TEXT,
  duration_s REAL,
  composition TEXT,
  voice TEXT,
  seo_json TEXT DEFAULT '{}',
  meta_json TEXT DEFAULT '{}',
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  youtube_id TEXT,
  youtube_url TEXT,
  published_at TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  source TEXT DEFAULT 'operator',
  status TEXT DEFAULT 'idea',          -- idea|queued|produced|rejected
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS publish_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT DEFAULT 'scheduled',     -- scheduled|publishing|published|failed|paused
  error TEXT,
  youtube_id TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS operator_runs (
  id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'running',       -- running|completed|completed_with_issues|failed
  planned_count INTEGER DEFAULT 0,
  summary_json TEXT DEFAULT '{}',
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT DEFAULT 'info',           -- info|success|warn|error
  message TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_shorts_status ON shorts(status);
CREATE INDEX IF NOT EXISTS idx_queue_status ON publish_queue(status);
`;

class DB {
  constructor() {
    ensureDataDir();
    this.db = new DatabaseSync(config.DB_PATH);
    this.db.exec(SCHEMA);
    this._seedSettings();
  }

  _seedSettings() {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='global'").get();
    if (!row) {
      this.db.prepare("INSERT INTO settings (key, value) VALUES ('global', ?)")
        .run(JSON.stringify(DEFAULT_SETTINGS));
    } else {
      // merge in any new default keys
      const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
      if (JSON.stringify(merged) !== row.value) {
        this.db.prepare("UPDATE settings SET value=? WHERE key='global'").run(JSON.stringify(merged));
      }
    }
  }

  getSettings() {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='global'").get();
    return { ...JSON.parse(row.value) };
  }

  saveSettings(patch) {
    const cur = this.getSettings();
    const next = { ...cur, ...patch };
    this.db.prepare("UPDATE settings SET value=? WHERE key='global'").run(JSON.stringify(next));
    return next;
  }

  // --- helpers ---
  static now() {
    return new Date().toISOString();
  }

  /** node:sqlite only binds string|number|bigint|null — coerce everything */
  static bind(v) {
    if (v === undefined) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  }

  all(sql, ...args) { return this.db.prepare(sql).all(...args.map(DB.bind)); }
  get(sql, ...args) { return this.db.prepare(sql).get(...args.map(DB.bind)); }
  run(sql, ...args) { return this.db.prepare(sql).run(...args.map(DB.bind)); }

  // --- jobs ---
  createJob({ topic, style, voice, music, source = 'manual', operatorRunId = null }) {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = DB.now();
    this.run(
      `INSERT INTO jobs (id, topic, style, voice, music, source, status, operator_run_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      id, topic, style || null, voice || null, music || null, source, 'queued', operatorRunId, now, now);
    return this.getJob(id);
  }

  getJob(id) { return this.get('SELECT * FROM jobs WHERE id=?', id); }
  listJobs(limit = 50) {
    return this.all('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?', limit);
  }
  updateJob(id, patch) {
    const cur = this.getJob(id);
    if (!cur) return null;
    const merged = { ...cur, ...patch, updated_at: DB.now() };
    this.run(
      `UPDATE jobs SET status=?, proj_id=?, error=?, log=?, updated_at=? WHERE id=?`,
      merged.status, merged.proj_id ?? null, merged.error ?? null,
      (merged.log || '').slice(-20000), merged.updated_at, id);
    return merged;
  }
  markInterruptedJobs() {
    // server restarted while a job was running -> back to queued for resume
    this.run(`UPDATE jobs SET status='queued', error='interrupted by server restart', updated_at=? WHERE status='running'`, DB.now());
  }

  // --- shorts ---
  upsertShort(s) {
    const now = DB.now();
    const existing = this.get('SELECT id FROM shorts WHERE id=?', s.id);
    if (existing) {
      this.run(
        `UPDATE shorts SET title=?, final_path=?, beats_path=?, duration_s=?, composition=?,
         voice=?, status='needs_review', updated_at=? WHERE id=?`,
        s.title, s.final_path, s.beats_path, s.duration_s, s.composition, s.voice, now, s.id);
    } else {
      this.run(
        `INSERT INTO shorts (id, job_id, title, final_path, beats_path, duration_s, composition,
         voice, status, seo_json, meta_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        s.id, s.job_id || null, s.title, s.final_path, s.beats_path, s.duration_s,
        s.composition, s.voice, 'needs_review', s.seo_json || '{}', s.meta_json || '{}', now, now);
    }
    return this.getShort(s.id);
  }

  getShort(id) { return this.get('SELECT * FROM shorts WHERE id=?', id); }
  listShorts(status = null) {
    return status
      ? this.all('SELECT * FROM shorts WHERE status=? ORDER BY created_at DESC', status)
      : this.all('SELECT * FROM shorts ORDER BY created_at DESC');
  }
  updateShort(id, patch) {
    const cur = this.getShort(id);
    if (!cur) return null;
    const merged = { ...cur, ...patch, updated_at: DB.now() };
    this.run(
      `UPDATE shorts SET title=?, status=?, seo_json=?, meta_json=?, views=?, likes=?, comments=?,
       youtube_id=?, youtube_url=?, published_at=?, updated_at=? WHERE id=?`,
      merged.title, merged.status, merged.seo_json, merged.meta_json,
      merged.views ?? 0, merged.likes ?? 0, merged.comments ?? 0,
      merged.youtube_id ?? null, merged.youtube_url ?? null, merged.published_at ?? null,
      merged.updated_at, id);
    return this.getShort(id);
  }

  // --- topics ---
  addTopic(title, source = 'operator') {
    this.run('INSERT INTO topics (title, source, status, created_at) VALUES (?,?,?,?)',
      title, source, 'idea', DB.now());
  }
  listTopics(limit = 200) {
    return this.all('SELECT * FROM topics ORDER BY id DESC LIMIT ?', limit);
  }
  markTopicProduced(requestedTopic, producedTitle) {
    const now = DB.now();
    this.run(`UPDATE topics SET status='produced' WHERE title=? AND status IN ('idea','queued')`, requestedTopic);
    this.run(`INSERT INTO topics (title, source, status, created_at) VALUES (?,?,?,?)`,
      producedTitle, 'production', 'produced', now);
  }
  producedTitles() {
    return this.all(`SELECT title FROM shorts`).map(r => r.title)
      .concat(this.all(`SELECT title FROM topics WHERE status='produced'`).map(r => r.title));
  }

  // --- publish queue ---
  addPublish(shortId, scheduledAt) {
    const now = DB.now();
    this.run(`INSERT INTO publish_queue (short_id, scheduled_at, status, created_at, updated_at)
              VALUES (?,?,?,?,?)`, shortId, scheduledAt, 'scheduled', now, now);
    const row = this.get('SELECT * FROM publish_queue WHERE short_id=? ORDER BY id DESC', shortId);
    return row;
  }
  listPublishQueue() {
    return this.all(`SELECT q.*, s.title AS short_title, s.final_path, s.duration_s
                     FROM publish_queue q LEFT JOIN shorts s ON s.id = q.short_id
                     ORDER BY q.scheduled_at ASC`);
  }
  updatePublish(id, patch) {
    const cur = this.get('SELECT * FROM publish_queue WHERE id=?', id);
    if (!cur) return null;
    const merged = { ...cur, ...patch, updated_at: DB.now() };
    this.run(`UPDATE publish_queue SET status=?, scheduled_at=?, error=?, youtube_id=?, updated_at=? WHERE id=?`,
      merged.status, merged.scheduled_at, merged.error ?? null,
      merged.youtube_id ?? null, merged.updated_at, id);
    return this.get('SELECT * FROM publish_queue WHERE id=?', id);
  }
  duePublishes() {
    return this.all(`SELECT * FROM publish_queue WHERE status='scheduled' AND scheduled_at <= ?`, DB.now());
  }

  // --- operator runs ---
  createOperatorRun(plannedCount) {
    const id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = DB.now();
    this.run(`INSERT INTO operator_runs (id, status, planned_count, created_at, updated_at)
              VALUES (?,?,?,?,?)`, id, 'running', plannedCount, now, now);
    return this.getOperatorRun(id);
  }
  getOperatorRun(id) { return this.get('SELECT * FROM operator_runs WHERE id=?', id); }
  listOperatorRuns(limit = 20) {
    return this.all('SELECT * FROM operator_runs ORDER BY created_at DESC LIMIT ?', limit);
  }
  updateOperatorRun(id, patch) {
    const cur = this.getOperatorRun(id);
    if (!cur) return null;
    const merged = { ...cur, ...patch, updated_at: DB.now() };
    this.run(`UPDATE operator_runs SET status=?, summary_json=?, planned_count=?, updated_at=? WHERE id=?`,
      merged.status, merged.summary_json || '{}', merged.planned_count, merged.updated_at, id);
    return this.getOperatorRun(id);
  }

  // --- notifications ---
  notify(level, message) {
    this.run('INSERT INTO notifications (level, message, created_at) VALUES (?,?,?)',
      level, message, DB.now());
  }
  listNotifications(limit = 50) {
    return this.all('SELECT * FROM notifications ORDER BY id DESC LIMIT ?', limit);
  }
  markNotificationsRead() {
    this.run('UPDATE notifications SET read=1');
  }

  // --- stats ---
  stats() {
    return {
      jobs: {
        queued: this.get(`SELECT COUNT(*) c FROM jobs WHERE status='queued'`).c,
        running: this.get(`SELECT COUNT(*) c FROM jobs WHERE status='running'`).c,
        completed: this.get(`SELECT COUNT(*) c FROM jobs WHERE status='completed'`).c,
        failed: this.get(`SELECT COUNT(*) c FROM jobs WHERE status='failed'`).c,
      },
      shorts: {
        needs_review: this.get(`SELECT COUNT(*) c FROM shorts WHERE status='needs_review'`).c,
        approved: this.get(`SELECT COUNT(*) c FROM shorts WHERE status='approved'`).c,
        published: this.get(`SELECT COUNT(*) c FROM shorts WHERE status='published'`).c,
        total: this.get(`SELECT COUNT(*) c FROM shorts`).c,
      },
      queue: {
        scheduled: this.get(`SELECT COUNT(*) c FROM publish_queue WHERE status='scheduled'`).c,
        published: this.get(`SELECT COUNT(*) c FROM publish_queue WHERE status='published'`).c,
      },
      producedThisWeek: this.get(
        `SELECT COUNT(*) c FROM shorts WHERE created_at >= ?`,
        new Date(Date.now() - 7 * 86400e3).toISOString()).c,
    };
  }
}

module.exports = { DB };
