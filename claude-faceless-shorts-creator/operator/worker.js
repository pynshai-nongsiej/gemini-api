/**
 * Generation worker — serial queue that spawns `python3 tools/make_short.py`.
 * Copied pattern from the previous agent's startGenerationJob/runGenerationJob:
 * statuses queued→running→completed|failed|cancelled, interrupt recovery on
 * boot, cancel via process-group kill, resume via --resume.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { config } = require('./config');
const { DB } = require('./db');
const { suggestSEO } = require('./seo');

const MAX_CONCURRENT = 1;   // Kokoro + Remotion renders are heavy — serialize
const POLL_MS = 4000;

class Worker {
  constructor(db) {
    this.db = db;
    this.running = null;    // { job, child }
    this.cancels = new Set();
    this._timer = setInterval(() => this.tick(), POLL_MS);
    this._timer.unref?.();
  }

  /** kick the loop immediately (after enqueue) */
  poke() { setImmediate(() => this.tick()); }

  async tick() {
    if (this.running) return;
    if (this.runningCount() >= MAX_CONCURRENT) return;
    const job = this.db.get(`SELECT * FROM jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1`);
    if (!job) return;
    this.runJob(job).catch(err => {
      console.error('[worker] job crashed:', err);
      this.db.updateJob(job.id, { status: 'failed', error: String(err) });
      this.running = null;
    });
  }

  runningCount() { return this.running ? 1 : 0; }

  requestCancel(jobId) {
    if (this.running && this.running.job.id === jobId) {
      this.cancels.add(jobId);
      const { child } = this.running;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
      return 'killing';
    }
    // not started yet -> just dequeue
    const job = this.db.getJob(jobId);
    if (job && job.status === 'queued') {
      this.db.updateJob(jobId, { status: 'cancelled', error: 'cancelled before start' });
      return 'cancelled';
    }
    return job ? job.status : 'not_found';
  }

  buildArgs(job, settings) {
    const args = ['tools/make_short.py'];
    if (job.proj_id && (job.status === 'failed' || job.status === 'cancelled' ||
        job.error === 'interrupted by server restart')) {
      args.push('--resume', path.join('shorts', job.proj_id));
    } else {
      args.push('--topic', job.topic);
      if (job.style || settings.default_style) args.push('--style', job.style || settings.default_style);
    }
    if (job.voice) args.push('--voice', job.voice);
    else if (settings.default_voice) args.push('--voice', settings.default_voice);
    if (job.music) args.push('--music', job.music);
    else if (settings.default_music) args.push('--music', settings.default_music);
    return args;
  }

  runJob(job) {
    return new Promise((resolve) => {
      const settings = this.db.getSettings();
      const args = this.buildArgs(job, settings);
      this.db.updateJob(job.id, { status: 'running', error: null });
      console.log(`[worker] start ${job.id}: python3 ${args.join(' ')}`);

      const child = spawn('python3', args, {
        cwd: config.ROOT,
        detached: true,            // own group so we can kill ffmpeg/node children
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
      this.running = { job, child };

      let log = '';
      let finalInfo = null;
      const onData = (buf) => {
        log += buf.toString();
        const lines = log.split('\n');
        for (const line of lines) {
          if (line.startsWith('FINAL:')) {
            try { finalInfo = JSON.parse(line.slice(6)); } catch {}
          }
        }
        if (log.length > 200000) log = log.slice(-100000);
        // throttle DB log updates
        if (!this._lastLogFlush || Date.now() - this._lastLogFlush > 3000) {
          this._lastLogFlush = Date.now();
          this.db.run(`UPDATE jobs SET log=? WHERE id=?`, log.slice(-20000), job.id);
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);

      child.on('error', (err) => this.finish(job, 1, String(err), log, finalInfo, resolve));
      child.on('close', (code) => this.finish(job, code, null, log, finalInfo, resolve));
    });
  }

  finish(job, code, spawnError, log, finalInfo, resolve) {
    const cancelled = this.cancels.delete(job.id);
    this.running = null;

    if (cancelled) {
      this.db.updateJob(job.id, { status: 'cancelled', log });
      this.db.notify('warn', `Generation cancelled: ${job.topic}`);
    } else if (spawnError) {
      this.db.updateJob(job.id, { status: 'failed', error: spawnError, log });
      this.db.notify('error', `Generation failed to start: ${job.topic}`);
    } else if (code === 0 && finalInfo) {
      this.db.updateJob(job.id, {
        status: 'completed', proj_id: finalInfo.proj_id, error: null, log,
      });
      this.registerShort(job, finalInfo);
      this.db.markTopicProduced(job.topic, finalInfo.title);
    } else {
      const tailErr = (log || '').trim().split('\n').filter(Boolean).slice(-3).join(' | ') || `exit ${code}`;
      this.db.updateJob(job.id, { status: 'failed', error: tailErr, log });
      this.db.notify('error', `Generation failed: ${job.topic} — ${tailErr.slice(0, 160)}`);
    }
    this.poke();
    resolve();
  }

  /** Register the produced short + generate SEO metadata + SRT */
  async registerShort(job, info) {
    try {
      const beats = JSON.parse(fs.readFileSync(info.beats, 'utf8'));
      const voText = (beats.vo || []).map(v => v.text).join(' ');
      const seo = await suggestSEO(info.title, voText, this.db.getSettings());

      // asset manifest: NASA-first imagery provenance per beat
      let imageAssets = [];
      try {
        imageAssets = JSON.parse(fs.readFileSync(info.images_manifest, 'utf8'))
          .map(a => ({
            beat: a.beat, source: a.source, title: a.title,
            nasa_id: a.nasa_id || null, details_url: a.details_url || null,
            url: `/media/projects/${info.proj_id}/${a.src}`,
          }));
      } catch { /* manifest optional on older runs */ }

      const meta = {
        hook: beats.vo?.[0]?.text || '',
        accent: info.accent,
        images: info.images,
        nasa_images: info.nasa_images || imageAssets.filter(a => a.source === 'nasa').length,
        imageAssets,
        srt: this.writeSrt(info.proj_id, beats),
      };
      this.db.upsertShort({
        id: info.proj_id,
        job_id: job.id,
        title: info.title,
        final_path: info.final,
        beats_path: info.beats,
        duration_s: info.duration,
        composition: info.composition,
        voice: info.voice,
        seo_json: JSON.stringify(seo),
        meta_json: JSON.stringify(meta),
      });
      this.db.notify('success', `Short ready for review: "${info.title}" (${info.duration}s)`);
    } catch (err) {
      console.error('[worker] registerShort failed:', err);
      // short still tracked minimally
      this.db.upsertShort({
        id: info.proj_id, job_id: job.id, title: info.title,
        final_path: info.final, beats_path: info.beats, duration_s: info.duration,
        composition: info.composition, voice: info.voice,
      });
    }
  }

  /** SRT from beats vo line timings (published as YouTube captions) */
  writeSrt(projId, beats) {
    const fmt = (sec) => {
      const ms = Math.round((sec % 1) * 1000);
      const s = Math.floor(sec);
      return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    };
    const lines = (beats.vo || []).map((v, i) =>
      `${i + 1}\n${fmt(v.start)} --> ${fmt(v.end)}\n${v.text}\n`).join('\n');
    const srtPath = path.join(config.ROOT, 'shorts', projId, `${projId}.srt`);
    try {
      fs.mkdirSync(path.dirname(srtPath), { recursive: true });
      fs.writeFileSync(srtPath, lines, 'utf8');
      return srtPath;
    } catch { return null; }
  }
}

module.exports = { Worker };
