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
const DYNAMIC_VOICES = [
  'bm_george', 'bf_emma', 'am_adam', 'af_nova', 'am_onyx',
  'bm_daniel', 'af_sarah', 'am_eric', 'bm_lewis', 'af_river',
  'am_michael', 'bf_isabella'
];

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
    const job = this.db.get(`SELECT * FROM jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1`);
    if (!job) return;
    this.runJob(job).catch(err => {
      console.error('[worker] job crashed:', err);
      this.db.updateJob(job.id, { status: 'failed', error: String(err) });
      this.running = null;
    });
  }

  requestCancel(jobId) {
    if (this.running && this.running.job.id === jobId) {
      this.cancels.add(jobId);
      try {
        process.kill(-this.running.child.pid, 'SIGTERM');
      } catch {
        try { this.running.child.kill('SIGTERM'); } catch {}
      }
      return 'cancelling';
    }
    // not started yet -> just dequeue
    const job = this.db.getJob(jobId);
    if (job && job.status === 'queued') {
      this.db.updateJob(jobId, { status: 'cancelled', error: 'cancelled before start' });
      return 'cancelled';
    }
    return job ? job.status : 'not_found';
  }

  resolveVoice(job, settings, channel = null) {
    const requested = (job.voice || (channel && channel.voice) || settings.default_voice || 'dynamic').trim();
    if (requested && requested !== 'dynamic' && requested !== 'auto') {
      return requested;
    }
    // Dynamic selection: avoid repeating the most recent voices in DB
    try {
      const recent = this.db.all('SELECT voice FROM shorts WHERE voice IS NOT NULL ORDER BY created_at DESC LIMIT 6')
        .map(r => (r.voice || '').replace(/^kokoro:/, '').trim())
        .filter(Boolean);
      const candidates = DYNAMIC_VOICES.filter(v => !recent.slice(0, 2).includes(v));
      const pool = candidates.length ? candidates : DYNAMIC_VOICES;
      return pool[Math.floor(Math.random() * pool.length)];
    } catch {
      return DYNAMIC_VOICES[Math.floor(Math.random() * DYNAMIC_VOICES.length)];
    }
  }

  buildArgs(job, settings) {
    const channel = job.channel_id ? this.db.getChannel(job.channel_id) : null;
    if (job.format === 'long') {
      const args = ['tools/make_long.py'];
      if (channel && channel.pipeline && channel.pipeline !== 'space') {
        args.push('--pipeline', channel.pipeline);
      }
      args.push('--duration', '240');
      if (job.proj_id && (job.status === 'failed' || job.status === 'cancelled' ||
          job.error === 'interrupted by server restart')) {
        args.push('--resume', path.join('longs', job.proj_id));
      } else {
        args.push('--topic', job.topic);
        const style = job.style || (channel && channel.style) || settings.default_style;
        if (style) args.push('--style', style);
      }
      const voice = this.resolveVoice(job, settings, channel);
      if (voice) args.push('--voice', voice);
      return args;
    }
    const args = ['tools/make_short.py'];
    if (channel && channel.pipeline && channel.pipeline !== 'space') {
      args.push('--pipeline', channel.pipeline);
    }
    // completion-rate lever: per-channel runtime (finance runs short)
    if (channel && channel.duration_s) {
      args.push('--duration', String(channel.duration_s));
    }
    // auto-retry degrades: drop the expensive/flaky steps on the second pass
    if ((job.retries || 0) > 0) {
      args.push('--no-clips');
    }
    if (job.proj_id && (job.status === 'failed' || job.status === 'cancelled' ||
        job.error === 'interrupted by server restart')) {
      args.push('--resume', path.join('shorts', job.proj_id));
    } else {
      args.push('--topic', job.topic);
      let style = job.style || (channel && channel.style) || settings.default_style;
      // A/B hook variants + auto-promoted winners: the hook hint rides along
      // with the style line so every script generator shapes its hook to it
      const hookHint = job.variant_hint || (channel && channel.default_hook_hint);
      if (hookHint) {
        style = `${style || ''} HOOK REQUIREMENT: ${hookHint}`.trim();
      }
      if (style) args.push('--style', style);
    }
    const voice = this.resolveVoice(job, settings, channel);
    if (voice) args.push('--voice', voice);
    const music = job.music || (channel && channel.music) || settings.default_music;
    if (music) args.push('--music', music);
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
      // auto-retry once with a degraded recipe (no AI clips) before failing —
      // transient image/clip/network failures self-heal instead of waiting
      // for a human
      if ((job.retries || 0) < 1) {
        this.db.run(`UPDATE jobs SET status='queued', retries=retries+1, error=?, log=?, updated_at=? WHERE id=?`,
          `auto-retry 1/1 after: ${tailErr.slice(0, 140)}`, log, DB.now(), job.id);
        this.db.notify('warn', `Generation failed (${tailErr.slice(0, 80)}) — auto-retrying degraded (no clips): ${job.topic}`);
      } else {
        this.db.updateJob(job.id, { status: 'failed', error: tailErr, log });
        this.db.notify('error', `Generation failed: ${job.topic} — ${tailErr.slice(0, 160)}`);
      }
    }
    this.poke();
    resolve();
  }

  /** Register the produced short + generate SEO metadata + SRT */
  async registerShort(job, info) {
    try {
      const beats = JSON.parse(fs.readFileSync(info.beats, 'utf8'));
      const voText = (beats.vo || []).map(v => v.text).join(' ');
      const channel = job.channel_id ? this.db.getChannel(job.channel_id) : null;
      // SEO sees the channel's niche/channel name, not the global defaults
      const seoSettings = {
        ...this.db.getSettings(),
        niche: (channel && channel.niche) || this.db.getSettings().niche,
        channel_name: (channel && channel.name) || this.db.getSettings().channel_name,
      };
      const seo = await suggestSEO(info.title, voText, seoSettings);

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
        pipeline: info.pipeline || null,
        format: info.format || 'short',
        images: info.images,
        nasa_images: info.nasa_images || imageAssets.filter(a => a.source === 'nasa').length,
        real_images: (info.real_images ?? imageAssets.filter(a => a.source !== 'ai').length),
        image_sources: info.image_sources || null,   // e.g. {nasa: 3, wikimedia: 4, ai: 1}
        clips: info.clips || 0,
        qc: info.qc || null,
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
        channel_id: job.channel_id || 'cosmic-archive',
        variant_group: job.variant_group || null,
        format: job.format || 'short',
        seo_json: JSON.stringify(seo),
        meta_json: JSON.stringify(meta),
      });
      // tokenized review link (works from a phone via the notification URL)
      this.db.run(`UPDATE shorts SET review_token=? WHERE id=? AND (review_token IS NULL OR review_token='')`,
        require('crypto').randomBytes(10).toString('hex'), info.proj_id);
      if (meta.qc && meta.qc.verdict === 'flag') {
        this.db.notify('warn', `QC flagged "${info.title}": ${(meta.qc.issues || []).slice(0, 2).join(' | ') || 'see qc-report.json'} — publish will be blocked`);
      } else {
        const token = this.db.get('SELECT review_token FROM shorts WHERE id=?', info.proj_id)?.review_token;
        this.db.notify('success', `Short ready for review: "${info.title}" (${info.duration}s)`,
          token ? { shortId: info.proj_id, reviewToken: token } : {});
      }
    } catch (err) {
      console.error('[worker] registerShort failed:', err);
      // short still tracked minimally
      this.db.upsertShort({
        id: info.proj_id, job_id: job.id, title: info.title,
        final_path: info.final, beats_path: info.beats, duration_s: info.duration,
        composition: info.composition, voice: info.voice,
        channel_id: job.channel_id || 'cosmic-archive',
        variant_group: job.variant_group || null,
        format: job.format || 'short',
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
