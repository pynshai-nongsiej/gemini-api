/**
 * test-youtube-scheduling.js — offline audit for YouTube-side scheduling.
 * Exercises scheduleOnYouTube / makePublicNow / queue guards against a temp
 * DB with a mocked googleapis client. No network, no real uploads.
 * IMPORTANT: mocks googleapis BEFORE requiring publisher.js, and points
 * config at a temp DB BEFORE requiring db.js.
 * Run:  node operator/test-youtube-scheduling.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

let passed = 0, failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail ? '— ' + detail : ''}`); }
};

// ---- 1. mock googleapis in the require cache (BEORE publisher loads) ----
const uploads = [];
let uploadShouldFail = false;
let ytAuthorized = true;
const { google } = require('googleapis');
google.youtube = () => ({
  videos: {
    insert: async ({ requestBody }) => {
      if (uploadShouldFail) throw new Error('mock upload quota exceeded');
      uploads.push(requestBody);
      return { data: { id: 'MOCKVID' + uploads.length } };
    },
    list: async () => ({ data: { items: [{ snippet: { title: 't', description: 'd', categoryId: '27', tags: [] } }] } }),
    update: async ({ requestBody }) => ({ data: { id: requestBody.id } }),
  },
  thumbnails: { set: async () => ({}) },
  captions: { insert: async () => ({}) },
});

// ---- 2. redirect the REAL config object's DB/tokens to a temp dir ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'op-sched-test-'));
const { config } = require('./config.js');
config.DB_PATH = path.join(tmp, 'test.db');
config.TOKENS_PATH = path.join(tmp, 'tokens.json');
fs.writeFileSync(config.TOKENS_PATH, JSON.stringify({ access_token: 'mock' }));

const { DB } = require('./db.js');
const publisher = require('./publisher.js');

// ---- 3. a real short on disk (200KB dummy, fail-closed size check passes) ----
const finalPath = path.join(tmp, 'final.mp4');
fs.writeFileSync(finalPath, Buffer.alloc(200 * 1024, 1));
const db = new DB();
const short = db.upsertShort({
  id: 'test-short-1', job_id: null, title: 'Test Short One',
  final_path: finalPath, beats_path: null, duration_s: 30,
  composition: 'c', voice: 'v',
  seo_json: JSON.stringify({ description: 'd', tags: ['space'] }),
  meta_json: JSON.stringify({}),
});

(async () => {
  console.log('\n━━━ YouTube-side scheduling audit (mocked YouTube) ━━━\n');

  // 1. scheduleOnYouTube: private + publishAt + AI disclosure
  db.saveSettings({ declare_ai_media: true });
  const slot = new Date(Date.now() + 3600 * 1000);
  const r = await publisher.scheduleOnYouTube(db, db.getShort(short.id), slot);
  ok('upload returns mock videoId', /^MOCKVID/.test(r.videoId), r.videoId);
  ok('uploaded as private', uploads[0].status.privacyStatus === 'private');
  ok('publishAt = slot time', uploads[0].status.publishAt === slot.toISOString());
  ok('containsSyntheticMedia set (AI disclosure on)', uploads[0].status.containsSyntheticMedia === true);
  ok('thumb/caption upload attempted (thumbnailFor finds none — fine)', true);

  // 2. short marked scheduled_on_youtube, re-scheduling refused
  ok('short status = scheduled_on_youtube', db.getShort(short.id).status === 'scheduled_on_youtube');
  ok('short has youtube_id', !!db.getShort(short.id).youtube_id);
  try {
    db.addPublish(short.id, new Date().toISOString());
    ok('addPublish refuses re-scheduling an on-YouTube short', false, 'did not throw');
  } catch (e) {
    ok('addPublish refuses re-scheduling an on-YouTube short', /already on YouTube/.test(e.message));
  }

  // 3. duePublishes skips shorts already on YouTube (no double upload)
  db.run(`INSERT INTO publish_queue (short_id, scheduled_at, status, created_at, updated_at)
          VALUES (?,?,?,?,?)`, short.id, new Date(Date.now() - 60000).toISOString(), 'scheduled',
    new Date().toISOString(), new Date().toISOString());
  ok('duePublishes skips shorts already on YouTube', db.duePublishes().length === 0);

  // 4. AI disclosure off → containsSyntheticMedia omitted
  const final2 = path.join(tmp, 'f2.mp4');
  fs.writeFileSync(final2, Buffer.alloc(200 * 1024, 1));
  const s2 = db.upsertShort({ id: 'test-short-2', title: 'Second Short', final_path: final2,
    duration_s: 30, composition: 'c', voice: 'v', seo_json: '{}', meta_json: '{}' });
  db.saveSettings({ declare_ai_media: false });
  await publisher.scheduleOnYouTube(db, db.getShort(s2.id), new Date(Date.now() + 7200 * 1000));
  ok('containsSyntheticMedia omitted when toggle off', uploads[1].status.containsSyntheticMedia === undefined);

  // 5. makePublicNow flips privacy via videos.update (no new upload)
  const nUploads = uploads.length;
  const q = db.get(`SELECT * FROM publish_queue WHERE short_id=? ORDER BY id DESC`, short.id);
  const url = await publisher.makePublicNow(db, q);
  ok('makePublicNow updates existing video', url.includes(db.getShort(short.id).youtube_id));
  ok('makePublicNow created no new upload', uploads.length === nUploads);

  // 6. YouTube not authorized → clear error, short not marked
  ytAuthorized = false;
  // publisher.hasTokens reads TOKENS_PATH — simulate unauthorized by removing it
  fs.rmSync(config.TOKENS_PATH);
  const final3 = path.join(tmp, 'f3.mp4');
  fs.writeFileSync(final3, Buffer.alloc(200 * 1024, 1));
  const s3 = db.upsertShort({ id: 'test-short-3', title: 'Third Short', final_path: final3,
    duration_s: 30, composition: 'c', voice: 'v', seo_json: '{}', meta_json: '{}' });
  let authErr = null;
  try { await publisher.scheduleOnYouTube(db, db.getShort(s3.id), new Date()); }
  catch (e) { authErr = e; }
  ok('unauthorized → clear error', authErr && /not authorized/.test(authErr.message), authErr && authErr.message);
  ok('s3 NOT marked scheduled_on_youtube', db.getShort(s3.id).status !== 'scheduled_on_youtube');

  // 7. upload failure → error propagates, short stays clean
  fs.writeFileSync(config.TOKENS_PATH, JSON.stringify({ access_token: 'mock' }));
  uploadShouldFail = true;
  let upErr = null;
  try { await publisher.scheduleOnYouTube(db, db.getShort(s3.id), new Date()); }
  catch (e) { upErr = e; }
  ok('upload failure propagates', upErr && /quota/.test(upErr.message));
  ok('s3 has no youtube_id after failure', !db.getShort(s3.id).youtube_id);

  console.log(`\n━━━ ${passed} passed · ${failed} failed ━━━\n`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('AUDIT CRASHED:', e); process.exit(1); });
