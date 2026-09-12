/**
 * Operator config — .env loader + persisted settings (copied pattern from the
 * previous youtube-automation-agent: env first, DB settings override).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const ENV_PATH = path.join(ROOT, '.env');

function loadEnvFile() {
  const env = {};
  if (fs.existsSync(ENV_PATH)) {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const k = t.slice(0, t.indexOf('=')).trim();
      const v = t.slice(t.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
      env[k] = v;
    }
  }
  return { ...env, ...process.env };
}

const env = loadEnvFile();

const DEFAULT_SETTINGS = {
  audience_country: 'usa',           // USA-only audience targeting (seo/topics/metadata)
  channel_name: 'Cosmic Archive',
  niche: 'space and science mysteries',
  cadence_per_week: 14,              // 2 shorts daily
  videos_per_run: 2,
  default_voice: env.KOKORO_VOICE || 'dynamic',
  default_style: 'space documentary',
  default_music: '',
  publish_slots: ['13:00', '19:00'], // US Eastern Time (1:00 PM & 7:00 PM ET — lunch & evening USA peak audience)
  timezone: 'America/New_York',      // all publish-slot math runs in ET
  youtube_privacy: 'public',        // public | unlisted | private — privacy a scheduled video flips to at publishAt
  declare_ai_media: true,           // mark uploads as altered/synthetic content (YouTube AI disclosure)
  auto_generate: false,             // scheduler fills the weekly cadence
  auto_approve: false,              // KEEP FALSE: human review gate
  api_key: '',                      // if set, mutating routes require x-api-key
  retention_min_duration: 25,
  retention_max_duration: 50,
};

const config = {
  ROOT,
  DATA_DIR,
  DB_PATH: path.join(DATA_DIR, 'operator.db'),
  TOKENS_PATH: path.join(DATA_DIR, 'youtube_tokens.json'),
  GOOGLE_CLIENT_FILE: path.join(DATA_DIR, 'google_client.json'),
  PORT: parseInt(env.OPERATOR_PORT || '3457', 10),
  LOCAL_AI_BASE_URL: (env.LOCAL_AI_BASE_URL || 'http://127.0.0.1:8081/v1').replace(/\/$/, ''),
  LOCAL_AI_MODEL: env.LOCAL_AI_MODEL || 'gemini-3.6-flash',
  KOKORO_MODEL_PATH: env.KOKORO_MODEL_PATH || '',
  KOKORO_VOICES_PATH: env.KOKORO_VOICES_PATH || '',
  GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET || '',
  OAUTH_REDIRECT: `http://localhost:${parseInt(env.OPERATOR_PORT || '3457', 10)}/api/youtube/callback`,
  env,
  DEFAULT_SETTINGS,
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

module.exports = { config, ensureDataDir, loadEnvFile, DEFAULT_SETTINGS };
