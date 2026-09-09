/* ============================================================
   Shorts Studio — operator dashboard (vanilla JS, no build)
   Views: overview · generate · review · library · publish · analytics · settings
   ============================================================ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let apiKey = localStorage.getItem('op_api_key') || '';
let tab = 'overview';
let pollTimer = null;
let lastStats = null;

const api = {
  async req(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;
    const res = await fetch(url, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  get: (u) => api.req('GET', u),
  post: (u, b) => api.req('POST', u, b ?? {}),
  put: (u, b) => api.req('PUT', u, b),
};

function toast(msg, cls = '') {
  const el = document.createElement('div');
  el.className = `toast ${cls}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 5200);
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dur = (s) => s ? `${Math.round(s)}s` : '—';
const when = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};
const VOICES = ['bm_george', 'bf_emma', 'am_adam', 'af_nova', 'am_onyx', 'bm_daniel', 'af_sarah', 'am_eric'];
const MUSIC = ['', 'ambient-pad', 'tech-pulse', 'lofi-warm', 'cinematic-min', 'docu-pluck'];

/* defensive accessors — an unexpected API shape must NEVER blank the page */
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' ? v : {});

/* surface ANY uncaught script error so it is diagnosable, never silent */
window.addEventListener('error', (e) => {
  toast(`UI error: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`, 'err');
});
window.addEventListener('unhandledrejection', (e) => {
  const m = e.reason?.message || String(e.reason);
  if (!/Failed to fetch|Load failed|NetworkError/i.test(m)) toast(`Async error: ${m}`, 'err');
});

/* ============ readiness + sidebar status ============ */
async function refreshStatus() {
  try {
    const r = obj(await api.get('/api/readiness'));
    const dot = $('#ready-dot'), title = $('#ready-title'), sub = $('#ready-sub');
    if (r.status === 'ready') {
      dot.className = 'ready-dot ok'; title.textContent = 'All systems ready';
      sub.textContent = 'pipeline operational';
    } else {
      dot.className = 'ready-dot warn';
      const blocking = arr(r.blocking);
      title.textContent = r.status === 'error' ? 'Readiness check failed'
        : `Degraded: ${blocking.join(', ') || 'unknown'}`;
      sub.textContent = 'click for details';
    }
  } catch {
    try {
      $('#ready-dot').className = 'ready-dot';
      $('#ready-title').textContent = 'Server unreachable';
      $('#ready-sub').textContent = './launch.sh operator';
    } catch { /* DOM not ready — ignore */ }
  }
  try {
    const yt = obj(await api.get('/api/youtube/status'));
    const card = $('#yt-card');
    card.classList.toggle('on', !!yt.authorized);
    $('#yt-status-icon').textContent = yt.authorized ? '✓' : '▷';
    $('#yt-status-text').textContent = yt.authorized ? 'YouTube connected' : 'YouTube not connected';
  } catch { /* non-fatal */ }
}

async function refreshBadges() {
  try {
    const s = obj(await api.get('/api/stats'));
    lastStats = s;
    const j = obj(s.jobs), sh = obj(s.shorts), q = obj(s.queue);
    const set = (id, n) => { const el = $(id); if (!el) return; el.hidden = !n; el.textContent = n; };
    set('#badge-gen', (j.queued ?? 0) + (j.running ?? 0));
    set('#badge-review', sh.needs_review ?? 0);
    set('#badge-pub', q.scheduled ?? 0);
  } catch { /* non-fatal */ }
}

/* ============ OVERVIEW ============ */
async function viewOverview() {
  const [statsR, shortsR, jobsR, notifR] = await Promise.all([
    api.get('/api/stats'), api.get('/api/shorts'), api.get('/api/jobs'),
    api.get('/api/notifications'),
  ]);
  const stats = obj(statsR);
  const shorts = arr(obj(shortsR).shorts);
  const jobs = arr(obj(jobsR).jobs);
  const notifications = arr(obj(notifR).notifications);
  const recent = shorts.slice(0, 6);
  const activeJobs = jobs.filter(j => ['queued', 'running'].includes(j.status));

  $('#main').innerHTML = `
    <div class="page-head">
      <h1>Overview</h1>
      <span class="sub">local shorts factory · NASA-first imagery · Kokoro voice</span>
      <span class="spacer"></span>
      <button class="btn primary" onclick="switchTab('generate')">✦ New short</button>
    </div>

    <div class="stats">
      <div class="stat"><div class="v">${obj(stats.shorts).total ?? 0}</div><div class="l">Shorts</div>
        <div class="hint">${stats.producedThisWeek ?? 0} this week</div></div>
      <div class="stat"><div class="v">${obj(stats.shorts).needs_review ?? 0}</div><div class="l">In review</div>
        <div class="hint">approval-first gate</div></div>
      <div class="stat"><div class="v">${obj(stats.shorts).published ?? 0}</div><div class="l">Published</div></div>
      <div class="stat"><div class="v">${obj(stats.jobs).running ?? 0}</div><div class="l">Rendering</div>
        <div class="hint">${obj(stats.jobs).queued ?? 0} queued</div></div>
      <div class="stat"><div class="v">${obj(stats.queue).scheduled ?? 0}</div><div class="l">Scheduled</div></div>
    </div>

    ${activeJobs.length ? `
    <div class="panel">
      <h2>Active now</h2>
      ${activeJobs.map(j => `
        <div style="padding:8px 0">
          <div class="row">
            <span class="pill ${j.status}">${j.status}</span>
            <b>${esc(j.topic)}</b>
          </div>
          <div class="prog"><div style="width:${j.status === 'running' ? 45 : 8}%"></div></div>
        </div>`).join('')}
    </div>` : ''}

    <div class="grid2">
      <div class="panel">
        <h2>Latest shorts</h2>
        ${recent.length ? `<table>
          ${recent.map(s => {
            const m = safeMeta(s);
            return `<tr>
              <td style="width:52px"><img src="${m.thumb}" style="width:44px;height:64px;object-fit:cover;border-radius:6px" onerror="this.style.visibility='hidden'"></td>
              <td><b>${esc(s.title)}</b><div class="dim" style="font-size:11.5px">
                ${dur(s.duration_s)} · <span class="src-badge ${m.majorSrc}">${m.majorLabel}</span> ${m.nasaCount}/${m.total} NASA</div></td>
              <td style="text-align:right"><span class="pill ${s.status}">${s.status}</span></td>
            </tr>`;
          }).join('')}
        </table>` : '<div class="dim">no shorts yet — generate your first one</div>'}
      </div>

      <div class="panel">
        <h2>Activity</h2>
        ${notifications.length ? notifications.slice(0, 8).map(n => `
          <div class="row" style="padding:6px 0;align-items:baseline">
            <span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;
              background:${{ success: 'var(--ok)', error: 'var(--err)', warn: 'var(--warn)', info: 'var(--accent)' }[n.level] || 'var(--dim)'}"></span>
            <div style="flex:1;font-size:12.5px">${esc(n.message)}</div>
            <div class="dimmer" style="font-size:10.5px">${when(n.created_at)}</div>
          </div>`).join('') : '<div class="dim">nothing yet</div>'}
      </div>
    </div>`;
}

function safeMeta(s) {
  let m = {};
  try { m = JSON.parse(s.meta_json || '{}'); } catch {}
  const assets = m.imageAssets || [];
  const nasa = assets.filter(a => a.source === 'nasa').length;
  return {
    thumb: `/media/projects/${s.id}/b00-hook.nasa.jpg`,
    nasaCount: m.nasa_images ?? nasa, total: m.images ?? (assets.length || 1),
    majorSrc: nasa > assets.length / 2 ? 'nasa' : (assets.length ? 'ai' : 'unknown'),
    majorLabel: nasa > assets.length / 2 ? 'NASA' : (assets.length ? 'AI' : '?'),
  };
}

/* ============ GENERATE ============ */
async function viewGenerate() {
  const [jobsR, runsR] = await Promise.all([
    api.get('/api/jobs'), api.get('/api/operator/runs')]);
  const jobs = arr(obj(jobsR).jobs);
  const runs = arr(obj(runsR).runs);

  $('#main').innerHTML = `
    <div class="page-head">
      <h1>Generate</h1><span class="sub">script · NASA-first images · Kokoro voice · render · SFX</span>
    </div>

    <div class="panel">
      <h2>New short</h2>
      <label class="f"><span class="lt">TOPIC</span>
        <input id="g-topic" placeholder="e.g. the moon quake that rang for an hour" autocomplete="off"></label>
      <div class="grid3">
        <label class="f"><span class="lt">STYLE / NICHE</span>
          <input id="g-style" placeholder="space documentary"></label>
        <label class="f"><span class="lt">VOICE (KOKORO)</span>
          <select id="g-voice">${VOICES.map(v => `<option>${v}</option>`).join('')}</select></label>
        <label class="f"><span class="lt">MUSIC BED</span>
          <select id="g-music">${MUSIC.map(v => `<option value="${v}">${v || 'none'}</option>`).join('')}</select></label>
      </div>
      <div class="row">
        <button class="btn primary" id="g-go">✦ Generate short</button>
        <button class="btn" id="g-auto">🤖 Auto-research & generate</button>
        <span class="dim" style="font-size:12px">auto picks fresh topics via local AI — full production history excluded</span>
      </div>
    </div>

    <div class="panel">
      <h2>Job queue</h2>
      ${jobs.length ? `<table>
        <tr><th>Topic</th><th style="width:110px">Status</th><th style="width:130px">Created</th><th style="width:190px">Actions</th></tr>
        ${jobs.map(j => `
          <tr>
            <td><b>${esc(j.topic)}</b>
              ${j.error ? `<div class="dim mono" style="color:var(--err);font-size:10.5px;margin-top:3px">${esc(j.error).slice(0, 110)}</div>` : ''}
              ${j.status === 'running' ? `<div class="prog"><div style="width:45%"></div></div>` : ''}</td>
            <td><span class="pill ${j.status}">${j.status}</span></td>
            <td class="dim">${when(j.created_at)}</td>
            <td>
              ${['failed', 'cancelled', 'completed'].includes(j.status) ? `<button class="btn sm" onclick="resumeJob('${j.id}')">resume</button>` : ''}
              ${['queued', 'running'].includes(j.status) ? `<button class="btn sm danger" onclick="cancelJob('${j.id}')">cancel</button>` : ''}
              <button class="btn sm ghost" onclick="showLog('${j.id}')">log</button>
            </td>
          </tr>`).join('')}
      </table>` : '<div class="dim">no jobs yet</div>'}
    </div>

    ${runs.length ? `
    <div class="panel">
      <h2>Operator runs</h2>
      <table>
        <tr><th>Run</th><th>Status</th><th>Planned</th><th>When</th></tr>
        ${runs.map(r => `<tr><td class="mono">${r.id}</td>
          <td><span class="pill">${r.status}</span></td>
          <td>${r.planned_count}</td><td class="dim">${when(r.created_at)}</td></tr>`).join('')}
      </table>
    </div>` : ''}`;

  $('#g-go').onclick = async () => {
    const topic = $('#g-topic').value.trim();
    if (!topic) return toast('enter a topic first', 'err');
    try {
      await api.post('/api/jobs', {
        topic, style: $('#g-style').value.trim() || undefined,
        voice: $('#g-voice').value, music: $('#g-music').value || undefined,
      });
      toast('job enqueued — NASA-first image hunt starting', 'ok');
      viewGenerate();
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#g-auto').onclick = async () => {
    try {
      const r = await api.post('/api/operator/start', {});
      toast(`operator planned ${r.topics.length} short(s)`, 'ok');
      viewGenerate();
    } catch (e) { toast(e.message, 'err'); }
  };
}

window.resumeJob = async (id) => {
  try { await api.post(`/api/jobs/${id}/resume`); toast('resumed', 'ok'); viewGenerate(); }
  catch (e) { toast(e.message, 'err'); }
};
window.cancelJob = async (id) => {
  if (!confirm('Cancel this generation?')) return;
  try { await api.post(`/api/jobs/${id}/cancel`); toast('cancelling…', 'ok'); setTimeout(viewGenerate, 1500); }
  catch (e) { toast(e.message, 'err'); }
};
window.showLog = async (id) => {
  const { job } = await api.get(`/api/jobs/${id}`);
  openModal(`
    <h2 style="font-size:16px;margin-bottom:14px">Log — ${esc(job.topic)}</h2>
    <pre class="log">${esc(job.log || '(empty)')}</pre>
    <div class="row" style="margin-top:14px"><button class="btn" onclick="closeModal()">close</button></div>`);
};

/* ============ REVIEW / LIBRARY ============ */
async function viewShorts(reviewOnly) {
  const shorts = arr(obj(await api.get('/api/shorts')).shorts);
  const list = reviewOnly ? shorts.filter(s => s.status === 'needs_review') : shorts;

  $('#main').innerHTML = `
    <div class="page-head">
      <h1>${reviewOnly ? 'Review queue' : 'Library'}</h1>
      <span class="sub">${reviewOnly ? 'approval-first — you are the quality gate' : `${list.length} short(s)`}</span>
    </div>
    ${list.length ? `<div class="cards">
      ${list.map(s => {
        const m = safeMeta(s);
        const assets = (() => { try { return JSON.parse(s.meta_json).imageAssets || []; } catch { return []; } })();
        return `
        <div class="card">
          <div class="media">
            ${s.videoUrl ? `<video src="${s.videoUrl}" controls preload="metadata"></video>` : `<div class="dim" style="display:grid;place-items:center;height:100%">no file</div>`}
            <div class="src-tag">
              ${assets.length ? `<span class="src-badge ${m.majorSrc}" title="${assets.filter(a=>a.source==='nasa').length} NASA / ${assets.filter(a=>a.source==='ai').length} AI">
                ${m.nasaCount}/${m.total} NASA</span>` : ''}
            </div>
          </div>
          <div class="body">
            <h3>${esc(s.title)}</h3>
            <div class="meta">${dur(s.duration_s)} · ${esc((s.voice || '').replace('kokoro:', ''))} · ${when(s.created_at)}</div>
            ${assets.length ? `<div class="asset-strip">${assets.map(a =>
              `<div class="a ${a.source}" title="${esc(a.title)} · ${a.source.toUpperCase()}" onclick="openShort('${s.id}')">
                 <img src="${a.url}" loading="lazy" onerror="this.parentElement.style.opacity=.2"></div>`).join('')}
            </div>` : ''}
            <div class="row">
              <span class="pill ${s.status}">${s.status}</span>
              <span class="spacer" style="flex:1"></span>
              ${s.status === 'needs_review' ? `
                <button class="btn sm primary" onclick="approveShort('${s.id}')">approve</button>
                <button class="btn sm danger" onclick="rejectShort('${s.id}')">reject</button>` : ''}
              <button class="btn sm" onclick="openShort('${s.id}')">inspect</button>
              ${s.youtube_url ? `<a class="btn sm" href="${s.youtube_url}" target="_blank">↗</a>` : ''}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>` : `<div class="panel dim">${reviewOnly ? 'review queue is empty ✨' : 'library is empty — generate a short first'}</div>`}`;
}

window.openShort = async (id) => {
  const { short: s } = await api.get(`/api/shorts/${id}`);
  const seo = s.seo || {};
  const assets = s.meta?.imageAssets || [];
  openModal(`
    <div class="row" style="margin-bottom:14px">
      <h2 style="font-size:17px;flex:1">${esc(s.title)}</h2>
      <span class="pill ${s.status}">${s.status}</span>
    </div>
    ${s.videoUrl ? `<video src="${s.videoUrl}" controls autoplay></video>` : ''}
    <div class="row" style="margin:14px 0">
      <span class="dim">${dur(s.duration_s)} · ${esc(s.composition)}</span>
      <span class="dim">· voice ${esc((s.voice || '').replace('kokoro:', ''))}</span>
      ${s.views ? `<span class="dim">· ▶ ${s.views} views</span>` : ''}
    </div>

    ${assets.length ? `
    <h2 style="font-size:12px;color:var(--dim);text-transform:uppercase;letter-spacing:.8px;margin:18px 0 10px">Beat imagery — ${assets.filter(a=>a.source==='nasa').length} NASA / ${assets.filter(a=>a.source==='ai').length} AI</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px">
      ${assets.map((a, i) => `
        <div style="border:1px solid var(--line);border-radius:10px;overflow:hidden">
          <img src="${a.url}" style="width:100%;aspect-ratio:9/16;object-fit:cover" loading="lazy">
          <div style="padding:7px 8px">
            <span class="src-badge ${a.source}">${a.source === 'nasa' ? 'NASA' : 'AI'}</span>
            <div class="dim" style="font-size:10px;margin-top:4px">${esc(a.title || '').slice(0, 60)}</div>
            ${a.details_url ? `<a href="${a.details_url}" target="_blank" style="font-size:10px">source ↗</a>` : ''}
          </div>
        </div>`).join('')}
    </div>` : ''}

    <h2 style="font-size:12px;color:var(--dim);text-transform:uppercase;letter-spacing:.8px;margin:18px 0 10px">Publish metadata</h2>
    <label class="f"><span class="lt">TITLE</span><input id="m-title" value="${esc(s.title)}"></label>
    <label class="f"><span class="lt">DESCRIPTION</span><textarea id="m-desc" rows="3">${esc(seo.description || '')}</textarea></label>
    <label class="f"><span class="lt">TAGS</span><input id="m-tags" value="${esc((seo.tags || []).join(', '))}"></label>
    <div class="row">
      <button class="btn" onclick="saveMeta('${s.id}')">save metadata</button>
      ${s.status === 'needs_review' ? `
        <button class="btn primary" onclick="approveShort('${s.id}', true)">approve & schedule</button>
        <button class="btn danger" onclick="rejectShort('${s.id}', true)">reject</button>` : ''}
      <span class="spacer" style="flex:1"></span>
      <button class="btn ghost" onclick="closeModal()">close</button>
    </div>`);
};

window.saveMeta = async (id) => {
  try {
    await api.put(`/api/shorts/${id}/meta`, {
      title: $('#m-title').value,
      description: $('#m-desc').value,
      tags: $('#m-tags').value.split(',').map(t => t.trim()).filter(Boolean),
    });
    toast('metadata saved', 'ok');
  } catch (e) { toast(e.message, 'err'); }
};
window.approveShort = async (id, inModal = false) => {
  if (!confirm('Confirm you REVIEWED this short (audio · captions · factual claims · NASA imagery titles). Approve & schedule?')) return;
  try {
    const r = await api.post(`/api/shorts/${id}/approve`, { confirm_reviewed: true });
    toast(`approved — publishes ${when(r.scheduled_at)}`, 'ok');
    if (inModal) closeModal();
    refresh();
  } catch (e) { toast(e.message, 'err'); }
};
window.rejectShort = async (id, inModal = false) => {
  if (!confirm('Reject this short?')) return;
  try {
    await api.post(`/api/shorts/${id}/reject`);
    toast('rejected', 'ok');
    if (inModal) closeModal();
    refresh();
  } catch (e) { toast(e.message, 'err'); }
};

/* ============ PUBLISH ============ */
async function viewPublish() {
  const [queueR, ytR] = await Promise.all([
    api.get('/api/publish-queue'), api.get('/api/youtube/status')]);
  const queue = arr(obj(queueR).queue);
  const yt = obj(ytR);

  $('#main').innerHTML = `
    <div class="page-head"><h1>Publish</h1>
      <span class="sub">YouTube upload · scheduled slots</span></div>

    <div class="panel">
      <h2>YouTube connection</h2>
      ${yt.authorized
        ? `<div class="row"><span class="pill published">✓ authorized</span>
             <span class="dim">uploads enabled — resumable upload, thumbnail + captions included</span></div>`
        : `<div class="row">
             <span class="pill failed">not connected</span>
             <span class="dim">publishing stays fail-closed until a channel is linked</span>
             <span class="spacer" style="flex:1"></span>
             <button class="btn" onclick="startYouTubeAuth()">connect YouTube</button>
           </div>`}
    </div>

    <div class="panel">
      <h2>Queue</h2>
      ${queue.length ? `<table>
        <tr><th>Short</th><th style="width:150px">Scheduled</th><th style="width:110px">Status</th><th style="width:230px">Actions</th></tr>
        ${queue.map(q => `
          <tr>
            <td><b>${esc(q.short_title || q.short_id)}</b>
              ${q.youtube_id ? `<div><a href="https://youtu.be/${q.youtube_id}" target="_blank" class="mono">${q.youtube_id} ↗</a></div>` : ''}
              ${q.error ? `<div class="dim mono" style="color:var(--err);font-size:10.5px">${esc(q.error).slice(0, 120)}</div>` : ''}</td>
            <td class="dim">${when(q.scheduled_at)}</td>
            <td><span class="pill ${q.status}">${q.status}</span></td>
            <td>
              ${q.status === 'scheduled' ? `
                <button class="btn sm primary" onclick="queueAction(${q.id},'publish-now')">publish now</button>
                <button class="btn sm" onclick="queueAction(${q.id},'pause')">pause</button>` : ''}
              ${q.status === 'paused' ? `<button class="btn sm" onclick="queueAction(${q.id},'resume')">resume</button>` : ''}
              ${q.status === 'failed' ? `<button class="btn sm" onclick="queueAction(${q.id},'retry')">retry</button>` : ''}
            </td>
          </tr>`).join('')}
      </table>` : '<div class="dim">queue empty — approve shorts in Review to schedule them</div>'}
    </div>`;
}
window.queueAction = async (id, action) => {
  try { await api.post(`/api/publish-queue/${id}/${action}`); toast(action, 'ok'); viewPublish(); }
  catch (e) { toast(e.message, 'err'); }
};
window.startYouTubeAuth = async () => {
  try {
    const { url } = await api.get('/api/youtube/auth');
    window.open(url, '_blank');
    toast('complete the Google consent in the new tab');
  } catch (e) { toast(e.message, 'err'); }
};

/* ============ ANALYTICS ============ */
async function viewAnalytics() {
  const shorts = arr(obj(await api.get('/api/shorts')).shorts);
  const pub = shorts.filter(s => s.status === 'published');
  const totalViews = pub.reduce((a, s) => a + (s.views || 0), 0);
  const totalLikes = pub.reduce((a, s) => a + (s.likes || 0), 0);
  const nasaShorts = shorts.filter(s => (safeMeta(s).nasaCount || 0) > 0).length;
  const nasaAssets = shorts.reduce((a, s) => a + (safeMeta(s).nasaCount || 0), 0);

  $('#main').innerHTML = `
    <div class="page-head"><h1>Analytics</h1><span class="sub">channel performance · imagery mix</span></div>

    <div class="stats">
      <div class="stat"><div class="v">${pub.length}</div><div class="l">Published</div></div>
      <div class="stat"><div class="v">${totalViews.toLocaleString()}</div><div class="l">Total views</div></div>
      <div class="stat"><div class="v">${totalLikes.toLocaleString()}</div><div class="l">Total likes</div></div>
      <div class="stat"><div class="v">${nasaAssets}</div><div class="l">NASA assets used</div>
        <div class="hint">across ${nasaShorts} short(s)</div></div>
    </div>

    ${pub.length ? `
    <div class="panel">
      <h2>Views per short</h2>
      <div class="bars">
        ${pub.slice(0, 12).map(s => {
          const max = Math.max(...pub.map(x => x.views || 1), 1);
          return `<div class="bar">
            <div class="bv">${(s.views || 0).toLocaleString()}</div>
            <div class="fill" style="height:${Math.max(3, ((s.views || 0) / max) * 110)}px"></div>
            <div class="bv" style="color:var(--dimmer)">${esc(s.title.slice(0, 12))}…</div>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}

    <div class="panel">
      <h2>All shorts</h2>
      ${shorts.length ? `<table>
        <tr><th>Title</th><th>Status</th><th>NASA / AI</th><th>Views</th><th>Likes</th><th>Published</th></tr>
        ${shorts.map(s => {
          const m = safeMeta(s);
          return `<tr>
            <td><b>${esc(s.title)}</b><div class="dimmer" style="font-size:10.5px">${esc(s.id)}</div></td>
            <td><span class="pill ${s.status}">${s.status}</span></td>
            <td><span class="src-badge ${m.majorSrc}">${m.nasaCount}/${m.total}</span></td>
            <td>${(s.views || 0).toLocaleString()}</td>
            <td>${(s.likes || 0).toLocaleString()}</td>
            <td class="dim">${when(s.published_at)}</td>
          </tr>`;
        }).join('')}
      </table>` : '<div class="dim">nothing yet</div>'}
    </div>`;
}

/* ============ SETTINGS ============ */
async function viewSettings() {
  const [settingsR, readyR] = await Promise.all([
    api.get('/api/settings'), api.get('/api/readiness')]);
  const settingsWrap = obj(settingsR);
  const s = obj(settingsWrap.settings);
  const api_key_set = !!settingsWrap.api_key_set;
  const r = obj(readyR);

  $('#main').innerHTML = `
    <div class="page-head"><h1>Settings</h1><span class="sub">pipeline · channel · security</span></div>

    <div class="grid2">
      <div class="panel">
        <h2>Component readiness</h2>
        ${Object.entries(r.checks || {}).map(([k, v]) => `
          <div class="check">
            <span class="s ${v.ok ? 'ok' : 'warn'}">${v.ok ? '✓' : '!'}</span>
            <div><b>${k}</b> <span class="dim" style="font-size:12px">${esc(v.detail || '')}</span>
            ${k === 'youtube' && !v.ok ? `<div class="dimmer" style="font-size:11px">optional — needed only for publishing</div>` : ''}</div>
          </div>`).join('')}
      </div>

      <div class="panel">
        <h2>Security</h2>
        <label class="f"><span class="lt">API KEY ${api_key_set ? '· SET ✓ (sent as x-api-key)' : '· NOT SET — routes are open!'}</span>
          <div class="row">
            <input id="s-apikey" type="password" placeholder="${api_key_set ? '•••••••• (blank keeps current)' : 'paste a strong key'}">
            <button class="btn" onclick="saveAPIKey(${api_key_set})">save</button>
          </div></label>
        <div class="dim" style="font-size:12px">When set, ALL mutating routes require the key. This dashboard stores it locally and sends it automatically.</div>
      </div>
    </div>

    <div class="panel">
      <h2>Channel & automation</h2>
      <div class="grid3">
        <label class="f"><span class="lt">CHANNEL NAME</span><input id="s-channel" value="${esc(s.channel_name)}"></label>
        <label class="f" style="grid-column:span 2"><span class="lt">NICHE — DRIVES AUTO TOPIC RESEARCH</span>
          <input id="s-niche" value="${esc(s.niche)}"></label>
      </div>
      <div class="grid3">
        <label class="f"><span class="lt">CADENCE / WEEK</span><input id="s-cadence" type="number" min="1" max="21" value="${s.cadence_per_week}"></label>
        <label class="f"><span class="lt">VIDEOS PER RUN</span><input id="s-perrun" type="number" min="1" max="5" value="${s.videos_per_run}"></label>
        <label class="f"><span class="lt">YOUTUBE PRIVACY</span>
          <select id="s-privacy">
            ${['public', 'unlisted', 'private'].map(p => `<option ${s.youtube_privacy === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select></label>
      </div>
      <div class="grid3">
        <label class="f"><span class="lt">DEFAULT VOICE</span><input id="s-voice" value="${esc(s.default_voice)}"></label>
        <label class="f"><span class="lt">DEFAULT STYLE</span><input id="s-style" value="${esc(s.default_style)}"></label>
        <label class="f"><span class="lt">PUBLISH SLOTS (HH:MM)</span><input id="s-slots" value="${(s.publish_slots || []).join(', ')}"></label>
      </div>

      <div class="setting-row">
        <label class="toggle"><input type="checkbox" id="s-auto" ${s.auto_generate ? 'checked' : ''}><span class="tr"></span></label>
        <div class="st"><b>Auto-generate</b><div class="d">scheduler researches & produces shorts to fill the weekly cadence</div></div>
      </div>
      <div class="setting-row">
        <label class="toggle"><input type="checkbox" id="s-autopr" ${s.auto_approve ? 'checked' : ''}><span class="tr"></span></label>
        <div class="st"><b>Auto-approve</b><div class="d">⚠ removes the human review gate — shorts publish without inspection</div></div>
      </div>

      <div class="row" style="margin-top:8px">
        <button class="btn primary" onclick="saveSettings()">save settings</button>
      </div>
    </div>`;

  window.saveSettings = async () => {
    try {
      await api.put('/api/settings', {
        channel_name: $('#s-channel').value,
        niche: $('#s-niche').value,
        cadence_per_week: parseInt($('#s-cadence').value) || 5,
        videos_per_run: parseInt($('#s-perrun').value) || 1,
        default_voice: $('#s-voice').value,
        default_style: $('#s-style').value,
        youtube_privacy: $('#s-privacy').value,
        publish_slots: $('#s-slots').value.split(',').map(t => t.trim()).filter(Boolean),
        auto_generate: $('#s-auto').checked,
        auto_approve: $('#s-autopr').checked,
      });
      toast('settings saved', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  window.saveAPIKey = async (wasSet) => {
    const v = $('#s-apikey').value.trim();
    if (!v && !wasSet) return toast('enter a key first', 'err');
    if (v) {
      await api.put('/api/settings', { api_key: v });
      localStorage.setItem('op_api_key', v);
      apiKey = v;
    }
    toast('API key saved — dashboard sends it automatically', 'ok');
  };
}

/* ============ router ============ */
window.switchTab = (t) => {
  tab = t;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  refresh();
};

async function refresh() {
  try {
    if (tab === 'overview') await viewOverview();
    else if (tab === 'generate') await viewGenerate();
    else if (tab === 'review') await viewShorts(true);
    else if (tab === 'library') await viewShorts(false);
    else if (tab === 'publish') await viewPublish();
    else if (tab === 'analytics') await viewAnalytics();
    else if (tab === 'settings') await viewSettings();
  } catch (e) {
    const offline = /failed to fetch|load failed|networkerror|connection refused/i.test(e.message || '');
    $('#main').innerHTML = `
      <div class="panel">
        <h2>⚠ ${offline ? 'Operator server unreachable' : `Error in ${tab} view`}</h2>
        <div class="dim mono" style="margin-bottom:10px">${esc(e.message || String(e))}</div>
        ${offline
          ? `<div class="dim">Start it with <span class="mono">./launch.sh operator</span> (dashboard: <span class="mono">http://localhost:3457</span>)</div>`
          : `<div class="dim">The view will retry automatically. If it persists, reload the page (⌘⇧R) and check the server console.</div>`}
      </div>`;
  }
  refreshStatus();
  refreshBadges();
}

function openModal(html) { $('#modal').innerHTML = html; $('#modal-bg').classList.add('open'); }
function closeModal() { $('#modal-bg').classList.remove('open'); }
window.closeModal = closeModal;

$$('.nav-item').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
switchTab('overview');
pollTimer = setInterval(() => {
  if (['overview', 'generate', 'review'].includes(tab)) refresh();
}, 6000);
