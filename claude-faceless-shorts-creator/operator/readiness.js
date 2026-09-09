/**
 * Readiness checks — the previous agent's production-readiness-service, local
 * edition. Verifies every component the pipeline depends on BEFORE generating.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { config } = require('./config');
const { hasTokens } = require('./publisher');

function checkFile(p) { return p && fs.existsSync(p); }

function checkFFmpeg() {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], (err) => resolve({ ok: !err, detail: err ? 'ffmpeg not on PATH' : 'ffmpeg available' }));
  });
}

async function checkWeb2API() {
  try {
    const res = await fetch(`${config.LOCAL_AI_BASE_URL}/models`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (data.data || []).map(m => m.id).slice(0, 3).join(', ');
    return { ok: true, detail: `${config.LOCAL_AI_BASE_URL} (${models})` };
  } catch (err) {
    return { ok: false, detail: `unreachable: ${config.LOCAL_AI_BASE_URL}` };
  }
}

async function checkKokoro() {
  const model = checkFile(config.KOKORO_MODEL_PATH);
  const voices = checkFile(config.KOKORO_VOICES_PATH);
  if (model && voices) return { ok: true, detail: `${path.basename(config.KOKORO_MODEL_PATH)}` };
  return { ok: false, detail: 'set KOKORO_MODEL_PATH / KOKORO_VOICES_PATH in .env' };
}

function checkRemotion() {
  const nm = path.join(config.ROOT, 'remotion', 'node_modules');
  return { ok: fs.existsSync(nm), detail: fs.existsSync(nm) ? 'installed' : 'run: cd remotion && npm install' };
}

function checkRootDeps() {
  const nm = path.join(config.ROOT, 'node_modules');
  const ok = fs.existsSync(path.join(nm, 'express')) && fs.existsSync(path.join(nm, 'googleapis'));
  return { ok, detail: ok ? 'express + googleapis' : 'run: npm install (repo root)' };
}

function checkYouTube() {
  return hasTokens()
    ? { ok: true, detail: 'authorized' }
    : { ok: false, detail: 'not authorized — open /api/youtube/auth (optional until publishing)' };
}

async function getSummary() {
  const [web2api, kokoro, ffmpeg, remotion, rootDeps, youtube] = await Promise.all([
    checkWeb2API(), checkKokoro(), checkFFmpeg(), checkRemotion(),
    Promise.resolve(checkRootDeps()), Promise.resolve(checkYouTube()),
  ]);
  const checks = { web2api, kokoro, ffmpeg, remotion, node_deps: rootDeps, youtube };
  // blocking failures = generation cannot run (youtube only blocks publishing)
  const blocking = Object.entries(checks)
    .filter(([k, v]) => !v.ok && k !== 'youtube')
    .map(([k]) => k);
  return {
    status: blocking.length === 0 ? 'ready' : 'degraded',
    blocking,
    checks,
    checked_at: new Date().toISOString(),
  };
}

module.exports = { getSummary };
