/**
 * Operator server — the previous youtube-automation-agent's Express management
 * layer, rebuilt around the local shorts factory.
 *
 *   POST /api/jobs                      enqueue a generation (topic)
 *   GET  /api/jobs | /api/jobs/:id      queue + logs
 *   POST /api/jobs/:id/cancel|resume
 *   POST /api/operator/start            autonomous research → generate
 *   GET  /api/shorts | /api/shorts/:id  library
 *   PUT  /api/shorts/:id/meta           edit SEO before approving
 *   POST /api/shorts/:id/approve|reject review gate
 *   GET  /api/publish-queue             upcoming publishes
 *   POST /api/publish/:shortId          schedule a publish
 *   POST /api/publish-queue/:id/pause|resume|publish-now|retry
 *   GET  /api/readiness | /api/stats | /api/notifications
 *   GET/PUT /api/settings
 *   GET  /api/youtube/auth              OAuth start (returns URL)
 *   GET  /api/youtube/callback          OAuth redirect target
 *   GET  /api/youtube/status
 *   GET  /health
 *
 * ALL mutating routes require the x-api-key header when settings.api_key is
 * set (fixing the unguarded-route hole the previous agent had).
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { config, ensureDataDir } = require('./config');
const { DB } = require('./db');
const { Worker } = require('./worker');
const { Scheduler } = require('./scheduler');
const { runOperatorCycle } = require('./topics');
const publisher = require('./publisher');
const readiness = require('./readiness');

ensureDataDir();
const db = new DB();
const worker = new Worker(db);
const scheduler = new Scheduler(db, worker);

const app = express();
app.use(express.json({ limit: '1mb' }));

/** Next open publish slot: the soonest configured HH:MM (server-local) that is
 *  at least 2 minutes in the future (copied from the previous agent's
 *  USA-scheduling-helper, simplified to generic slots). */
function nextPublishSlot(slots) {
  const now = new Date();
  const candidates = [];
  for (const slot of slots) {
    const [h, m] = String(slot).split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    for (const day of [0, 1, 2]) { // today, tomorrow, day after
      const d = new Date(now);
      d.setDate(d.getDate() + day);
      d.setHours(h, m, 0, 0);
      if (d.getTime() > now.getTime() + 2 * 60 * 1000) candidates.push(d);
    }
  }
  if (!candidates.length) return new Date(now.getTime() + 5 * 60 * 1000);
  return new Date(Math.min(...candidates.map(c => c.getTime())));
}

// ---------- auth middleware ----------
function requireAPIKey(req, res, next) {
  const key = db.getSettings().api_key;
  if (!key) return next(); // unset = open (warned on boot)
  if (req.header('x-api-key') === key) return next();
  return res.status(401).json({ error: 'invalid or missing x-api-key header' });
}
const protect = requireAPIKey;

// ---------- static: dashboard + media ----------
// no-cache: the dashboard must never run a stale app.js against a new server
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: 0,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
// final videos: /media/shorts/<projId>/<file>
app.use('/media/shorts', express.static(path.join(config.ROOT, 'shorts'), {
  setHeaders: (res, p) => { if (p.endsWith('.mp4')) res.setHeader('Content-Type', 'video/mp4'); },
}));
// beat images: /media/projects/<projId>/<file>
app.use('/media/projects', express.static(path.join(config.ROOT, 'media', 'projects')));

// ---------- health ----------
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    worker: { running: !!worker.running, job: worker.running?.job.id || null },
    readiness: scheduler.readinessCache.status,
    timestamp: new Date().toISOString(),
  });
});

// ---------- jobs ----------
app.post('/api/jobs', protect, async (req, res) => {
  const { topic, style, voice, music } = req.body || {};
  if (!topic || typeof topic !== 'string' || topic.length < 3 || topic.length > 300) {
    return res.status(400).json({ error: 'topic required (3-300 chars)' });
  }
  // readiness gate for generation (copied from previous agent's assertReady)
  const ready = await readiness.getSummary();
  if (ready.blocking.length) {
    return res.status(409).json({ error: `pipeline not ready: ${ready.blocking.join(', ')}`, readiness: ready });
  }
  const job = db.createJob({ topic, style, voice, music, source: 'manual' });
  worker.poke();
  res.status(202).json({ job });
});

app.get('/api/jobs', (_req, res) => res.json({ jobs: db.listJobs() }));

app.get('/api/jobs/:id', (req, res) => {
  const job = db.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json({ job });
});

app.post('/api/jobs/:id/cancel', protect, (req, res) => {
  const result = worker.requestCancel(req.params.id);
  if (result === 'not_found') return res.status(404).json({ error: 'job not found' });
  res.json({ result });
});

app.post('/api/jobs/:id/resume', protect, (req, res) => {
  const job = db.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  if (!['failed', 'cancelled', 'completed'].includes(job.status)) {
    return res.status(409).json({ error: `cannot resume a ${job.status} job` });
  }
  db.updateJob(job.id, { status: 'queued', error: null });
  worker.poke();
  res.json({ job: db.getJob(job.id) });
});

// ---------- operator ----------
app.post('/api/operator/start', protect, async (req, res) => {
  const { count, hints } = req.body || {};
  try {
    const result = await runOperatorCycle(db, { count, hints });
    worker.poke();
    res.status(202).json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/operator/runs', (_req, res) => {
  res.json({ runs: db.listOperatorRuns() });
});

// ---------- shorts library + review gate ----------
function decorateShort(s) {
  const seo = JSON.parse(s.seo_json || '{}');
  const meta = JSON.parse(s.meta_json || '{}');
  const rel = path.relative(path.join(config.ROOT, 'shorts'), s.final_path || '');
  return {
    ...s,
    seo,
    meta,
    videoUrl: s.final_path && fs.existsSync(s.final_path) ? `/media/shorts/${rel}` : null,
    thumbnailUrl: `/media/projects/${s.id}/b00-hook.jpg`,
    publishable: !!(s.final_path && fs.existsSync(s.final_path)),
  };
}

app.get('/api/shorts', (req, res) => {
  const list = db.listShorts(req.query.status || null).map(decorateShort);
  res.json({ shorts: list });
});

app.get('/api/shorts/:id', (req, res) => {
  const s = db.getShort(req.params.id);
  if (!s) return res.status(404).json({ error: 'short not found' });
  res.json({ short: decorateShort(s) });
});

app.put('/api/shorts/:id/meta', protect, (req, res) => {
  const s = db.getShort(req.params.id);
  if (!s) return res.status(404).json({ error: 'short not found' });
  const { title, description, tags, hashtags } = req.body || {};
  const seo = JSON.parse(s.seo_json || '{}');
  if (title !== undefined) {
    if (typeof title !== 'string' || title.length < 3 || title.length > 100) {
      return res.status(400).json({ error: 'title must be 3-100 chars' });
    }
    db.updateShort(s.id, { title });
  }
  if (description !== undefined) seo.description = String(description).slice(0, 4900);
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length > 15) return res.status(400).json({ error: 'tags must be an array (max 15)' });
    seo.tags = tags.map(t => String(t).toLowerCase());
  }
  if (hashtags !== undefined) seo.hashtags = Array.isArray(hashtags) ? hashtags.slice(0, 5) : seo.hashtags;
  db.updateShort(s.id, { seo_json: JSON.stringify(seo) });
  res.json({ short: decorateShort(db.getShort(s.id)) });
});

app.post('/api/shorts/:id/approve', protect, async (req, res) => {
  const s = db.getShort(req.params.id);
  if (!s) return res.status(404).json({ error: 'short not found' });
  if (s.status === 'published') return res.status(409).json({ error: 'already published' });
  try { publisher.assertPublishable(decorateShort(s)); }
  catch (err) { return res.status(409).json({ error: err.message }); }

  const settings = db.getSettings();
  if (settings.auto_approve !== true && !(req.body || {}).confirm_reviewed) {
    return res.status(400).json({ error: 'pass confirm_reviewed: true to acknowledge the human review gate' });
  }
  db.updateShort(s.id, { status: 'approved' });
  // schedule into the next open publish slot
  const scheduledAt = nextPublishSlot(settings.publish_slots || ['17:00']);
  db.addPublish(s.id, scheduledAt);
  db.notify('info', `Approved & scheduled: "${s.title}" → ${scheduledAt.toLocaleString()}`);
  res.json({ short: decorateShort(db.getShort(s.id)), scheduled_at: scheduledAt.toISOString() });
});

app.post('/api/shorts/:id/reject', protect, (req, res) => {
  const s = db.getShort(req.params.id);
  if (!s) return res.status(404).json({ error: 'short not found' });
  db.updateShort(s.id, { status: 'rejected' });
  res.json({ short: db.getShort(s.id) });
});

// ---------- publish queue ----------
app.get('/api/publish-queue', (_req, res) => {
  res.json({ queue: db.listPublishQueue() });
});

app.post('/api/publish/:shortId', protect, async (req, res) => {
  const s = db.getShort(req.params.shortId);
  if (!s) return res.status(404).json({ error: 'short not found' });
  if (s.status !== 'approved') return res.status(409).json({ error: `short is ${s.status}, not approved` });
  const when = (req.body || {}).at;
  const at = when ? new Date(when) : new Date(Date.now() + 60 * 1000);
  if (isNaN(at.getTime())) return res.status(400).json({ error: 'invalid "at" timestamp' });
  const entry = db.addPublish(s.id, at.toISOString());
  res.status(201).json({ entry });
});

app.post('/api/publish-queue/:id/:action', protect, async (req, res) => {
  const entry = db.get('SELECT * FROM publish_queue WHERE id=?', req.params.id);
  if (!entry) return res.status(404).json({ error: 'queue entry not found' });
  const action = req.params.action;
  if (action === 'pause') db.updatePublish(entry.id, { status: 'paused' });
  else if (action === 'resume') db.updatePublish(entry.id, { status: 'scheduled' });
  else if (action === 'retry') db.updatePublish(entry.id, { status: 'scheduled', error: null });
  else if (action === 'publish-now') {
    db.updatePublish(entry.id, { status: 'scheduled', scheduled_at: new Date().toISOString() });
    setImmediate(() => scheduler.processPublishQueue().catch(() => {}));
  } else return res.status(400).json({ error: 'action must be pause|resume|retry|publish-now' });
  res.json({ entry: db.get('SELECT * FROM publish_queue WHERE id=?', entry.id) });
});

// ---------- readiness / stats / notifications / settings ----------
app.get('/api/readiness', async (_req, res) => {
  await scheduler.refreshReadiness();
  res.json(scheduler.readinessCache);
});

app.get('/api/stats', (_req, res) => res.json(db.stats()));

app.get('/api/notifications', (_req, res) => res.json({ notifications: db.listNotifications() }));
app.post('/api/notifications/read', protect, (_req, res) => {
  db.markNotificationsRead(); res.json({ ok: true });
});

app.get('/api/settings', (_req, res) => {
  const s = { ...db.getSettings() };
  const apiKeySet = !!s.api_key;
  delete s.api_key;
  res.json({ settings: s, api_key_set: apiKeySet });
});

app.put('/api/settings', protect, (req, res) => {
  const allowed = ['channel_name', 'niche', 'cadence_per_week', 'videos_per_run',
    'default_voice', 'default_style', 'default_music', 'publish_slots',
    'youtube_privacy', 'auto_generate', 'auto_approve',
    'retention_min_duration', 'retention_max_duration', 'api_key'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  const s = db.saveSettings(patch);
  const apiKeySet = !!s.api_key;
  delete s.api_key;
  res.json({ settings: s, api_key_set: apiKeySet });
});

// ---------- YouTube OAuth ----------
app.get('/api/youtube/auth', (_req, res) => {
  const url = publisher.authUrl();
  if (!url) {
    return res.status(400).json({
      error: 'Google OAuth client not configured',
      hint: 'set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in .env (or operator/data/google_client.json), then retry',
    });
  }
  res.json({ url });
});

app.get('/api/youtube/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.send(`<h2>Authorization failed</h2><p>${error}</p>`);
  try {
    await publisher.exchangeCode(code);
    res.send('<h2>YouTube authorized ✓</h2><p>You can close this tab and return to the dashboard.</p>');
  } catch (err) {
    res.status(500).send(`<h2>Token exchange failed</h2><p>${err.message}</p>`);
  }
});

app.get('/api/youtube/status', (_req, res) => {
  res.json({ authorized: publisher.hasTokens() });
});

// ---------- boot ----------
db.markInterruptedJobs();

const server = app.listen(config.PORT, () => {
  const s = db.getSettings();
  console.log(`\n==============================================`);
  console.log(`  Local Shorts Operator`);
  console.log(`  http://localhost:${config.PORT}`);
  console.log(`  readiness: ${scheduler.readinessCache.status}`);
  if (!s.api_key) {
    console.log(`  ⚠ API_KEY not set — mutating routes are UNPROTECTED`);
    console.log(`    set it: PUT /api/settings {"api_key": "..."} (then send x-api-key header)`);
  }
  console.log(`==============================================\n`);
});
server.on('error', (err) => {
  console.error(`failed to listen on port ${config.PORT}:`, err.message);
  process.exit(1);
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
