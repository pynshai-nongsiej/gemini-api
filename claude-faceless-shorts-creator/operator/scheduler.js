/**
 * Scheduler — the previous agent's daily-automation, local edition.
 * Three loops:
 *   1. auto-generation: keep the weekly cadence (if enabled in settings)
 *   2. publish queue: publish due entries
 *   3. analytics: refresh stats for published shorts every 6h
 * Plus a readiness refresh cached for the dashboard.
 */
const readiness = require('./readiness');
const { runOperatorCycle } = require('./topics');
const publisher = require('./publisher');

const TICK_MS = 30 * 1000;
const ANALYTICS_MS = 6 * 3600 * 1000;
const DBNowISO = () => new Date().toISOString();

class Scheduler {
  constructor(db, worker) {
    this.db = db;
    this.worker = worker;
    this.lastAnalytics = 0;
    this.readinessCache = { status: 'unknown', checks: {} };
    this.publishing = false;

    this.refreshReadiness();
    const t = setInterval(() => this.tick(), TICK_MS);
    t.unref?.();
    const a = setInterval(() => this.refreshAnalytics().catch(() => {}), ANALYTICS_MS);
    a.unref?.();
  }

  async refreshReadiness() {
    try { this.readinessCache = await readiness.getSummary(); }
    catch (err) { this.readinessCache = { status: 'error', error: err.message }; }
  }

  async tick() {
    await this.autoGenerate();
    await this.processPublishQueue();
  }

  /** cadence check per channel: every enabled channel with auto_generate runs
   *  its OWN niche, voice, and publish slots; deficit is measured against that
   *  channel's produced-this-week count, and nothing runs while the worker is
   *  busy (Kokoro + Remotion are serialized). */
  async autoGenerate() {
    const pending = this.db.get(`SELECT COUNT(*) c FROM jobs WHERE status IN ('queued','running')`).c;
    if (pending > 0) return;
    for (const channel of this.db.listChannels()) {
      if (!channel.enabled || !channel.auto_generate) continue;
      const produced = this.db.get(
        `SELECT COUNT(*) c FROM shorts WHERE channel_id=? AND created_at >= ?`,
        channel.id, new Date(Date.now() - 7 * 86400e3).toISOString()).c;
      const deficit = (channel.cadence_per_week || 0) - produced;
      if (deficit <= 0) continue;
      try {
        const need = Math.min(deficit, channel.videos_per_run || 1);
        await runOperatorCycle(this.db, { count: need, channelId: channel.id });
        this.worker.poke();
        return; // one channel per tick — the worker serializes generation anyway
      } catch (err) {
        this.db.notify('warn', `Auto-generation failed for ${channel.name}: ${err.message}`);
      }
    }
  }

  async processPublishQueue() {
    if (this.publishing) return;
    // state-sync: YouTube-scheduled entries whose publishAt has passed →
    // the machine can be offline at the slot time; YouTube publishes anyway.
    // We only reconcile the local DB when we happen to be running.
    for (const entry of this.db.all(
      `SELECT q.*, s.youtube_url AS s_youtube_url, s.title AS s_title FROM publish_queue q
        JOIN shorts s ON s.id = q.short_id
       WHERE q.status='scheduled_on_youtube' AND q.scheduled_at <= ?`, DBNowISO())) {
      this.db.updatePublish(entry.id, { status: 'published', error: null });
      if (entry.s_youtube_url) {
        this.db.updateShort(entry.short_id, {
          status: 'published', published_at: entry.scheduled_at,
        });
      }
      this.db.notify('info', `YouTube published "${entry.s_title || entry.short_id}" at its scheduled time (state synced)`);
    }

    const due = this.db.duePublishes();
    for (const entry of due) {
      this.publishing = true;
      this.db.updatePublish(entry.id, { status: 'publishing' });
      try {
        await publisher.publishShort(this.db, entry);
      } catch (err) {
        this.db.updatePublish(entry.id, { status: 'failed', error: err.message });
        this.db.notify('error', `Publish failed for ${entry.short_id}: ${err.message}`);
      }
      this.publishing = false;
    }
  }

  async refreshAnalytics() {
    try {
      const n = await publisher.refreshAnalytics(this.db);
      if (n > 0) this.db.notify('info', `Analytics refreshed for ${n} published short(s)`);
    } catch (err) {
      console.warn('[scheduler] analytics refresh failed:', err.message);
    }
    // retention loop: curves + averages; promotes A/B variant winners and
    // feeds winning hooks back into topic research
    try {
      const r = await publisher.refreshRetention(this.db);
      if (r.updated > 0) {
        this.db.notify('info', `Retention data updated for ${r.updated} short(s)` +
          (r.promoted ? ` — ${r.promoted} variant winner(s) promoted` : ''));
      }
    } catch (err) {
      console.warn('[scheduler] retention refresh failed:', err.message);
    }
    // comment mining: viewer questions become topic candidates
    for (const channel of this.db.listChannels()) {
      if (!channel.enabled) continue;
      try {
        const mined = await publisher.mineComments(this.db, channel.id);
        if (mined > 0) this.db.notify('info', `💬 ${mined} viewer question(s) mined from ${channel.name}'s comments — research will prioritize them`);
      } catch (err) {
        console.warn(`[scheduler] comment mining failed for ${channel.id}:`, err.message);
      }
    }
    this.lastAnalytics = Date.now();
  }
}

module.exports = { Scheduler };
