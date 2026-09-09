/**
 * test-api.js — full feature audit for the Shorts Studio Operator.
 * Exercises every route (happy path + error paths + auth protection).
 * Run with the server up:  node operator/test-api.js
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3457';

let passed = 0, failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail ? '— ' + detail : ''}`); }
};

async function req(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log('\n━━━ Shorts Studio Operator — feature audit ━━━\n');

  // 1. health
  let r = await req('GET', '/health');
  ok('GET /health', r.status === 200 && r.data.status === 'healthy', JSON.stringify(r.data).slice(0, 80));

  // 2. readiness
  r = await req('GET', '/api/readiness');
  ok('GET /api/readiness ready', r.data.status === 'ready' && typeof r.data.checks === 'object');
  const checks = r.data.checks || {};
  ok('readiness: all generation components ok',
    ['web2api', 'kokoro', 'ffmpeg', 'remotion', 'node_deps'].every(k => checks[k]?.ok),
    Object.entries(checks).filter(([, v]) => !v.ok).map(([k]) => k).join(','));

  // 3. settings roundtrip
  r = await req('GET', '/api/settings');
  ok('GET /api/settings', r.status === 200 && r.data.settings && typeof r.data.api_key_set === 'boolean');
  const origNiche = r.data.settings.niche;
  r = await req('PUT', '/api/settings', { niche: 'audit-test-niche' });
  ok('PUT /api/settings (niche roundtrip)', r.data.settings?.niche === 'audit-test-niche');
  r = await req('PUT', '/api/settings', { niche: origNiche });
  ok('PUT /api/settings (restore)', r.data.settings?.niche === origNiche);

  // 4. job validation
  r = await req('POST', '/api/jobs', { topic: '' });
  ok('POST /api/jobs empty topic → 400', r.status === 400);
  r = await req('POST', '/api/jobs', { topic: 'x'.repeat(400) });
  ok('POST /api/jobs oversized topic → 400', r.status === 400);

  // 5. job lifecycle: create → cancel → resume → cancel (no generation cost)
  r = await req('POST', '/api/jobs', { topic: 'audit lifecycle test — never renders' });
  ok('POST /api/jobs valid → 202 + job', r.status === 202 && r.data.job?.id);
  const jobId = r.data.job.id;
  r = await req('POST', `/api/jobs/${jobId}/cancel`);
  ok('cancel fresh job', ['cancelled', 'killing'].includes(r.data.result), r.data.result);
  r = await req('GET', `/api/jobs/${jobId}`);
  ok('job status cancelled', r.data.job?.status === 'cancelled' || r.data.job?.status === 'queued', r.data.job?.status);
  if (r.data.job?.status === 'queued') { // cancel raced with worker pickup
    await req('POST', `/api/jobs/${jobId}/cancel`);
    await new Promise(res => setTimeout(res, 3000));
  }
  r = await req('POST', `/api/jobs/${jobId}/resume`);
  ok('resume cancelled job → queued', r.data.job?.status === 'queued' || r.data.job?.status === 'running');
  if (r.data.job?.status === 'running' || r.data.job?.status === 'queued') {
    await req('POST', `/api/jobs/${jobId}/cancel`);
    await new Promise(res => setTimeout(res, 3000));
  }

  // 6. missing job
  r = await req('GET', '/api/jobs/job_missing');
  ok('GET /api/jobs/:id 404', r.status === 404);

  // 7. shorts library
  r = await req('GET', '/api/shorts');
  ok('GET /api/shorts', r.status === 200 && Array.isArray(r.data.shorts));
  const short = r.data.shorts?.[0];
  if (short) {
    r = await req('GET', `/api/shorts/${short.id}`);
    ok('GET /api/shorts/:id', r.status === 200 && r.data.short?.id === short.id);

    // 8. metadata edit validation
    r = await req('PUT', `/api/shorts/${short.id}/meta`, { title: 'no' });
    ok('PUT meta invalid title → 400', r.status === 400);
    r = await req('PUT', `/api/shorts/${short.id}/meta`, { tags: 'not-an-array' });
    ok('PUT meta invalid tags → 400', r.status === 400);
    const origTitle = short.title;
    r = await req('PUT', `/api/shorts/${short.id}/meta`, { title: origTitle });
    ok('PUT meta valid → 200', r.status === 200 && r.data.short?.title === origTitle);

    // 9. publish before approve
    r = await req('POST', `/api/publish/${short.id}`, {});
    ok('publish non-approved short → 409', r.status === 409, `got ${r.status}`);
  } else {
    console.log('  (no shorts in library yet — skipping short-specific checks)');
  }

  // 10. approve gate on a needs_review short
  r = await req('GET', '/api/shorts?status=needs_review');
  const reviewable = r.data.shorts?.[0];
  if (reviewable) {
    r = await req('POST', `/api/shorts/${reviewable.id}/approve`, {});
    ok('approve without confirm_reviewed → 400', r.status === 400);
  } else {
    console.log('  (review queue empty — approve-gate check skipped)');
  }

  // 11. publish queue actions
  r = await req('GET', '/api/publish-queue');
  ok('GET /api/publish-queue', r.status === 200 && Array.isArray(r.data.queue));
  const entry = r.data.queue?.[0];
  if (entry) {
    r = await req('POST', `/api/publish-queue/${entry.id}/bogus-action`);
    ok('invalid queue action → 400', r.status === 400);
  }
  r = await req('POST', '/api/publish-queue/999999/pause');
  ok('queue action on missing entry → 404', r.status === 404);

  // 12. YouTube auth (unconfigured → helpful 400)
  r = await req('GET', '/api/youtube/auth');
  ok('GET /api/youtube/auth unconfigured → 400 + hint', r.status === 400 && !!r.data.hint);
  r = await req('GET', '/api/youtube/status');
  ok('GET /api/youtube/status', r.status === 200 && typeof r.data.authorized === 'boolean');

  // 13. notifications
  r = await req('GET', '/api/notifications');
  ok('GET /api/notifications', r.status === 200 && Array.isArray(r.data.notifications));
  r = await req('POST', '/api/notifications/read');
  ok('POST /api/notifications/read', r.status === 200);

  // 14. stats
  r = await req('GET', '/api/stats');
  ok('GET /api/stats', r.status === 200 && r.data.jobs && r.data.shorts && r.data.queue);

  // 15. operator runs list
  r = await req('GET', '/api/operator/runs');
  ok('GET /api/operator/runs', r.status === 200 && Array.isArray(r.data.runs));

  // 16. API key protection
  r = await req('PUT', '/api/settings', { api_key: 'audit-test-key' });
  ok('set API key', r.status === 200);
  r = await req('POST', '/api/jobs', { topic: 'should be blocked without key' });
  ok('mutating route without key → 401', r.status === 401, `got ${r.status}`);
  r = await req('GET', '/api/jobs');
  ok('read route still open with key set', r.status === 200);
  r = await req('POST', '/api/jobs', { topic: 'key-authenticated enqueue test' },
    { 'x-api-key': 'audit-test-key' });
  ok('mutating route with key → 202', r.status === 202);
  const keyedJob = r.data.job?.id;
  if (keyedJob) {
    await req('POST', `/api/jobs/${keyedJob}/cancel`, {}, { 'x-api-key': 'audit-test-key' });
    await new Promise(res => setTimeout(res, 3000));
    r = await req('GET', `/api/jobs/${keyedJob}`);
    if (r.data.job?.status === 'queued' || r.data.job?.status === 'running') {
      await req('POST', `/api/jobs/${keyedJob}/cancel`, {}, { 'x-api-key': 'audit-test-key' });
      await new Promise(res => setTimeout(res, 3000));
    }
  }
  r = await req('PUT', '/api/settings', { api_key: '' }, { 'x-api-key': 'audit-test-key' });
  ok('clear API key', r.status === 200);
  r = await req('POST', '/api/jobs', { topic: 'final unauthenticated validation' });
  ok('routes open again after clearing key', r.status === 202 || r.status === 409);
  if (r.data.job?.id) {
    await req('POST', `/api/jobs/${r.data.job.id}/cancel`);
    await new Promise(res => setTimeout(res, 3000));
    r = await req('GET', `/api/jobs/${r.data.job.id}`);
    if (r.data.job?.status === 'queued' || r.data.job?.status === 'running') {
      await req('POST', `/api/jobs/${r.data.job.id}/cancel`);
    }
  }

  console.log(`\n━━━ ${passed} passed · ${failed} failed ━━━\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('AUDIT CRASHED:', e); process.exit(1); });
