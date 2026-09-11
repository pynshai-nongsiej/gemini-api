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
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,                 -- slug, e.g. 'cosmic-archive'
  name TEXT NOT NULL,
  niche TEXT,
  style TEXT,                          -- style hint passed to the script AI
  pipeline TEXT DEFAULT 'space',       -- space | finance | history (script grammar + imagery + edit format)
  voice TEXT,                          -- Kokoro voice ('dynamic' = auto-pick)
  music TEXT,
  publish_slots TEXT,                  -- JSON array of HH:MM, per-channel overrides global
  cadence_per_week INTEGER,
  videos_per_run INTEGER,
  auto_generate INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  accent TEXT,                         -- caption accent color override
  tokens_path TEXT,                    -- per-channel YouTube OAuth tokens file
  youtube_channel_title TEXT,          -- reported by YouTube after first upload
  created_at TEXT,
  updated_at TEXT
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
    this._migrate();
    this._seedChannels();
    this._seedSettings();
  }

  /** additive migrations — channel_id columns on the pre-multi-channel tables */
  _migrate() {
    const addColumn = (table, col, decl) => {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      if (!cols.includes(col)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
    };
    addColumn('jobs', 'channel_id', "TEXT DEFAULT 'cosmic-archive'");
    addColumn('shorts', 'channel_id', "TEXT DEFAULT 'cosmic-archive'");
    addColumn('operator_runs', 'channel_id', "TEXT DEFAULT 'cosmic-archive'");
    addColumn('topics', 'channel_id', "TEXT DEFAULT 'cosmic-archive'");
    // growth loop: per-channel duration + A/B hook-variant tracking
    addColumn('channels', 'duration_s', 'INTEGER');
    addColumn('jobs', 'variant_group', 'TEXT');
    addColumn('jobs', 'variant_hint', 'TEXT');
    addColumn('shorts', 'variant_group', 'TEXT');
  }

  /** The three connected channels: the original space channel plus the two new
   *  niches (finance / history). Existing rows predate channel_id and belong to
   *  the space channel, which is why its slug is the DEFAULT everywhere. */
  _seedChannels() {
    const now = DB.now();
    const seed = [
      {
        id: 'cosmic-archive',
        name: 'Cosmic Archive',
        niche: 'space and science mysteries',
        style: 'space documentary',
        pipeline: 'space',
        voice: 'dynamic',
        accent: '#7dd3fc',
        tokens_path: 'youtube_tokens.json',   // legacy tokens file = this channel
      },
      {
        id: 'wealth-engine',
        name: 'Wealth Engine',
        niche: 'pragmatic personal finance and wealth systems',
        style: 'pragmatic personal finance — diagnostic, numeric, systems-driven',
        pipeline: 'finance',
        voice: 'bm_george',
        accent: '#86efac',
      },
      {
        id: 'footnote-files',
        name: 'The Footnote Files',
        niche: 'narrative historical investigation and systems documentaries',
        style: 'evidence-first historical investigation documentary',
        pipeline: 'history',
        voice: 'am_onyx',
        accent: '#f5d76e',
      },
    ];
    for (const c of seed) {
      this.run(
        `INSERT OR IGNORE INTO channels (id, name, niche, style, pipeline, voice, accent, tokens_path, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        c.id, c.name, c.niche, c.style, c.pipeline, c.voice, c.accent || null,
        c.tokens_path || null, now, now);
    }
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

  // --- channels (multi-channel automation) ---
  listChannels() {
    return this.all('SELECT * FROM channels ORDER BY created_at ASC').map(c => this._expandChannel(c));
  }
  getChannel(id) {
    const c = this.get('SELECT * FROM channels WHERE id=?', id);
    return c ? this._expandChannel(c) : null;
  }
  _expandChannel(c) {
    // publish_slots + cadence/videos + duration fall back to the global settings
    const s = this.getSettings();
    return {
      ...c,
      publish_slots: c.publish_slots ? JSON.parse(c.publish_slots) : (s.publish_slots || ['13:00', '19:00']),
      cadence_per_week: c.cadence_per_week ?? s.cadence_per_week ?? 14,
      videos_per_run: c.videos_per_run ?? s.videos_per_run ?? 2,
      duration_s: c.duration_s ?? null,   // null = pipeline default (make_short's 40s)
      auto_generate: !!c.auto_generate,
      enabled: c.enabled === null || c.enabled === undefined ? 1 : c.enabled,
    };
  }
  saveChannel(id, patch) {
    const now = DB.now();
    const cur = this.getChannel(id);
    if (!cur) return null;
    const merged = { ...cur, ...patch };
    this.run(
      `UPDATE channels SET name=?, niche=?, style=?, pipeline=?, voice=?, music=?,
       publish_slots=?, cadence_per_week=?, videos_per_run=?, auto_generate=?,
       enabled=?, accent=?, tokens_path=?, youtube_channel_title=?, duration_s=?, updated_at=? WHERE id=?`,
      merged.name, merged.niche, merged.style, merged.pipeline, merged.voice,
      merged.music || null, JSON.stringify(merged.publish_slots || []),
      merged.cadence_per_week, merged.videos_per_run, merged.auto_generate ? 1 : 0,
      merged.enabled ? 1 : 0, merged.accent || null, merged.tokens_path || null,
      merged.youtube_channel_title || null, merged.duration_s ?? null, now, id);
    return this.getChannel(id);
  }
  createChannel({ id, name, niche, style, pipeline = 'space', voice = 'dynamic',
                  accent = null, cadence_per_week = null, videos_per_run = null, duration_s = null }) {
    id = String(id || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!id) throw new Error('channel id required');
    if (this.getChannel(id)) throw new Error(`channel "${id}" already exists`);
    const now = DB.now();
    this.run(
      `INSERT INTO channels (id, name, niche, style, pipeline, voice, accent, cadence_per_week, videos_per_run, duration_s, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, name || id, niche || '', style || '', pipeline, voice, accent,
      cadence_per_week, videos_per_run, duration_s, now, now);
    return this.getChannel(id);
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
  createJob({ topic, style, voice, music, source = 'manual', operatorRunId = null,
              channelId = 'cosmic-archive', variantGroup = null, variantHint = null }) {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = DB.now();
    this.run(
      `INSERT INTO jobs (id, topic, style, voice, music, source, status, operator_run_id, channel_id, variant_group, variant_hint, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, topic, style || null, voice || null, music || null, source, 'queued',
      operatorRunId, channelId, variantGroup, variantHint, now, now);
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
         voice=?, channel_id=?, variant_group=?, status='needs_review', updated_at=? WHERE id=?`,
        s.title, s.final_path, s.beats_path, s.duration_s, s.composition, s.voice,
        s.channel_id || existing.channel_id || 'cosmic-archive',
        s.variant_group ?? existing.variant_group ?? null, now, s.id);
    } else {
      this.run(
        `INSERT INTO shorts (id, job_id, title, final_path, beats_path, duration_s, composition,
         voice, channel_id, variant_group, status, seo_json, meta_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        s.id, s.job_id || null, s.title, s.final_path, s.beats_path, s.duration_s,
        s.composition, s.voice, s.channel_id || 'cosmic-archive', s.variant_group || null,
        'needs_review', s.seo_json || '{}', s.meta_json || '{}', now, now);
    }
    return this.getShort(s.id);
  }

  getShort(id) { return this.get('SELECT * FROM shorts WHERE id=?', id); }
  listShorts(status = null, channelId = null) {
    if (status && channelId) {
      return this.all('SELECT * FROM shorts WHERE status=? AND channel_id=? ORDER BY created_at DESC', status, channelId);
    }
    if (status) return this.all('SELECT * FROM shorts WHERE status=? ORDER BY created_at DESC', status);
    if (channelId) return this.all('SELECT * FROM shorts WHERE channel_id=? ORDER BY created_at DESC', channelId);
    return this.all('SELECT * FROM shorts ORDER BY created_at DESC');
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
  addTopic(title, source = 'operator', channelId = 'cosmic-archive') {
    this.run('INSERT INTO topics (title, source, status, channel_id, created_at) VALUES (?,?,?,?,?)',
      title, source, 'idea', channelId, DB.now());
  }
  listTopics(limit = 200) {
    return this.all('SELECT * FROM topics ORDER BY id DESC LIMIT ?', limit);
  }
  markTopicProduced(requestedTopic, producedTitle, channelId = 'cosmic-archive') {
    const now = DB.now();
    this.run(`UPDATE topics SET status='produced' WHERE title=? AND status IN ('idea','queued')`, requestedTopic);
    this.run(`INSERT INTO topics (title, source, status, channel_id, created_at) VALUES (?,?,?,?,?)`,
      producedTitle, 'production', 'produced', channelId, now);
  }
  /** per-channel zero-duplicate exclusion list (jobs run against THEIR channel history) */
  producedTitles(channelId = null) {
    const titles = channelId
      ? this.all('SELECT title FROM shorts WHERE channel_id=?', channelId).map(r => r.title)
      : this.all('SELECT title FROM shorts').map(r => r.title);
    const topics = channelId
      ? this.all(`SELECT title FROM topics WHERE status='produced' AND (channel_id=? OR channel_id IS NULL)`, channelId).map(r => r.title)
      : this.all(`SELECT title FROM topics WHERE status='produced'`).map(r => r.title);
    return titles.concat(topics);
  }

  /** HOOKS THAT WORKED — shorts from this channel whose measured retention beat
   *  the promotion threshold (70% avg view percentage), newest first. These get
   *  fed back into topic research so the channel learns its own winning angles. */
  winningHooks(channelId, minRetention = 70) {
    const rows = this.all(
      'SELECT title, meta_json FROM shorts WHERE channel_id=? ORDER BY created_at DESC LIMIT 60', channelId);
    const out = [];
    for (const r of rows) {
      try {
        const meta = JSON.parse(r.meta_json || '{}');
        const ret = Number(meta.retention && meta.retention.avgViewPercentage);
        if (ret >= minRetention) {
          out.push({ title: r.title, hook: meta.hook || '', retention: ret });
        }
      } catch { /* malformed meta — skip */ }
    }
    return out;
  }

  // --- publish queue ---
  addPublish(shortId, scheduledAt) {
    // guard: a short already on YouTube (scheduled or published) must never
    // be uploaded again — that would create a duplicate video on the channel
    const s = this.getShort(shortId);
    if (s && s.youtube_id) throw new Error(`short already on YouTube as ${s.youtube_id}`);
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
    // skip any entry whose short is already on YouTube (scheduled there or
    // published) — legacy rows would otherwise re-upload and duplicate
    return this.all(
      `SELECT q.* FROM publish_queue q
        JOIN shorts s ON s.id = q.short_id
       WHERE q.status='scheduled' AND q.scheduled_at <= ?
         AND s.youtube_id IS NULL`, DB.now());
  }
  /** A short that was uploaded to YouTube with publishAt — visible in the
   *  queue, but the local loop must never touch it again. */
  addYouTubeScheduled(shortId, scheduledAt, videoId) {
    const now = DB.now();
    this.run(`INSERT INTO publish_queue (short_id, scheduled_at, status, youtube_id, created_at, updated_at)
              VALUES (?,?,?,?,?,?)`,
      shortId, scheduledAt instanceof Date ? scheduledAt.toISOString() : scheduledAt,
      'scheduled_on_youtube', videoId, now, now);
    const row = this.get('SELECT * FROM publish_queue WHERE short_id=? ORDER BY id DESC', shortId);
    return row;
  }

  // --- operator runs ---
  createOperatorRun(plannedCount, channelId = 'cosmic-archive') {
    const id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = DB.now();
    this.run(`INSERT INTO operator_runs (id, status, planned_count, channel_id, created_at, updated_at)
              VALUES (?,?,?,?,?,?)`, id, 'running', plannedCount, channelId, now, now);
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
  stats(channelId = null) {
    const chan = channelId ? `WHERE s.channel_id='${String(channelId).replace(/'/g, "''")}'` : '';
    const chanQ = channelId ? 'AND channel_id=?' : '';
    const args = channelId ? [channelId] : [];
    return {
      channelId: channelId || null,
      jobs: {
        queued: this.get(`SELECT COUNT(*) c FROM jobs WHERE status='queued' ${chanQ}`, ...args).c,
        running: this.get(`SELECT COUNT(*) c FROM jobs WHERE status='running' ${chanQ}`, ...args).c,
        completed: this.get(`SELECT COUNT(*) c FROM jobs WHERE status='completed' ${chanQ}`, ...args).c,
        failed: this.get(`SELECT COUNT(*) c FROM jobs WHERE status='failed' ${chanQ}`, ...args).c,
      },
      shorts: {
        needs_review: this.get(`SELECT COUNT(*) c FROM shorts s ${chan} ${channelId ? "AND s.status='needs_review'" : "WHERE s.status='needs_review'"}`).c,
        approved: this.get(`SELECT COUNT(*) c FROM shorts s ${chan} ${channelId ? "AND s.status='approved'" : "WHERE s.status='approved'"}`).c,
        published: this.get(`SELECT COUNT(*) c FROM shorts s ${chan} ${channelId ? "AND s.status='published'" : "WHERE s.status='published'"}`).c,
        total: this.get(`SELECT COUNT(*) c FROM shorts s ${chan}`).c,
      },
      queue: {
        scheduled: this.get(`SELECT COUNT(*) c FROM publish_queue q JOIN shorts s ON s.id=q.short_id ${channelId ? "WHERE s.channel_id=? AND q.status='scheduled'" : "WHERE q.status='scheduled'"}`, ...args).c,
        scheduled_on_youtube: this.get(`SELECT COUNT(*) c FROM publish_queue q JOIN shorts s ON s.id=q.short_id ${channelId ? "WHERE s.channel_id=? AND q.status='scheduled_on_youtube'" : "WHERE q.status='scheduled_on_youtube'"}`, ...args).c,
        published: this.get(`SELECT COUNT(*) c FROM publish_queue q JOIN shorts s ON s.id=q.short_id ${channelId ? "WHERE s.channel_id=? AND q.status='published'" : "WHERE q.status='published'"}`, ...args).c,
      },
      producedThisWeek: this.get(
        `SELECT COUNT(*) c FROM shorts WHERE created_at >= ? ${channelId ? 'AND channel_id=?' : ''}`,
        ...[new Date(Date.now() - 7 * 86400e3).toISOString()], ...args).c,
    };
  }

  /** slot times already claimed by a channel's own shorts (per-channel calendars
   *  never collide with each other — different channels may share a slot time) */
  occupiedSlotTimes(channelId) {
    return this.all(
      `SELECT q.scheduled_at FROM publish_queue q JOIN shorts s ON s.id=q.short_id
       WHERE s.channel_id=? AND q.status IN ('scheduled','scheduled_on_youtube','publishing')
         AND q.scheduled_at IS NOT NULL`, channelId).map(r => r.scheduled_at);
  }
}

module.exports = { DB };
