/* Local Shorts Operator dashboard — vanilla JS, no build step. */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const main = $('#main');
let apiKey = localStorage.getItem('op_api_key') || '';
let tab = 'generate';
let poll = null;

const api = {
  async req(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;
    const res = await fetch(url, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${method} ${url} → HTTP ${res.status}`);
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
  $('#toast').append(el);
  setTimeout(() => el.remove(), 5000);
}

function fmtDur(s) { return `${Math.round(s)}s`; }
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ---------------- readiness badge ---------------- */
async function refreshReadiness() {
  try {
    const r = await api.get('/api/readiness');
    const badge = $('#readiness-badge');
    badge.textContent = r.status === 'ready' ? '✓ ready' : `⚠ ${r.status}: ${r.blocking.join(', ')}`;
    badge.style.color = r.status === 'ready' ? 'var(--ok)' : 'var(--warn)';
  } catch (e) {
    $('#readiness-badge').textContent = '⚠ server unreachable';
  }
}

/* ---------------- generate tab ---------------- */
async function renderGenerate() {
  const [jobs, stats, runs] = await Promise.all([
    api.get('/api/jobs'), api.get('/api/stats'), api.get('/api/operator/runs'),
  ]);
  main.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="v">${stats.shorts.total}</div><div class="l">shorts total</div></div>
      <div class="stat"><div class="v">${stats.shorts.needs_review}</div><div class="l">needs review</div></div>
      <div class="stat"><div class="v">${stats.shorts.published}</div><div class="l">published</div></div>
      <div class="stat"><div class="v">${stats.jobs.queued}</div><div class="l">queued</div></div>
      <div class="stat"><div class="v">${stats.jobs.running}</div><div class="l">running</div></div>
      <div class="stat"><div class="v">${stats.producedThisWeek}</div><div class="l">this week</div></div>
    </div>

    <div class="panel">
      <h2>Generate a short</h2>
      <div class="field"><label>Topic</label>
        <input id="g-topic" placeholder="e.g. the planet that rains glass sideways" style="width:100%"></div>
      <div class="row">
        <div class="field" style="flex:1"><label>Style / niche</label>
          <input id="g-style" placeholder="space documentary"></div>
        <div class="field" style="flex:1"><label>Voice</label>
          <select id="g-voice">
            ${['bm_george','bf_emma','am_adam','af_nova','am_onyx','bm_daniel','af_sarah','am_eric']
              .map(v => `<option>${v}</option>`).join('')}
          </select></div>
        <div class="field" style="flex:1"><label>Music bed</label>
          <select id="g-music">
            <option value="">none</option>
            ${['ambient-pad','tech-pulse','lofi-warm','cinematic-min','docu-pluck']
              .map(v => `<option>${v}</option>`).join('')}
          </select></div>
      </div>
      <div class="row">
        <button class="btn primary" id="g-go">⚡ Generate</button>
        <button class="btn" id="g-auto">🤖 Auto: research topics & generate</button>
        <span class="dim">auto uses the local AI to pick fresh topics (history-aware, no duplicates)</span>
      </div>
    </div>

    <div class="panel">
      <h2>Job queue</h2>
      <table>
        <tr><th>Topic</th><th>Status</th><th>Created</th><th>Actions</th></tr>
        ${jobs.jobs.map(j => `
          <tr>
            <td><div>${esc(j.topic)}</div>
                ${j.error ? `<div class="dim mono" style="color:var(--err)">${esc(j.error).slice(0,120)}</div>` : ''}</td>
            <td><span class="pill ${j.status}">${j.status}</span></td>
            <td class="dim">${fmtDate(j.created_at)}</td>
            <td>
              ${['failed','cancelled','completed'].includes(j.status) ? `<button class="btn" onclick="resumeJob('${j.id}')">resume</button>` : ''}
              ${['queued','running'].includes(j.status) ? `<button class="btn danger" onclick="cancelJob('${j.id}')">cancel</button>` : ''}
              <button class="btn" onclick="showLog('${j.id}')">log</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="4" class="dim">no jobs yet</td></tr>'}
      </table>
    </div>

    ${runs.runs.length ? `
    <div class="panel">
      <h2>Operator runs</h2>
      <table>
        <tr><th>Run</th><th>Status</th><th>Planned</th><th>When</th></tr>
        ${runs.runs.map(r => `
          <tr><td class="mono">${r.id}</td>
              <td><span class="pill">${r.status}</span></td>
              <td>${r.planned_count}</td>
              <td class="dim">${fmtDate(r.created_at)}</td></tr>`).join('')}
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
      toast('job enqueued', 'ok');
      renderGenerate();
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#g-auto').onclick = async () => {
    try {
      const r = await api.post('/api/operator/start', {});
      toast(`operator planned ${r.topics.length} short(s)`, 'ok');
      renderGenerate();
    } catch (e) { toast(e.message, 'err'); }
  };
}

window.resumeJob = async (id) => {
  try { await api.post(`/api/jobs/${id}/resume`); toast('resumed', 'ok'); renderGenerate(); }
  catch (e) { toast(e.message, 'err'); }
};
window.cancelJob = async (id) => {
  try { await api.post(`/api/jobs/${id}/cancel`); toast('cancelling…', 'ok'); setTimeout(renderGenerate, 1500); }
  catch (e) { toast(e.message, 'err'); }
};
window.showLog = async (id) => {
  const { job } = await api.get(`/api/jobs/${id}`);
  openModal(`<h2 style="margin-top:0">Log — ${esc(job.topic)}</h2>
    <pre class="log">${esc(job.log || '(empty)')}</pre>
    <div class="row" style="margin-top:12px"><button class="btn" onclick="closeModal()">close</button></div>`);
};

/* ---------------- library / review ---------------- */
async function renderLibrary(reviewOnly = false) {
  const { shorts } = await api.get('/api/shorts');
  const list = reviewOnly ? shorts.filter(s => s.status === 'needs_review') : shorts;
  main.innerHTML = `
    <div class="panel" style="display:flex;align-items:center;gap:12px">
      <h2 style="margin:0">${reviewOnly ? 'Review queue (approval-first)' : 'Library'}</h2>
      <span class="dim">${list.length} short(s)${reviewOnly ? ' — approve requires confirm_reviewed (human gate)' : ''}</span>
    </div>
    <div class="grid cards">
      ${list.map(s => `
        <div class="card">
          ${s.videoUrl
            ? `<video src="${s.videoUrl}" controls preload="metadata" poster="${s.thumbnailUrl}"></video>`
            : `<div class="dim" style="padding:40px;text-align:center">no video file</div>`}
          <div class="body">
            <h3>${esc(s.title)}</h3>
            <div class="row" style="margin:6px 0">
              <span class="pill ${s.status}">${s.status}</span>
              <span class="meta">${fmtDur(s.duration_s)} · ${esc(s.voice || '')}</span>
            </div>
            <div class="row">
              <button class="btn" onclick="openShort('${s.id}')">inspect</button>
              ${s.status === 'needs_review' ? `
                <button class="btn primary" onclick="approveShort('${s.id}')">approve</button>
                <button class="btn danger" onclick="rejectShort('${s.id}')">reject</button>` : ''}
              ${s.youtube_url ? `<a class="btn" href="${s.youtube_url}" target="_blank">YouTube ↗</a>` : ''}
            </div>
          </div>
        </div>`).join('') || '<div class="dim">nothing here yet — generate some shorts</div>'}
    </div>`;
  updateReviewBadge(shorts);
}

window.openShort = async (id) => {
  const { short: s } = await api.get(`/api/shorts/${id}`);
  const seo = s.seo || {};
  openModal(`
    <h2 style="margin-top:0">${esc(s.title)}</h2>
    ${s.videoUrl ? `<video src="${s.videoUrl}" controls autoplay></video>` : ''}
    <div class="row" style="margin:14px 0">
      <span class="pill ${s.status}">${s.status}</span>
      <span class="meta">${fmtDur(s.duration_s)} · ${esc(s.composition)} · views ${s.views || 0}</span>
    </div>
    <div class="field"><label>Title (editable before approve)</label>
      <input id="m-title" value="${esc(s.title)}" style="width:100%"></div>
    <div class="field"><label>Description</label>
      <textarea id="m-desc" rows="3" style="width:100%">${esc(seo.description || '')}</textarea></div>
    <div class="field"><label>Tags (comma separated)</label>
      <input id="m-tags" value="${esc((seo.tags || []).join(', '))}" style="width:100%"></div>
    <div class="row">
      <button class="btn" onclick="saveMeta('${s.id}')">save metadata</button>
      ${s.status === 'needs_review' ? `
        <button class="btn primary" onclick="approveShort('${s.id}', true)">approve & schedule</button>
        <button class="btn danger" onclick="rejectShort('${s.id}', true)">reject</button>` : ''}
      <button class="btn" onclick="closeModal()">close</button>
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
  if (!confirm('Confirm you have REVIEWED this short (audio, captions, factual claims). Approve & schedule to publish queue?')) return;
  try {
    const r = await api.post(`/api/shorts/${id}/approve`, { confirm_reviewed: true });
    toast(`approved — scheduled ${fmtDate(r.scheduled_at)}`, 'ok');
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

/* ---------------- publish tab ---------------- */
async function renderPublish() {
  const [{ queue }, ytStatus] = await Promise.all([
    api.get('/api/publish-queue'), api.get('/api/youtube/status'),
  ]);
  main.innerHTML = `
    <div class="panel">
      <h2>YouTube connection</h2>
      ${ytStatus.authorized
        ? '<span class="pill published">authorized ✓</span> <span class="dim">uploads enabled</span>'
        : `<span class="pill failed">not authorized</span>
           <span class="dim">publishing will fail until you connect a channel —</span>
           <button class="btn" onclick="startYouTubeAuth()">connect YouTube</button>`}
    </div>
    <div class="panel">
      <h2>Publish queue</h2>
      <table>
        <tr><th>Short</th><th>Scheduled</th><th>Status</th><th>Actions</th></tr>
        ${queue.map(q => `
          <tr>
            <td>${esc(q.short_title || q.short_id)}
              ${q.youtube_id ? `<div><a href="https://youtu.be/${q.youtube_id}" target="_blank">${q.youtube_id} ↗</a></div>` : ''}
              ${q.error ? `<div class="dim" style="color:var(--err)">${esc(q.error).slice(0,140)}</div>` : ''}</td>
            <td class="dim">${fmtDate(q.scheduled_at)}</td>
            <td><span class="pill ${q.status}">${q.status}</span></td>
            <td>
              ${q.status === 'scheduled' ? `
                <button class="btn" onclick="queueAction(${q.id},'publish-now')">publish now</button>
                <button class="btn" onclick="queueAction(${q.id},'pause')">pause</button>` : ''}
              ${q.status === 'paused' ? `<button class="btn" onclick="queueAction(${q.id},'resume')">resume</button>` : ''}
              ${q.status === 'failed' ? `<button class="btn" onclick="queueAction(${q.id},'retry')">retry</button>` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="4" class="dim">queue empty — approve shorts to schedule them</td></tr>'}
      </table>
    </div>`;
}

window.queueAction = async (id, action) => {
  try {
    await api.post(`/api/publish-queue/${id}/${action}`);
    toast(action, 'ok');
    renderPublish();
  } catch (e) { toast(e.message, 'err'); }
};
window.startYouTubeAuth = async () => {
  try {
    const { url } = await api.get('/api/youtube/auth');
    open(`<a href="${url}" target="_blank">${url}</a>`) ?? window.open(url, '_blank');
    toast('complete the Google consent in the new tab');
  } catch (e) { toast(e.message, 'err'); }
};

/* ---------------- settings tab ---------------- */
async function renderSettings() {
  const { settings: s, api_key_set } = await api.get('/api/settings');
  const r = await api.get('/api/readiness');
  main.innerHTML = `
    <div class="panel">
      <h2>Component readiness</h2>
      ${Object.entries(r.checks || {}).map(([k, v]) => `
        <div class="check"><span class="s" style="color:${v.ok ? 'var(--ok)' : 'var(--warn)'}">${v.ok ? '✓' : '⚠'}</span>
          <b>${k}</b> <span class="dim">${esc(v.detail || '')}</span></div>`).join('')}
    </div>
    <div class="panel">
      <h2>Channel</h2>
      <div class="row">
        <div class="field" style="flex:1"><label>Channel name</label><input id="s-channel" value="${esc(s.channel_name)}"></div>
        <div class="field" style="flex:2"><label>Niche (drives auto topic research)</label><input id="s-niche" value="${esc(s.niche)}" style="width:100%"></div>
      </div>
      <div class="row">
        <div class="field"><label>Cadence / week</label><input id="s-cadence" type="number" min="1" max="21" value="${s.cadence_per_week}"></div>
        <div class="field"><label>Videos per run</label><input id="s-perrun" type="number" min="1" max="5" value="${s.videos_per_run}"></div>
        <div class="field" style="flex:1"><label>Default voice</label><input id="s-voice" value="${esc(s.default_voice)}"></div>
        <div class="field" style="flex:1"><label>Default style</label><input id="s-style" value="${esc(s.default_style)}" style="width:100%"></div>
      </div>
      <div class="field"><label>Publish slots (HH:MM, comma separated)</label>
        <input id="s-slots" value="${(s.publish_slots || []).join(', ')}" style="width:100%"></div>
      <div class="row" style="margin-top:8px">
        <label class="row" style="gap:6px"><input type="checkbox" id="s-auto" ${s.auto_generate ? 'checked' : ''}> auto-generate to fill weekly cadence</label>
        <label class="row" style="gap:6px"><input type="checkbox" id="s-autopr" ${s.auto_approve ? 'checked' : ''}> auto-approve (NOT recommended — removes the human gate)</label>
      </div>
    </div>
    <div class="panel">
      <h2>Security</h2>
      <div class="field"><label>API key ${api_key_set ? '(set ✓ — send as x-api-key header)' : '(not set — mutating routes are open!)'}</label>
        <div class="row">
          <input id="s-apikey" placeholder="${api_key_set ? '••••••••  (leave blank to keep)' : 'set a key to protect the API'}" style="flex:1">
          <button class="btn" onclick="saveAPIKey()">save key</button>
        </div></div>
    </div>
    <button class="btn primary" onclick="saveSettings()">save settings</button>`;

  window.saveSettings = async () => {
    try {
      await api.put('/api/settings', {
        channel_name: $('#s-channel').value,
        niche: $('#s-niche').value,
        cadence_per_week: parseInt($('#s-cadence').value) || 5,
        videos_per_run: parseInt($('#s-perrun').value) || 1,
        default_voice: $('#s-voice').value,
        default_style: $('#s-style').value,
        publish_slots: $('#s-slots').value.split(',').map(t => t.trim()).filter(Boolean),
        auto_generate: $('#s-auto').checked,
        auto_approve: $('#s-autopr').checked,
      });
      toast('settings saved', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  window.saveAPIKey = async () => {
    const v = $('#s-apikey').value.trim();
    if (!v && !api_key_set) return toast('enter a key first', 'err');
    if (v) { await api.put('/api/settings', { api_key: v }); localStorage.setItem('op_api_key', v); apiKey = v; }
    toast('API key saved — dashboard will send it automatically', 'ok');
  };
}

/* ---------------- modal + routing ---------------- */
function openModal(html) { $('#modal').innerHTML = html; $('#modal-bg').classList.add('open'); }
function closeModal() { $('#modal-bg').classList.remove('open'); }
window.closeModal = closeModal;

function updateReviewBadge(shorts) {
  const n = shorts.filter(s => s.status === 'needs_review').length;
  const el = $('#review-count');
  el.style.display = n ? 'inline-block' : 'none';
  el.textContent = n;
}

async function refresh() {
  await refreshReadiness();
  if (tab === 'generate') return renderGenerate();
  if (tab === 'library') return renderLibrary(false);
  if (tab === 'review') return renderLibrary(true);
  if (tab === 'publish') return renderPublish();
  if (tab === 'settings') return renderSettings();
}

$$('#nav button').forEach(b => b.onclick = () => {
  $$('#nav button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  tab = b.dataset.tab;
  refresh();
});

refresh();
poll = setInterval(() => {
  if (tab === 'generate' || tab === 'review') refresh();
}, 5000);
