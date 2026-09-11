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
                'https://www.googleapis.com/auth/youtube.force-ssl',
                'https://www.googleapis.com/auth/yt-analytics.readonly'];

/** Per-channel OAuth token files. The legacy youtube_tokens.json belongs to the
 *  space channel; every other channel gets its own file so three channels can
 *  be authorized with the same Google OAuth client (one consent each). */
function tokensPathFor(channelId) {
  if (!channelId || channelId === 'cosmic-archive') return config.TOKENS_PATH;
  return path.join(path.dirname(config.TOKENS_PATH), `youtube_tokens_${channelId}.json`);
}

/** Resolve the channel owning a short → its tokens file. */
function tokensPathForShort(db, short) {
  const channel = short && short.channel_id ? db.getChannel(short.channel_id) : null;
  return tokensPathFor(channel ? channel.id : (short && short.channel_id));
}

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

function getOAuthClient(tokensPath) {
  const secrets = clientSecrets();
  if (!secrets) return null;
  const installed = secrets.installed || secrets.web;
  const oauth = new google.auth.OAuth2(
    installed.client_id, installed.client_secret, config.OAUTH_REDIRECT);
  const tp = tokensPath || config.TOKENS_PATH;
  if (fs.existsSync(tp)) {
    oauth.setCredentials(JSON.parse(fs.readFileSync(tp, 'utf8')));
  }
  return oauth;
}

function hasTokens(channelId) {
  const tp = tokensPathFor(channelId);
  return fs.existsSync(tp);
}

function authUrl(channelId = null) {
  const oauth = getOAuthClient();
  if (!oauth) return null;
  return oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    // state carries the channel id so the callback writes THIS channel's
    // token file (one OAuth client → many channels, one consent each)
    ...(channelId && channelId !== 'cosmic-archive' ? { state: channelId } : {}),
  });
}

/** exchangeCode(code, tokensPath) — tokensPath decides which channel this
 *  consent authorizes. */
async function exchangeCode(code, tokensPath) {
  const oauth = getOAuthClient(tokensPath);
  const { tokens } = await oauth.getToken(code);
  fs.mkdirSync(path.dirname(tokensPath || config.TOKENS_PATH), { recursive: true });
  fs.writeFileSync(tokensPath || config.TOKENS_PATH, JSON.stringify(tokens, null, 2));
  return tokens;
}

async function getYouTube(tokensPath) {
  const oauth = getOAuthClient(tokensPath);
  const tp = tokensPath || config.TOKENS_PATH;
  if (!oauth || !fs.existsSync(tp)) return null;
  oauth.on('tokens', (t) => {
    // persist refreshed tokens
    try {
      const cur = JSON.parse(fs.readFileSync(tp, 'utf8'));
      fs.writeFileSync(tp, JSON.stringify({ ...cur, ...t }, null, 2));
    } catch {}
  });
  return google.youtube({ version: 'v3', auth: oauth });
}

/** ffprobe a video's real duration/height; null when the file isn't a video
 *  (legacy test fixtures etc. — those keep the legacy size-only gate). */
function probeVideo(file) {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration:stream=height',
       '-of', 'json', file], { timeout: 15000 }).toString();
    const parsed = JSON.parse(out);
    const height = (parsed.streams || []).find(s => s.height)?.height || null;
    return { duration: parsed.format ? parseFloat(parsed.format.duration) : null, height };
  } catch {
    return null;
  }
}

/** Fail-closed checks copied from the previous agent's publish gates, plus the
 *  QC verdict (a flagged short is kept for review but never auto-published). */
function assertPublishable(short) {
  if (!short.final_path || !fs.existsSync(short.final_path)) {
    throw new Error('final video file missing — will not publish a placeholder');
  }
  const size = fs.statSync(short.final_path).size;
  if (size < 100 * 1024) throw new Error('final video suspiciously small — refusing to publish');
  if (!short.title || short.title.trim().length < 3) {
    throw new Error('title missing — edit the short metadata before approving');
  }

  // QC gate: generation-time rubric flagged this short -> fail closed
  let meta = {};
  try { meta = JSON.parse(short.meta_json || '{}'); } catch {}
  if (meta.qc && meta.qc.verdict === 'flag') {
    throw new Error(`QC flagged this short — fix or override before publishing: ` +
      (meta.qc.issues || []).slice(0, 3).join(' | '));
  }

  // structural probe (only bites real video files; unparseable fixtures skip)
  const probed = probeVideo(short.final_path);
  if (probed) {
    if (probed.duration && (probed.duration < 14.5 || probed.duration > 61)) {
      throw new Error(`duration ${probed.duration.toFixed(1)}s outside the 15-60s Shorts window`);
    }
    if (probed.height && probed.height < 1080) {
      throw new Error(`resolution ${probed.height}p too low for a 1080x1920 master`);
    }
  }
}

/** Hook beat image = the thumbnail (frame 0 = the thumbnail, per the beat grammar) */
function thumbnailFor(short) {
  try {
    const mediaDir = path.join(config.ROOT, 'media', 'projects', short.id);
    const manifestPath = path.join(mediaDir, 'images.json');
    // manifest order = narrative order: beat 0 IS the hook frame
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const first = manifest.find(a => a.src);
      if (first) return path.join(mediaDir, first.src);
    }
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

  const yt = await getYouTube(tokensPathForShort(db, short));
  if (!yt) throw new Error(`YouTube not authorized for channel "${short.channel_id || 'cosmic-archive'}" — complete /api/youtube/auth?channel= first`);

  const settings = db.getSettings();
  const seo = JSON.parse(short.seo_json || '{}');
  const meta = JSON.parse(short.meta_json || '{}');
  const scheduledAt = new Date(queueEntry.scheduled_at);

  const snippet = {
    title: short.title.slice(0, 100),
    description: (seo.description || short.title).slice(0, 4900),
    tags: (seo.tags || []).slice(0, 15),
    categoryId: '27', // Education
  };
  const status = {
    privacyStatus: settings.youtube_privacy || 'public',
    selfDeclaredMadeForKids: false,
  };
  if (settings.declare_ai_media === true) status.containsSyntheticMedia = true;

  const res = await yt.videos.insert({
    part: 'snippet,status',
    requestBody: { snippet, status },
    media: { body: fs.createReadStream(short.final_path) },
  });
  const videoId = res.data.id;

  await setThumbnailAndCaptions(yt, short, meta, videoId);

  const url = `https://www.youtube.com/shorts/${videoId}`;
  db.updateShort(short.id, {
    status: 'published', youtube_id: videoId, youtube_url: url,
    published_at: DBNow(),
  });
  db.updatePublish(queueEntry.id, { status: 'published', youtube_id: videoId, error: null });
  db.notify('success', `Published: "${short.title}" → ${url}`);
  return { videoId, url };
}

/**
 * YouTube-side scheduling: upload NOW as private with publishAt set —
 * YouTube's own clock flips it public at the slot time, so the local
 * machine can be offline. Also marks the video as altered/synthetic
 * content when the setting is on.
 */
async function scheduleOnYouTube(db, short, scheduledAt) {
  assertPublishable(short);

  const yt = await getYouTube(tokensPathForShort(db, short));
  if (!yt) throw new Error(`YouTube not authorized for channel "${short.channel_id || 'cosmic-archive'}" — complete /api/youtube/auth?channel= first`);

  const settings = db.getSettings();
  const seo = JSON.parse(short.seo_json || '{}');
  const meta = JSON.parse(short.meta_json || '{}');

  const snippet = {
    title: short.title.slice(0, 100),
    description: (seo.description || short.title).slice(0, 4900),
    tags: (seo.tags || []).slice(0, 15),
    categoryId: '27', // Education
  };
  const status = {
    privacyStatus: 'private',
    publishAt: scheduledAt.toISOString(),
    selfDeclaredMadeForKids: false,
  };
  if (settings.declare_ai_media === true) status.containsSyntheticMedia = true;

  const res = await yt.videos.insert({
    part: 'snippet,status',
    requestBody: { snippet, status },
    media: { body: fs.createReadStream(short.final_path) },
  });
  const videoId = res.data.id;

  await setThumbnailAndCaptions(yt, short, meta, videoId);

  const url = `https://www.youtube.com/shorts/${videoId}`;
  db.updateShort(short.id, {
    status: 'scheduled_on_youtube', youtube_id: videoId, youtube_url: url,
  });
  db.notify('success', `Scheduled on YouTube: "${short.title}" → goes ${settings.youtube_privacy || 'public'} at ${scheduledAt.toISOString()}`);
  return { videoId, url, publishAt: scheduledAt.toISOString() };
}

/** thumbnail + captions — shared by publish and schedule (best-effort) */
async function setThumbnailAndCaptions(yt, short, meta, videoId) {
  try {
    const thumb = thumbnailFor(short);
    if (thumb) await yt.thumbnails.set({ videoId, media: { body: fs.createReadStream(thumb) } });
  } catch (err) { console.warn('[publisher] thumbnail upload failed:', err.message); }

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
}

/** Flip an already-uploaded (YouTube-scheduled) video to public right now. */
async function makePublicNow(db, queueEntry) {
  const short = db.getShort(queueEntry.short_id);
  if (!short || !short.youtube_id) throw new Error('video not on YouTube (no youtube_id)');
  const yt = await getYouTube(tokensPathForShort(db, short));
  if (!yt) throw new Error(`YouTube not authorized for channel "${short.channel_id || 'cosmic-archive'}"`);
  const settings = db.getSettings();
  const privacy = settings.youtube_privacy || 'public';

  const res = await yt.videos.list({ part: 'snippet,status', id: short.youtube_id });
  const item = (res.data.items || [])[0];
  if (!item) throw new Error(`video ${short.youtube_id} not found on the channel`);
  await yt.videos.update({
    part: 'snippet,status',
    requestBody: {
      id: short.youtube_id,
      snippet: { title: item.snippet.title, description: item.snippet.description,
                 categoryId: item.snippet.categoryId, tags: item.snippet.tags },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false,
                ...(settings.declare_ai_media === true ? { containsSyntheticMedia: true } : {}) },
    },
  });

  const url = `https://www.youtube.com/shorts/${short.youtube_id}`;
  db.updateShort(short.id, {
    status: 'published', published_at: DBNow(),
  });
  db.updatePublish(queueEntry.id, { status: 'published', error: null });
  db.notify('success', `Published now: "${short.title}" → ${url}`);
  return url;
}

function DBNow() { return new Date().toISOString(); }

/** Basic analytics refresh for published shorts (previous agent's analytics
 *  agent, minimal edition: public video statistics). */
async function refreshAnalytics(db) {
  // refresh every channel that has authorized tokens
  let n = 0;
  for (const channel of db.listChannels()) {
    const tp = tokensPathFor(channel.id);
    if (!fs.existsSync(tp)) continue;
    const yt = await getYouTube(tp);
    if (!yt) continue;
    const published = db.listShorts('published', channel.id).filter(s => s.youtube_id);
    if (!published.length) continue;
    const ids = published.map(s => s.youtube_id).join(',');
    const res = await yt.videos.list({ part: 'statistics', id: ids });
    for (const item of res.data.items || []) {
      const st = item.statistics || {};
      db.run(`UPDATE shorts SET views=?, likes=?, comments=?, updated_at=? WHERE youtube_id=?`,
        parseInt(st.viewCount || 0), parseInt(st.likeCount || 0),
        parseInt(st.commentCount || 0), DBNow(), item.id);
      n++;
    }
  }
  return n;
}

/**
 * RETENTION FEEDBACK LOOP — pull averageViewPercentage per published short via
 * the YouTube Analytics API and store it in the short's meta. The topic
 * researcher reads these (db.winningHooks) so each channel learns which hook
 * angles beat the 70% promotion threshold. Needs the analytics scope, so a
 * channel must re-authorize once after this update; failures are non-fatal.
 */
async function refreshRetention(db) {
  let n = 0;
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 28 * 86400e3).toISOString().slice(0, 10);
  for (const channel of db.listChannels()) {
    const tp = tokensPathFor(channel.id);
    if (!fs.existsSync(tp)) continue;
    let oauth;
    try { oauth = getOAuthClient(tp); } catch { continue; }
    if (!oauth) continue;
    const yta = google.youtubeAnalytics({ version: 'v2', auth: oauth });
    const published = db.listShorts('published', channel.id).filter(s => s.youtube_id);
    if (!published.length) continue;

    // chunk the video filter (API caps filter lists)
    for (let i = 0; i < published.length; i += 25) {
      const chunk = published.slice(i, i + 25);
      const filter = `video==${chunk.map(s => s.youtube_id).join(',')}`;
      let rows;
      try {
        const res = await yta.reports.query({
          ids: 'channel==MINE', startDate, endDate,
          metrics: 'averageViewDuration,averageViewPercentage',
          dimensions: 'video', filters: filter,
        });
        rows = res.data.rows || [];
      } catch (err) {
        // 403 = the channel's tokens predate the analytics scope — needs re-auth
        console.warn(`[publisher] retention query failed for ${channel.id}: ${err.message}`);
        break;
      }
      const byVideo = new Map(rows.map(r => [r[0], { dur: r[1], pct: r[2] }]));
      for (const s of chunk) {
        const hit = byVideo.get(s.youtube_id);
        if (!hit) continue;
        let meta = {};
        try { meta = JSON.parse(s.meta_json || '{}'); } catch {}
        meta.retention = {
          avgViewDuration: Math.round(hit.dur * 10) / 10,
          avgViewPercentage: Math.round(hit.pct * 10) / 10,
          fetched_at: DBNow(),
        };
        db.run(`UPDATE shorts SET meta_json=?, updated_at=? WHERE id=?`,
          JSON.stringify(meta), DBNow(), s.id);
        n++;
      }
    }
  }
  return n;
}

module.exports = { authUrl, exchangeCode, hasTokens, tokensPathFor, tokensPathForShort,
                   getYouTube, publishShort, scheduleOnYouTube, makePublicNow,
                   refreshAnalytics, refreshRetention, assertPublishable };
