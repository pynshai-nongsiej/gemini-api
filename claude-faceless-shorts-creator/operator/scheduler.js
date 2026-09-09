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

  /** cadence check: if produced this week < target and nothing queued/running
   *  and auto_generate enabled → operator plans exactly what's missing */
  async autoGenerate() {
    const s = this.db.getSettings();
    if (!s.auto_generate) return;
    const stats = this.db.stats();
    const pending = stats.jobs.queued + stats.jobs.running;
    if (pending > 0) return;
    const deficit = (s.cadence_per_week || 0) - stats.producedThisWeek;
    if (deficit <= 0) return;
    try {
      const need = Math.min(deficit, s.videos_per_run || 1);
      await runOperatorCycle(this.db, { count: need });
      this.worker.poke();
    } catch (err) {
      this.db.notify('warn', `Auto-generation failed: ${err.message}`);
    }
  }

  async processPublishQueue() {
    if (this.publishing) return;
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
    this.lastAnalytics = Date.now();
  }
}

module.exports = { Scheduler };
