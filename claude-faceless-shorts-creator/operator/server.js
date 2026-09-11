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
const usa = require('./usa-schedule');

ensureDataDir();
const db = new DB();
const worker = new Worker(db);
const scheduler = new Scheduler(db, worker);

const app = express();
app.use(express.json({ limit: '1mb' }));

/** Weighted slots (growth tuning): Buffer's 1.8M-video dataset shows Friday
 *  4-7 PM and weekend mornings over-index for Shorts — one dynamic bonus slot
 *  on those days, per channel, on top of the configured daily slots. */
function weightedSlots(base) {
  try {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' })
      .format(new Date());
    if (wd === 'Fri' && !base.includes('17:30')) return [...base, '17:30'];
    if ((wd === 'Sat' || wd === 'Sun') && !base.includes('10:30')) return [...base, '10:30'];
  } catch { /* timezone hiccup — fall through to base slots */ }
  return base;
}

/** Next open publish slot — USA targeting per CHANNEL: finds the next
 *  unoccupied slot among that channel's slots. Two channels may publish at
 *  the same clock time (different audiences, different channels). */
function nextPublishSlot(slots, channelId = null) {
  const settings = db.getSettings();
  const channel = channelId ? db.getChannel(channelId) : null;
  const currentSlots = weightedSlots(
    slots && slots.length
      ? slots
      : (channel ? channel.publish_slots : null) || settings.publish_slots || ['13:00', '19:00']);
  const occupied = channelId
    ? db.occupiedSlotTimes(channelId)
    : db.all(
      `SELECT q.scheduled_at FROM publish_queue q JOIN shorts s ON s.id=q.short_id
       WHERE q.status IN ('scheduled', 'scheduled_on_youtube', 'publishing')
         AND s.channel_id=? AND q.scheduled_at IS NOT NULL`, 'cosmic-archive').map(r => r.scheduled_at);
  return usa.nextOpenSlot(currentSlots, occupied);
}

// ---------- auth middleware ----------
function requireAPIKey(req, res, next) {
  const key = db.getSettings().api_key;
  if (!key) return next(); // unset = open (warned on boot)
  if (req.header('x-api-key') === key) return next();
  return res.status(401).json({ error: 'invalid or missing x-api-key header' });
}
const protect = requireAPIKey;

/** Channel filter from ?channel= — validates against the channels table and
 *  defaults to the original space channel so legacy callers keep working. */
function channelFilter(req) {
  const id = req.query.channel || req.body?.channelId;
  if (!id) return null;
  return db.getChannel(id) || null;
}

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
  const { topic, style, voice, music, channelId } = req.body || {};
  if (!topic || typeof topic !== 'string' || topic.length < 3 || topic.length > 300) {
    return res.status(400).json({ error: 'topic required (3-300 chars)' });
  }
  const channel = channelId ? db.getChannel(channelId) : null;
  if (channelId && !channel) {
    return res.status(404).json({ error: `channel "${channelId}" not found` });
  }
  // readiness gate for generation (copied from previous agent's assertReady)
  const ready = await readiness.getSummary();
  if (ready.blocking.length) {
    return res.status(409).json({ error: `pipeline not ready: ${ready.blocking.join(', ')}`, readiness: ready });
  }
  const job = db.createJob({
    topic,
    style: style || (channel && channel.style) || undefined,
    voice: voice || (channel && channel.voice) || undefined,
    music,
    source: 'manual',
    channelId: channel ? channel.id : 'cosmic-archive',
  });
  worker.poke();
  res.status(202).json({ job });
});

app.get('/api/jobs', (req, res) => {
  const chan = channelFilter(req);
  const jobs = db.listJobs();
  res.json({ jobs: chan ? jobs.filter(j => (j.channel_id || 'cosmic-archive') === chan.id) : jobs });
});

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
  const { count, hints, channelId } = req.body || {};
  const channel = channelId ? db.getChannel(channelId) : null;
  if (channelId && !channel) return res.status(404).json({ error: `channel "${channelId}" not found` });
  try {
    const result = await runOperatorCycle(db, { count, hints, channelId: channel ? channel.id : null });
    worker.poke();
    res.status(202).json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/operator/runs', (req, res) => {
  const chan = channelFilter(req);
  const runs = db.listOperatorRuns();
  res.json({ runs: chan ? runs.filter(r => r.channel_id === chan.id) : runs });
});

// ---------- channels (multi-channel automation) ----------
function decorateChannel(c) {
  const stats = db.stats(c.id);
  return {
    ...c,
    stats,
    youtube_authorized: publisher.hasTokens(c.id),
    pipeline_label: { space: 'NASA space', finance: 'finance data-graphics', history: 'archival history' }[c.pipeline] || c.pipeline,
  };
}

app.get('/api/channels', (_req, res) => {
  res.json({ channels: db.listChannels().map(decorateChannel) });
});

app.post('/api/channels', protect, (req, res) => {
  const { id, name, niche, style, pipeline, voice, accent, cadence_per_week, videos_per_run } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  if (pipeline && !['space', 'finance', 'history'].includes(pipeline)) {
    return res.status(400).json({ error: 'pipeline must be space|finance|history' });
  }
  try {
    const channel = db.createChannel({ id, name, niche, style, pipeline, voice, accent, cadence_per_week, videos_per_run });
    db.notify('success', `Channel added: ${channel.name} (${channel.pipeline} pipeline)`);
    res.status(201).json({ channel: decorateChannel(channel) });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.put('/api/channels/:id', protect, (req, res) => {
  const channel = db.getChannel(req.params.id);
  if (!channel) return res.status(404).json({ error: 'channel not found' });
  const { name, niche, style, pipeline, voice, music, publish_slots, cadence_per_week,
          videos_per_run, auto_generate, enabled, accent, duration_s } = req.body || {};
  if (pipeline && !['space', 'finance', 'history'].includes(pipeline)) {
    return res.status(400).json({ error: 'pipeline must be space|finance|history' });
  }
  const patch = {};
  for (const [k, v] of Object.entries({ name, niche, style, pipeline, voice, music,
          publish_slots, cadence_per_week, videos_per_run, auto_generate, enabled, accent, duration_s })) {
    if (v !== undefined) patch[k] = v;
  }
  if ('duration_s' in patch) {
    const d = parseInt(patch.duration_s, 10);
    patch.duration_s = Number.isFinite(d) ? Math.max(20, Math.min(58, d)) : null;
  }
  const updated = db.saveChannel(channel.id, patch);
  res.json({ channel: decorateChannel(updated) });
});

/** Kick an operator research→generate cycle FOR ONE CHANNEL (its own niche,
 *  voice, pipeline, exclusion history). body {variants: N} switches to A/B
 *  hook mode: one topic, N hook angles racing in the feed. */
app.post('/api/channels/:id/start', protect, async (req, res) => {
  const channel = db.getChannel(req.params.id);
  if (!channel) return res.status(404).json({ error: 'channel not found' });
  const { count, hints, variants } = req.body || {};
  const hookVariants = Math.max(1, Math.min(3, parseInt(variants, 10) || 1));
  try {
    const result = await runOperatorCycle(db, { count, hints, channelId: channel.id, hookVariants });
    worker.poke();
    res.status(202).json({ ...result, channel: decorateChannel(channel) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/** Manual retention refresh (the scheduler also does this every 6h). */
app.post('/api/analytics/refresh', protect, async (_req, res) => {
  try {
    const views = await publisher.refreshAnalytics(db);
    const retention = await publisher.refreshRetention(db);
    res.json({ views_updated: views, retention_updated: retention });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/channels/:id/shorts', (req, res) => {
  const channel = db.getChannel(req.params.id);
  if (!channel) return res.status(404).json({ error: 'channel not found' });
  res.json({ shorts: db.listShorts(req.query.status || null, channel.id).map(decorateShort) });
});

// ---------- shorts library + review gate ----------
function thumbnailUrlFor(s) {
  const mediaDir = path.join(config.ROOT, 'media', 'projects', s.id);
  try {
    if (fs.existsSync(mediaDir)) {
      const first = fs.readdirSync(mediaDir)
        .filter(f => /^b0\d-.*\.(png|jpe?g|webp)$/i.test(f))
        .sort()[0];
      if (first) return `/media/projects/${s.id}/${first}`;
    }
  } catch {}
  return null;
}

function decorateShort(s) {
  const seo = JSON.parse(s.seo_json || '{}');
  const meta = JSON.parse(s.meta_json || '{}');
  const rel = path.relative(path.join(config.ROOT, 'shorts'), s.final_path || '');
  return {
    ...s,
    seo,
    meta,
    videoUrl: s.final_path && fs.existsSync(s.final_path) ? `/media/shorts/${rel}` : null,
    thumbnailUrl: thumbnailUrlFor(s),
    publishable: !!(s.final_path && fs.existsSync(s.final_path)),
  };
}

app.get('/api/shorts', (req, res) => {
  const chan = channelFilter(req);
  const list = db.listShorts(req.query.status || null, chan ? chan.id : null).map(decorateShort);
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
  if (s.status === 'scheduled_on_youtube') return res.status(409).json({ error: 'already scheduled on YouTube' });
  try { publisher.assertPublishable(decorateShort(s)); }
  catch (err) { return res.status(409).json({ error: err.message }); }

  const settings = db.getSettings();
  if (settings.auto_approve !== true && !(req.body || {}).confirm_reviewed) {
    return res.status(400).json({ error: 'pass confirm_reviewed: true to acknowledge the human review gate' });
  }

  // schedule into the next open publish slot FOR THIS SHORT'S CHANNEL
  const channel = db.getChannel(s.channel_id || 'cosmic-archive');
  const scheduledAt = nextPublishSlot(channel ? channel.publish_slots : null, s.channel_id || 'cosmic-archive');

  // Upload NOW as private + publishAt: YouTube's clock makes it public at
  // the slot time — works even when this machine is offline at that moment.
  // Keep a queue row only for dashboard visibility (never re-uploaded).
  try {
    const result = await publisher.scheduleOnYouTube(db, decorateShort(s), scheduledAt);
    db.addYouTubeScheduled(s.id, scheduledAt, result.videoId);
    db.updateShort(s.id, { status: 'scheduled_on_youtube' });
    res.json({
      short: decorateShort(db.getShort(s.id)),
      scheduled_at: scheduledAt.toISOString(),
      youtube_scheduled: true,
      videoId: result.videoId,
      publish_at: result.publishAt,
    });
  } catch (err) {
    // YouTube not authorized / upload failed → fall back to the local queue
    db.updateShort(s.id, { status: 'approved' });
    try { db.addPublish(s.id, scheduledAt.toISOString()); } catch (e) { return res.status(409).json({ error: e.message }); }
    db.notify('warn', `YouTube scheduling failed (${err.message}) — queued locally instead; the machine must be online at ${scheduledAt.toISOString()}`);
    res.json({
      short: decorateShort(db.getShort(s.id)),
      scheduled_at: scheduledAt.toISOString(),
      youtube_scheduled: false,
      error: err.message,
    });
  }
});

app.post('/api/shorts/:id/reject', protect, (req, res) => {
  const s = db.getShort(req.params.id);
  if (!s) return res.status(404).json({ error: 'short not found' });
  if (s.status === 'published') return res.status(409).json({ error: 'already published — manage it on YouTube' });
  // drop from publish queue regardless of prior schedule status
  db.run("DELETE FROM publish_queue WHERE short_id=?", s.id);
  db.updateShort(s.id, { status: 'rejected', youtube_id: null, youtube_url: null });
  db.notify('info', `Rejected: "${s.title}"`);
  res.json({ short: db.getShort(s.id) });
});

// ---------- publish queue ----------
app.get('/api/publish-queue', (req, res) => {
  const settings = db.getSettings();
  const queue = db.listPublishQueue().map(q => ({
    ...q,
    scheduled_at_et: q.scheduled_at ? usa.fmtET(new Date(q.scheduled_at)) : null,
  }));
  // weekly slot calendar (USA/ET targeting: 7 days, 2 slots daily)
  const slots = settings.publish_slots?.length ? settings.publish_slots : ['13:00', '19:00'];
  const calendarDays = usa.getWeeklyCalendar(slots, 7, queue);
  const upcoming = calendarDays.flatMap(d => d.slots);
  res.json({
    queue,
    upcoming,
    calendarDays,
    timezone: settings.timezone || usa.ET,
    slots,
  });
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
  if (action === 'pause') {
    if (entry.status === 'scheduled_on_youtube') {
      return res.status(409).json({ error: 'already uploaded to YouTube — pause/unpublish it there (studio.youtube.com)' });
    }
    db.updatePublish(entry.id, { status: 'paused' });
  }
  else if (action === 'resume') db.updatePublish(entry.id, { status: 'scheduled' });
  else if (action === 'retry') db.updatePublish(entry.id, { status: 'scheduled', error: null });
  else if (action === 'publish-now') {
    if (entry.status === 'scheduled_on_youtube') {
      // the video already exists on YouTube: flip it public right now
      try {
        const url = await publisher.makePublicNow(db, entry);
        return res.json({ entry: db.get('SELECT * FROM publish_queue WHERE id=?', entry.id), url });
      } catch (err) { return res.status(502).json({ error: err.message }); }
    }
    db.updatePublish(entry.id, { status: 'scheduled', scheduled_at: new Date().toISOString() });
    setImmediate(() => scheduler.processPublishQueue().catch(() => {}));
  } else if (action === 'remove') {
    // unschedule: delete queue entry; short returns to needs_review/approved
    // so it can be re-scheduled or reviewed again
    db.run('DELETE FROM publish_queue WHERE id=?', entry.id);
    const s = db.getShort(entry.short_id);
    if (s) {
      db.updateShort(s.id, { status: 'needs_review', youtube_id: null, youtube_url: null });
    }
    db.notify('info', `Removed from publish queue: ${entry.short_id}`);
    return res.json({ removed: true });
  } else if (action === 'reschedule') {
    // delete previous queue entry and schedule into the next open slot
    db.run('DELETE FROM publish_queue WHERE id=?', entry.id);
    const s = db.getShort(entry.short_id);
    if (!s) return res.status(404).json({ error: 'short not found' });
    const channel = db.getChannel(s.channel_id || 'cosmic-archive');
    const scheduledAt = nextPublishSlot(channel ? channel.publish_slots : null, s.channel_id || 'cosmic-archive');
    try {
      const result = await publisher.scheduleOnYouTube(db, decorateShort(s), scheduledAt);
      db.addYouTubeScheduled(s.id, scheduledAt, result.videoId);
      db.updateShort(s.id, { status: 'scheduled_on_youtube', youtube_id: result.videoId, youtube_url: `https://www.youtube.com/shorts/${result.videoId}` });
      return res.json({
        rescheduled: true,
        scheduled_at: scheduledAt.toISOString(),
        videoId: result.videoId,
      });
    } catch (err) {
      db.updateShort(s.id, { status: 'approved' });
      db.addPublish(s.id, scheduledAt.toISOString());
      return res.json({
        rescheduled: true,
        scheduled_at: scheduledAt.toISOString(),
        youtube_scheduled: false,
        warning: err.message,
      });
    }
  } else return res.status(400).json({ error: 'action must be pause|resume|retry|publish-now|remove|reschedule' });
  res.json({ entry: db.get('SELECT * FROM publish_queue WHERE id=?', entry.id) });
});

// ---------- readiness / stats / notifications / settings ----------
app.get('/api/readiness', async (_req, res) => {
  await scheduler.refreshReadiness();
  res.json(scheduler.readinessCache);
});

app.get('/api/stats', (req, res) => {
  const chan = channelFilter(req);
  res.json(db.stats(chan ? chan.id : null));
});

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
    'youtube_privacy', 'declare_ai_media', 'auto_generate', 'auto_approve',
    'retention_min_duration', 'retention_max_duration', 'api_key'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  const s = db.saveSettings(patch);
  const apiKeySet = !!s.api_key;
  delete s.api_key;
  res.json({ settings: s, api_key_set: apiKeySet });
});

// ---------- YouTube OAuth (per channel) ----------
app.get('/api/youtube/auth', (req, res) => {
  const channel = channelFilter(req);
  const url = publisher.authUrl(channel ? channel.id : null);
  if (!url) {
    return res.status(400).json({
      error: 'Google OAuth client not configured',
      hint: 'set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in .env (or operator/data/google_client.json), then retry',
    });
  }
  res.json({ url, channel: channel ? channel.id : 'cosmic-archive' });
});

app.get('/api/youtube/callback', async (req, res) => {
  const { code, error, state } = req.query;
  if (error) return res.send(`<h2>Authorization failed</h2><p>${error}</p>`);
  // state carries the channel id from /api/youtube/auth — decides which
  // channel's token file this consent lands in
  const channelId = state && db.getChannel(state) ? state : 'cosmic-archive';
  const channel = db.getChannel(channelId);
  try {
    await publisher.exchangeCode(code, publisher.tokensPathFor(channelId));
    if (channel) db.saveChannel(channelId, { youtube_channel_title: null });
    res.send(`<h2>YouTube authorized ✓</h2><p>Channel: <b>${channel ? channel.name : channelId}</b>. You can close this tab and return to the dashboard.</p>`);
  } catch (err) {
    res.status(500).send(`<h2>Token exchange failed</h2><p>${err.message}</p>`);
  }
});

app.get('/api/youtube/status', (req, res) => {
  const chan = channelFilter(req);
  if (chan) return res.json({ authorized: publisher.hasTokens(chan.id), channel: chan.id });
  // no filter: per-channel map for the Channels tab
  const channels = {};
  for (const c of db.listChannels()) channels[c.id] = publisher.hasTokens(c.id);
  res.json({ authorized: channels['cosmic-archive'] || Object.values(channels).some(Boolean), channels });
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
