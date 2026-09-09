/**
 * YouTube publisher — the previous agent's publishing-scheduling-agent, local
 * edition. Google OAuth2 (installed-app flow) + resumable upload via googleapis,
 * thumbnail + caption upload, publishAt scheduling, fail-closed gating
 * (no fake video, no silent video — the files must exist).
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { config } = require('./config');

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload',
                'https://www.googleapis.com/auth/youtube.force-ssl'];

function clientSecrets() {
  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
    return { installed: { client_id: config.GOOGLE_CLIENT_ID,
                          client_secret: config.GOOGLE_CLIENT_SECRET,
                          redirect_uris: [config.OAUTH_REDIRECT] } };
  }
  const file = config.GOOGLE_CLIENT_FILE;
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return null;
}

function getOAuthClient() {
  const secrets = clientSecrets();
  if (!secrets) return null;
  const installed = secrets.installed || secrets.web;
  const oauth = new google.auth.OAuth2(
    installed.client_id, installed.client_secret, config.OAUTH_REDIRECT);
  if (fs.existsSync(config.TOKENS_PATH)) {
    oauth.setCredentials(JSON.parse(fs.readFileSync(config.TOKENS_PATH, 'utf8')));
  }
  return oauth;
}

function hasTokens() {
  return fs.existsSync(config.TOKENS_PATH);
}

function authUrl() {
  const oauth = getOAuthClient();
  if (!oauth) return null;
  return oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

async function exchangeCode(code) {
  const oauth = getOAuthClient();
  const { tokens } = await oauth.getToken(code);
  fs.mkdirSync(path.dirname(config.TOKENS_PATH), { recursive: true });
  fs.writeFileSync(config.TOKENS_PATH, JSON.stringify(tokens, null, 2));
  return tokens;
}

async function getYouTube() {
  const oauth = getOAuthClient();
  if (!oauth || !hasTokens()) return null;
  oauth.on('tokens', (t) => {
    // persist refreshed tokens
    try {
      const cur = JSON.parse(fs.readFileSync(config.TOKENS_PATH, 'utf8'));
      fs.writeFileSync(config.TOKENS_PATH, JSON.stringify({ ...cur, ...t }, null, 2));
    } catch {}
  });
  return google.youtube({ version: 'v3', auth: oauth });
}

/** Fail-closed checks copied from the previous agent's publish gates */
function assertPublishable(short) {
  if (!short.final_path || !fs.existsSync(short.final_path)) {
    throw new Error('final video file missing — will not publish a placeholder');
  }
  const size = fs.statSync(short.final_path).size;
  if (size < 100 * 1024) throw new Error('final video suspiciously small — refusing to publish');
  if (!short.title || short.title.trim().length < 3) {
    throw new Error('title missing — edit the short metadata before approving');
  }
}

/** First beat image = the thumbnail (frame 0 = the thumbnail, per the beat grammar) */
function thumbnailFor(short) {
  try {
    const meta = JSON.parse(short.meta_json || '{}');
    const mediaDir = path.join(config.ROOT, 'media', 'projects', short.id);
    if (fs.existsSync(mediaDir)) {
      const imgs = fs.readdirSync(mediaDir)
        .filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort();
      if (imgs.length) return path.join(mediaDir, imgs[0]);
    }
  } catch {}
  return null;
}

async function publishShort(db, queueEntry) {
  const short = db.getShort(queueEntry.short_id);
  if (!short) throw new Error(`short ${queueEntry.short_id} not found`);
  assertPublishable(short);

  const yt = await getYouTube();
  if (!yt) throw new Error('YouTube not authorized — complete /api/youtube/auth first');

  const settings = db.getSettings();
  const seo = JSON.parse(short.seo_json || '{}');
  const meta = JSON.parse(short.meta_json || '{}');
  const scheduledAt = new Date(queueEntry.scheduled_at);
  const publishInFuture = scheduledAt.getTime() - Date.now() > 60 * 1000;

  const snippet = {
    title: short.title.slice(0, 100),
    description: (seo.description || short.title).slice(0, 4900),
    tags: (seo.tags || []).slice(0, 15),
    categoryId: '27', // Education
  };
  const status = {
    privacyStatus: publishInFuture ? 'private' : (settings.youtube_privacy || 'public'),
    selfDeclaredMadeForKids: false,
  };
  if (publishInFuture) status.publishAt = scheduledAt.toISOString();

  const res = await yt.videos.insert({
    part: 'snippet,status',
    requestBody: { snippet, status },
    media: { body: fs.createReadStream(short.final_path) },
  });
  const videoId = res.data.id;

  // thumbnail (best-effort)
  try {
    const thumb = thumbnailFor(short);
    if (thumb) await yt.thumbnails.set({ videoId, media: { body: fs.createReadStream(thumb) } });
  } catch (err) { console.warn('[publisher] thumbnail upload failed:', err.message); }

  // captions (best-effort)
  try {
    const srt = meta.srt && fs.existsSync(meta.srt) ? meta.srt : null;
    if (srt) {
      await yt.captions.insert({
        part: 'snippet',
        requestBody: { snippet: { videoId, language: 'en', name: 'English' } },
        media: { body: fs.createReadStream(srt) },
      });
    }
  } catch (err) { console.warn('[publisher] caption upload failed:', err.message); }

  const url = `https://www.youtube.com/shorts/${videoId}`;
  db.updateShort(short.id, {
    status: 'published', youtube_id: videoId, youtube_url: url,
    published_at: DBNow(),
  });
  db.updatePublish(queueEntry.id, { status: 'published', youtube_id: videoId, error: null });
  db.notify('success', `Published: "${short.title}" → ${url}`);
  return { videoId, url };
}

function DBNow() { return new Date().toISOString(); }

/** Basic analytics refresh for published shorts (previous agent's analytics
 *  agent, minimal edition: public video statistics). */
async function refreshAnalytics(db) {
  const yt = await getYouTube();
  if (!yt) return 0;
  const published = db.listShorts('published').filter(s => s.youtube_id);
  if (!published.length) return 0;
  const ids = published.map(s => s.youtube_id).join(',');
  const res = await yt.videos.list({ part: 'statistics', id: ids });
  let n = 0;
  for (const item of res.data.items || []) {
    const st = item.statistics || {};
    db.run(`UPDATE shorts SET views=?, likes=?, comments=?, updated_at=? WHERE youtube_id=?`,
      parseInt(st.viewCount || 0), parseInt(st.likeCount || 0),
      parseInt(st.commentCount || 0), DBNow(), item.id);
    n++;
  }
  return n;
}

module.exports = { authUrl, exchangeCode, hasTokens, getYouTube, publishShort,
                   refreshAnalytics, assertPublishable };
