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
/* USA targeting: every timestamp renders in US Eastern Time with an ET label */
const when = (iso) => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(iso)) + ' ET';
  } catch { return String(iso); }
};
const VOICES = [
  'dynamic', 'bm_george', 'bf_emma', 'am_adam', 'af_nova', 'am_onyx',
  'bm_daniel', 'af_sarah', 'am_eric', 'bm_lewis', 'af_river', 'am_michael', 'bf_isabella'
];
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
  const [statsR, shortsR, jobsR, notifR, queueR] = await Promise.all([
    api.get('/api/stats'), api.get('/api/shorts'), api.get('/api/jobs'),
    api.get('/api/notifications'), api.get('/api/publish-queue').catch(() => ({})),
  ]);
  const nextDrops = arr(obj(queueR).channels)
    .flatMap(c => arr(c.upcoming).slice(0, 2).map(u => ({ ...u, channel: c.name, accent: (PIPELINE_META[c.pipeline] || {}).accent })))
    .sort((a, b) => String(a.time).localeCompare(String(b.time)))
    .slice(0, 4);
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

    ${nextDrops.length ? `
    <div class="next-drops">
      <div class="nd-label">Next drops · ET</div>
      ${nextDrops.map(d => `
        <div class="nd-item">
          <span class="nd-accent" style="background:${d.accent || 'var(--ink)'}"></span>
          <div><div class="nd-title">${esc(String(d.title).slice(0, 40))}</div>
          <div class="nd-sub">${esc(d.channel)} · ${esc(d.time)}${d.format === 'long' ? ' 🎬' : ''}</div></div>
        </div>`).join('')}
    </div>` : ''}

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
              <td style="width:52px">${m.thumb ? `<img src="${m.thumb}" style="width:44px;height:64px;object-fit:cover;border-radius:6px" onerror="this.style.visibility='hidden'">` : ''}</td>
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
  const ret = m.retention && Number(m.retention.avgViewPercentage);
  return {
    thumb: s.thumbnailUrl || (assets[0] && assets[0].url) || null,
    nasaCount: m.nasa_images ?? nasa, total: m.images ?? (assets.length || 1),
    majorSrc: nasa > assets.length / 2 ? 'nasa' : (assets.length ? 'ai' : 'unknown'),
    majorLabel: nasa > assets.length / 2 ? 'NASA' : (assets.length ? 'AI' : '?'),
    retention: Number.isFinite(ret) ? ret : null,
  };
}

/* ============ CHANNELS (multi-channel automation hub) ============ */
let channelsCache = [];

const PIPELINE_META = {
  space: { label: 'NASA space', icon: '🛰', desc: 'NASA-first imagery · Ken Burns + word-pop captions', accent: '#2563eb' },
  finance: { label: 'finance data-graphics', icon: '💰', desc: 'kinetic numbers · counter/bars/percent/rule graphics', accent: '#059669' },
  history: { label: 'archival history', icon: '🏛', desc: 'archive-first imagery · film grade + date/source stamps', accent: '#b45309' },
};
PIPELINE_META.finance.desc = 'kinetic numbers · counter/bars/percent/rule graphics over AI plates';

async function viewChannels() {
  const [channelsR, jobsR, runsR] = await Promise.all([
    api.get('/api/channels'), api.get('/api/jobs'), api.get('/api/operator/runs')]);
  const channels = arr(obj(channelsR).channels);
  channelsCache = channels;
  const jobs = arr(obj(jobsR).jobs);
  const runs = arr(obj(runsR).runs);

  $('#main').innerHTML = `
    <div class="page-head">
      <h1>Channels</h1>
      <span class="sub">each channel: own niche · pipeline · voice · slots · YouTube connection</span>
      <span class="spacer"></span>
      <button class="btn" onclick="openAddChannel()">+ add channel</button>
    </div>

    ${channels.length ? channels.map(c => {
      const meta = PIPELINE_META[c.pipeline] || { label: c.pipeline, icon: '◈', desc: '', accent: 'var(--accent)' };
      const st = obj(c.stats);
      const chanJobs = jobs.filter(j => (j.channel_id || 'cosmic-archive') === c.id);
      const activeJobs = chanJobs.filter(j => ['queued', 'running'].includes(j.status));
      const chanRuns = runs.filter(r => (r.channel_id || 'cosmic-archive') === c.id).slice(0, 3);
      return `
      <div class="panel channel-panel" id="chan-${c.id}">
        <div class="channel-head">
          <div class="channel-icon" style="border-color:${meta.accent}55;color:${meta.accent}">${meta.icon}</div>
          <div style="flex:1;min-width:0">
            <div class="row">
              <h2 style="margin:0">${esc(c.name)}</h2>
              <span class="pill" style="border-color:${meta.accent}66;color:${meta.accent}">${meta.label}</span>
              <span class="pill published">🇺🇸 USA</span>
              ${c.enabled ? '' : '<span class="pill failed">disabled</span>'}
            </div>
            <div class="dim" style="font-size:12px;margin-top:2px">${esc(c.niche || '')}</div>
          </div>
          <div class="channel-yt">
            ${c.youtube_authorized
              ? `<span class="pill published" title="tokens: ${esc(c.tokens_path || 'youtube_tokens.json')}">✓ YouTube connected</span>`
              : `<button class="btn sm" onclick="connectChannel('${c.id}')">connect YouTube</button>`}
          </div>
          <button class="btn sm ghost" onclick="openEditChannel('${c.id}')">edit</button>
        </div>

        <div class="stats channel-stats">
          <div class="stat"><div class="v">${obj(st.shorts).total ?? 0}</div><div class="l">Shorts</div>
            <div class="hint">${st.producedThisWeek ?? 0}/week · cadence ${c.cadence_per_week}</div></div>
          <div class="stat"><div class="v">${obj(st.shorts).needs_review ?? 0}</div><div class="l">In review</div></div>
          <div class="stat"><div class="v">${obj(st.shorts).published ?? 0}</div><div class="l">Published</div></div>
          <div class="stat"><div class="v">${obj(st.queue).scheduled + obj(st.queue).scheduled_on_youtube}</div><div class="l">Scheduled</div></div>
          <div class="stat"><div class="v">${obj(st.jobs).running ?? 0}</div><div class="l">Rendering</div>
            <div class="hint">${obj(st.jobs).queued ?? 0} queued</div></div>
        </div>

        <div class="row" style="margin:4px 0 10px">
          <button class="btn sm primary" onclick="runChannel('${c.id}')">🤖 auto-research & generate</button>
          <button class="btn sm" title="One topic, 3 different hook angles — the feed votes, winners teach the researcher" onclick="runChannelVariants('${c.id}')">🧪 A/B hook race (3)</button>
          <span class="dim" style="font-size:11.5px">${esc(meta.desc)} · voice ${esc(c.voice || 'dynamic')} · slots ${esc(c.slots_label || 'weekly table')}${c.duration_s ? ` · ${c.duration_s}s target` : ''}${c.auto_generate ? ' · auto-generate ON' : ''}</span>
        </div>

        ${activeJobs.length ? activeJobs.map(j => `
          <div style="padding:6px 0">
            <div class="row"><span class="pill ${j.status}">${j.status}</span><b>${esc(j.topic)}</b></div>
            <div class="prog"><div style="width:${j.status === 'running' ? 45 : 8}%"></div></div>
          </div>`).join('') : ''}

        <div class="grid2" style="margin-top:6px">
          <div>
            <div class="dimmer" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px">Latest for this channel</div>
            <div class="chan-shorts" id="chan-shorts-${c.id}">loading…</div>
          </div>
          <div>
            <div class="dimmer" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px">Recent operator runs</div>
            ${chanRuns.length ? `<table>${chanRuns.map(r => `
              <tr><td class="mono" style="font-size:10.5px">${r.id}</td>
              <td><span class="pill">${r.status}</span></td>
              <td>${r.planned_count}</td><td class="dim">${when(r.created_at)}</td></tr>`).join('')}</table>`
              : '<div class="dim" style="font-size:12px">no runs yet — hit auto-research above</div>'}
          </div>
        </div>
      </div>`;
    }).join('') : '<div class="panel dim">no channels — add one</div>'}`;

  // per-channel short strips (thumbnails)
  for (const c of channels) {
    try {
      const { shorts } = await api.get(`/api/channels/${c.id}/shorts`);
      const el = $(`#chan-shorts-${c.id}`);
      if (!el) continue;
      const list = arr(shorts).slice(0, 6);
      el.innerHTML = list.length ? list.map(s => {
        const m = safeMeta(s);
        return `<a class="chan-short" title="${esc(s.title)} (${s.status})" onclick="openShort('${s.id}');return false" href="#">
          ${m.thumb ? `<img src="${m.thumb}" loading="lazy" onerror="this.style.visibility='hidden'">` : '<div class="dim" style="font-size:9px;display:grid;place-items:center;height:100%">no img</div>'}
          <span class="pill ${s.status}" style="position:absolute;bottom:4px;left:4px;font-size:8.5px;padding:2px 5px">${s.status === 'published' ? '▲' : s.status[0]}</span>
        </a>`;
      }).join('') : '<div class="dim" style="font-size:12px">nothing yet</div>';
    } catch { /* strip is best-effort */ }
  }
}

window.runChannel = async (id) => {
  try {
    const r = await api.post(`/api/channels/${id}/start`, {});
    toast(`[${r.channel?.name || id}] operator planned ${r.topics.length} short(s)`, 'ok');
    viewChannels();
  } catch (e) { toast(e.message, 'err'); }
};

window.runChannelVariants = async (id) => {
  try {
    const r = await api.post(`/api/channels/${id}/start`, { variants: 3 });
    toast(`[${r.channel?.name || id}] A/B hook race started: 3 variants of "${(r.topics[0] || '').slice(0, 40)}…"`, 'ok');
    viewChannels();
  } catch (e) { toast(e.message, 'err'); }
};

window.connectChannel = async (id) => {
  try {
    const { url } = await api.get(`/api/youtube/auth?channel=${encodeURIComponent(id)}`);
    window.open(url, '_blank');
    toast('complete the Google consent in the new tab — it authorizes THIS channel');
    openModal(`
      <h2 style="font-size:16px;margin-bottom:10px">If Google says "Access blocked: … not completed the Google verification process"</h2>
      <div style="font-size:13.5px;line-height:1.6">
        The channel's OAuth app is in <b>Testing</b> mode. Fix (1 minute, in the app's Google Cloud Console):
        <ol style="margin:10px 0 10px 20px">
          <li><b>APIs & Services → OAuth consent screen</b> (may be labeled <b>Audience</b>)</li>
          <li>Under <b>Test users</b> → <b>+ Add users</b> → add the Google account you consent with (e.g. <span class="mono">pynshainongsiej0622@gmail.com</span>) → Save</li>
          <li>Retry the connect button — consent works immediately</li>
        </ol>
        <b>Recommended follow-up:</b> set Publishing status to <b>In production</b>. YouTube scopes are
        "sensitive", so Google shows an "unverified app" warning — click <b>Advanced → Go to (app)</b> once.
        That removes the 7-day test-token expiry so you don't re-connect every week.
      </div>
      <div class="row" style="margin-top:14px"><button class="btn" onclick="closeModal()">got it</button></div>`);
  } catch (e) { toast(e.message, 'err'); }
};

function channelFormHTML(c = {}) {
  return `
    <label class="f"><span class="lt">CHANNEL NAME</span><input id="cf-name" value="${esc(c.name || '')}"></label>
    <label class="f"><span class="lt">CHANNEL ID (slug, immutable)</span><input id="cf-id" value="${esc(c.id || '')}" ${c.id ? 'disabled' : ''} placeholder="my-second-channel"></label>
    <label class="f"><span class="lt">NICHE — DRIVES TOPIC RESEARCH</span><input id="cf-niche" value="${esc(c.niche || '')}"></label>
    <label class="f"><span class="lt">PIPELINE (script grammar + imagery + edit format)</span>
      <select id="cf-pipeline">
        ${Object.entries(PIPELINE_META).map(([k, m]) => `<option value="${k}" ${c.pipeline === k ? 'selected' : ''}>${m.icon} ${k} — ${m.label}</option>`).join('')}
      </select></label>
    <label class="f"><span class="lt">STYLE HINT</span><input id="cf-style" value="${esc(c.style || '')}"></label>
    <label class="f"><span class="lt">VOICE (KOKORO)</span>
      <select id="cf-voice">${VOICES.map(v => `<option value="${v}" ${c.voice === v ? 'selected' : ''}>${v === 'dynamic' ? '✦ dynamic (auto-pick)' : v}</option>`).join('')}</select></label>
    <label class="f"><span class="lt">CADENCE / WEEK</span><input id="cf-cadence" type="number" min="1" max="21" value="${c.cadence_per_week ?? 14}"></label>
    <label class="f"><span class="lt">VIDEOS PER RUN</span><input id="cf-perrun" type="number" min="1" max="5" value="${c.videos_per_run ?? 2}"></label>
    <label class="f"><span class="lt">TARGET DURATION (s, 20-58 — shorter = higher completion)</span>
      <input id="cf-duration" type="number" min="20" max="58" value="${c.duration_s ?? 40}"></label>
    <label class="f"><span class="lt">PUBLISH SLOTS — ET (HH:MM)</span><input id="cf-slots" value="${(c.publish_slots || []).join(', ')}" placeholder="13:00, 19:00"></label>
    <div class="setting-row">
      <label class="toggle"><input type="checkbox" id="cf-auto" ${c.auto_generate ? 'checked' : ''}><span class="tr"></span></label>
      <div class="st"><b>Auto-generate</b><div class="d">scheduler researches & produces this channel's cadence with its own niche</div></div>
    </div>
    <div class="setting-row">
      <label class="toggle"><input type="checkbox" id="cf-enabled" ${c.enabled ? 'checked' : ''}><span class="tr"></span></label>
      <div class="st"><b>Enabled</b><div class="d">disabled channels are skipped by the scheduler</div></div>
    </div>`;
}

function channelPayloadFromForm() {
  return {
    name: $('#cf-name').value.trim(),
    niche: $('#cf-niche').value.trim(),
    pipeline: $('#cf-pipeline').value,
    style: $('#cf-style').value.trim(),
    voice: $('#cf-voice').value,
    cadence_per_week: parseInt($('#cf-cadence').value) || 14,
    videos_per_run: parseInt($('#cf-perrun').value) || 2,
    duration_s: parseInt($('#cf-duration').value) || 40,
    publish_slots: $('#cf-slots').value.split(',').map(t => t.trim()).filter(Boolean),
    auto_generate: $('#cf-auto').checked,
    enabled: $('#cf-enabled').checked,
  };
}

window.openAddChannel = () => {
  openModal(`
    <h2 style="font-size:16px;margin-bottom:14px">Add channel</h2>
    ${channelFormHTML()}
    <div class="row" style="margin-top:14px">
      <button class="btn primary" onclick="submitAddChannel()">create channel</button>
      <button class="btn ghost" onclick="closeModal()">cancel</button>
    </div>`);
};

window.submitAddChannel = async () => {
  try {
    const payload = channelPayloadFromForm();
    payload.id = $('#cf-id').value.trim();
    const r = await api.post('/api/channels', payload);
    toast(`channel created: ${r.channel.name} — connect YouTube on its card`, 'ok');
    closeModal(); viewChannels();
  } catch (e) { toast(e.message, 'err'); }
};

window.openEditChannel = (id) => {
  const c = channelsCache.find(x => x.id === id);
  if (!c) return;
  openModal(`
    <h2 style="font-size:16px;margin-bottom:14px">Edit — ${esc(c.name)}</h2>
    ${channelFormHTML(c)}
    <div class="row" style="margin-top:14px">
      <button class="btn primary" onclick="submitEditChannel('${id}')">save</button>
      <button class="btn ghost" onclick="closeModal()">cancel</button>
    </div>`);
};

window.submitEditChannel = async (id) => {
  try {
    await api.put(`/api/channels/${id}`, channelPayloadFromForm());
    toast('channel saved', 'ok');
    closeModal(); viewChannels();
  } catch (e) { toast(e.message, 'err'); }
};

/* ============ GENERATE ============ */
async function viewGenerate() {
  const [jobsR, runsR, channelsR] = await Promise.all([
    api.get('/api/jobs'), api.get('/api/operator/runs'),
    api.get('/api/channels').catch(() => ({ channels: [] })),
  ]);
  const jobs = arr(obj(jobsR).jobs);
  const runs = arr(obj(runsR).runs);
  const channels = arr(obj(channelsR).channels);

  $('#main').innerHTML = `
    <div class="page-head">
      <h1>Generate</h1><span class="sub">per-channel · script · imagery · voice · render · SFX</span>
    </div>

    ${channels.length ? channels.map(c => {
      const meta = PIPELINE_META[c.pipeline] || { label: c.pipeline, icon: '◈', accent: 'var(--accent)' };
      return `
      <div class="panel">
        <h2>${meta.icon} ${esc(c.name)}
          <span class="pill" style="border-color:${meta.accent}66;color:${meta.accent}">${meta.label}</span>
          ${c.youtube_authorized
            ? '<span class="pill published">✓ YT connected</span>'
            : `<button class="btn sm" title="If Google says 'Access blocked', add your Google account as a TEST USER in the cloud console of this channel's OAuth app (see Settings)" onclick="connectChannel('${c.id}')">⚠ connect YouTube</button>`}
        </h2>
        <div class="grid3">
          <label class="f"><span class="lt">TOPIC — LEAVE BLANK IF USING AUTO-RESEARCH</span>
            <input id="g-topic-${esc(c.id)}" placeholder="e.g. ${esc(c.niche || '')}" autocomplete="off"></label>
          <label class="f"><span class="lt">VOICE</span>
            <select id="g-voice-${esc(c.id)}">${VOICES.map(v => `<option value="${v}" ${(c.voice || 'dynamic') === v ? 'selected' : ''}>${v === 'dynamic' ? '✦ dynamic (auto-pick)' : v}</option>`).join('')}</select></label>
          <label class="f"><span class="lt">MUSIC (none by default)</span>
            <select id="g-music-${esc(c.id)}">${MUSIC.map(v => `<option value="${v}" ${(c.music || '') === v ? 'selected' : ''}>${v || 'none'}</option>`).join('')}</select></label>
        </div>
        <div class="row">
          <button class="btn primary" onclick="genForChannel('${c.id}')">✦ Generate short</button>
          <button class="btn" onclick="autoForChannel('${c.id}')">🤖 Auto-research & generate</button>
          <button class="btn" title="One topic, 3 hook angles — the feed votes" onclick="raceForChannel('${c.id}')">🧪 A/B hook race</button>
          <button class="btn" title="16:9 chaptered documentary (~4 min) — drops on the channel's weekly long slot (${esc(c.long_slot || '—')} ET)" onclick="longForChannel('${c.id}')">🎬 Long-form</button>
        </div>
        <div class="dim" style="font-size:12px;margin-top:2px">${esc(c.niche || '')}</div>
      </div>`;
    }).join('') : '<div class="panel dim">no channels — add one in the Channels tab</div>'}

    <div class="panel">
      <h2>Job queue</h2>
      ${jobs.length ? `<table>
        <tr><th>Topic</th><th style="width:130px">Channel</th><th style="width:110px">Status</th><th style="width:130px">Created</th><th style="width:190px">Actions</th></tr>
        ${jobs.map(j => `
          <tr>
            <td><b>${esc(j.topic)}</b>
              ${j.variant_group ? `<span class="pill" style="font-size:9.5px;padding:2px 6px">🧪 ${esc(j.variant_group)}</span>` : ''}
              ${j.error ? `<div class="dim mono" style="color:var(--err);font-size:10.5px;margin-top:3px">${esc(j.error).slice(0, 110)}</div>` : ''}
              ${j.status === 'running' ? `<div class="prog"><div style="width:45%"></div></div>` : ''}</td>
            <td class="dim">${esc(channels.find(c => c.id === (j.channel_id || 'cosmic-archive'))?.name || j.channel_id || '—')}</td>
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
        <tr><th>Run</th><th>Channel</th><th>Status</th><th>Planned</th><th>When</th></tr>
        ${runs.map(r => `<tr><td class="mono">${r.id}</td>
          <td class="dim">${esc(channels.find(c => c.id === (r.channel_id || 'cosmic-archive'))?.name || r.channel_id || '—')}</td>
          <td><span class="pill">${r.status}</span></td>
          <td>${r.planned_count}</td><td class="dim">${when(r.created_at)}</td></tr>`).join('')}
      </table>
    </div>` : ''}`;

  window.genForChannel = async (id) => {
    const topic = $(`#g-topic-${id}`).value.trim();
    if (!topic) return toast('enter a topic first (or use auto-research)', 'err');
    try {
      await api.post('/api/jobs', {
        topic,
        voice: $(`#g-voice-${id}`).value,
        music: $(`#g-music-${id}`).value || undefined,
        channelId: id,
      });
      toast('job enqueued — imagery hunt starting', 'ok');
      viewGenerate();
    } catch (e) { toast(e.message, 'err'); }
  };
  window.autoForChannel = async (id) => {
    try {
      const r = await api.post(`/api/channels/${id}/start`, {});
      toast(`operator planned ${r.topics.length} short(s)`, 'ok');
      viewGenerate();
    } catch (e) { toast(e.message, 'err'); }
  };
  window.raceForChannel = async (id) => {
    try {
      const r = await api.post(`/api/channels/${id}/start`, { variants: 3 });
      toast(`A/B hook race: 3 variants of "${(r.topics[0] || '').slice(0, 36)}…"`, 'ok');
      viewGenerate();
    } catch (e) { toast(e.message, 'err'); }
  };
  window.longForChannel = async (id) => {
    const topic = $(`#g-topic-${id}`).value.trim();
    try {
      const r = await api.post(`/api/channels/${id}/long`, topic ? { topic } : {});
      toast(`🎬 long-form queued: "${(r.job?.topic || '').slice(0, 40)}…" — renders ~4min 16:9`, 'ok');
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
function removeShortCard(id) {
  const card = $(`#card-${id}`);
  if (card) {
    card.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.95)';
    setTimeout(() => {
      card.remove();
      const cards = $$('.cards .card');
      if (cards.length === 0) {
        const container = $('.cards');
        if (container && tab === 'review') {
          container.outerHTML = '<div class="panel dim">review queue is empty ✨</div>';
        }
      }
      const mainEl = $('#main');
      if (mainEl && mainEl.dataset.renderedKey) {
        const parts = mainEl.dataset.renderedKey.split('|').filter(p => !p.includes(id));
        mainEl.dataset.renderedKey = parts.join('|');
      }
    }, 250);
  }
}

async function viewShorts(reviewOnly) {
  // channel names are cosmetic — a missing/old /api/channels route must NEVER
  // blank the review or library views
  const shortsR = await api.get('/api/shorts');
  let chanName = new Map();
  try {
    const chansR = await api.get('/api/channels');
    chanName = new Map(arr(obj(chansR).channels).map(c => [c.id, c.name]));
  } catch { /* old server or transient — fall back to raw channel ids */ }
  const shorts = arr(obj(shortsR).shorts);
  const list = reviewOnly ? shorts.filter(s => s.status === 'needs_review') : shorts;

  const mainEl = $('#main');
  const viewType = reviewOnly ? 'review' : 'library';
  const listKey = `${viewType}:${list.map(s => `${s.id}:${s.status}:${s.title}`).join('|')}`;
  if (mainEl.dataset.renderedKey === listKey && mainEl.dataset.viewType === viewType) {
    return; // exact same short list: do NOT re-render or reload video elements
  }
  mainEl.dataset.renderedKey = listKey;
  mainEl.dataset.viewType = viewType;

  mainEl.innerHTML = `
    <div class="page-head">
      <h1>${reviewOnly ? 'Review queue' : 'Library'}</h1>
      <span class="sub">${reviewOnly ? 'approval-first — you are the quality gate' : `${list.length} short(s)`}</span>
    </div>
    ${list.length ? `<div class="cards">
      ${list.map(s => {
        const m = safeMeta(s);
        const assets = (() => { try { return JSON.parse(s.meta_json).imageAssets || []; } catch { return []; } })();
        return `
        <div class="card" id="card-${s.id}">
          <div class="media">
            ${s.videoUrl ? `<video src="${s.videoUrl}" controls preload="metadata"></video>` : `<div class="dim" style="display:grid;place-items:center;height:100%">no file</div>`}
            <div class="src-tag">
              ${assets.length ? `<span class="src-badge ${m.majorSrc}" title="${assets.filter(a=>a.source==='nasa').length} NASA / ${assets.filter(a=>a.source==='ai').length} AI">
                ${m.nasaCount}/${m.total} NASA</span>` : ''}
            </div>
          </div>
          <div class="body">
            <h3>${esc(s.title)}</h3>
            <div class="meta"><span class="src-badge ai" style="border-color:var(--line)">${esc(chanName.get(s.channel_id || 'cosmic-archive') || s.channel_id || 'channel')}</span> · ${dur(s.duration_s)} · ${esc((s.voice || '').replace('kokoro:', ''))} · ${when(s.created_at)}</div>
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
              ${s.status === 'approved' ? `
                <button class="btn sm danger" title="unapprove + remove from publish queue" onclick="rejectShort('${s.id}')">reject</button>` : ''}
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
      ${s.meta?.retention ? `<span class="dim">· 📈 ${Number(s.meta.retention.avgViewPercentage).toFixed(0)}% avg viewed</span>` : ''}
    </div>
    <div class="dim" style="font-size:11.5px;margin:-6px 0 10px;padding:8px 12px;border:1px solid var(--line);border-radius:8px">
      💡 After it publishes: set a <b>Related video</b> on the Short in YouTube Studio
      (Content → the Short → Related video) pointing at your channel's best performer —
      that's the official Shorts→long-form funnel and it compounds reach.
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
      ${s.status === 'approved' ? `
        <button class="btn danger" onclick="rejectShort('${s.id}', true)">reject (removes from queue)</button>` : ''}
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
    toast(r.youtube_scheduled
      ? `approved — YouTube publishes it ${when(r.scheduled_at)} (on YouTube's clock, Mac can be off)`
      : `approved — queued locally for ${when(r.scheduled_at)} (connect YouTube to schedule server-side)`, 'ok');
    if (inModal) closeModal();
    if (tab === 'review') {
      removeShortCard(id);
    } else {
      refresh();
    }
    refreshBadges();
  } catch (e) { toast(e.message, 'err'); }
};
window.rejectShort = async (id, inModal = false) => {
  if (!confirm('Reject this short?')) return;
  try {
    await api.post(`/api/shorts/${id}/reject`);
    toast('rejected', 'ok');
    if (inModal) closeModal();
    if (tab === 'review') {
      removeShortCard(id);
    } else {
      refresh();
    }
    refreshBadges();
  } catch (e) { toast(e.message, 'err'); }
};

/* ============ PUBLISH ============ */
const STATUS_DOT = {
  published: 'var(--ok)', scheduled_on_youtube: 'var(--accent-signal)',
  scheduled: 'var(--accent-signal)', publishing: 'var(--accent-signal)',
  failed: 'var(--err)', paused: 'var(--warn)',
};
function dayEntry(e) {
  const tip = e.note ? ` — ${e.note}` : '';
  if (e.open) return `<div class="sched-entry open" title="${esc(e.time + tip)}"><span class="st-time">${esc(e.time)}</span><span class="st-title">— open</span></div>`;
  const dot = STATUS_DOT[e.status] || 'var(--faint)';
  const st = e.status === 'published' ? '✓' : (e.status === 'scheduled_on_youtube' ? '▸' : '·');
  const long = e.format === 'long' ? ' 🎬' : '';
  return `<div class="sched-entry ${e.is_past ? 'past' : ''}" title="${esc(e.time + ' · ' + e.status + tip)}">
    <span class="st-time">${esc(e.time)}</span>
    <span class="st-dot" style="background:${dot}"></span>
    <span class="st-title">${st} ${esc(String(e.title).slice(0, 24))}${long}</span>
  </div>`;
}
async function viewPublish() {
  const [queueR, yt] = await Promise.all([
    api.get('/api/publish-queue'), api.get('/api/youtube/status')]);
  const queue = arr(obj(queueR).queue);
  const channels = arr(obj(queueR).channels);
  const tz = obj(queueR).timezone || 'America/New_York';
  const ytState = obj(yt).channels || {};

  $('#main').innerHTML = `
    <div class="page-head"><h1>Publish</h1>
      <span class="sub">USA schedule · all times US Eastern (${esc(tz)})</span></div>

    ${channels.map(c => {
      const next = arr(c.upcoming)[0];
      return `
      <div class="panel channel-panel" style="border-top:2px solid ${PIPELINE_META[c.pipeline]?.accent || 'var(--hair)'}33">
        <div class="channel-head">
          <div class="channel-icon" style="color:${PIPELINE_META[c.pipeline]?.accent || 'var(--ink)'}">${PIPELINE_META[c.pipeline]?.icon || '◈'}</div>
          <div style="flex:1;min-width:0">
            <div class="row">
              <h2 style="margin:0;font-size:14px">${esc(c.name)}</h2>
              <span class="pill published">🇺🇸 USA</span>
              <span class="pill">${esc(c.slots_label || 'weekly table')}</span>
              ${c.long_slot ? `<span class="pill" style="background:var(--tint-warn);color:var(--warn)">🎬 long: ${esc(c.long_slot)} ET</span>` : ''}
            </div>
            <div class="dim" style="font-size:12px;margin-top:5px">
              ${next
                ? `Next up: <b>${esc(String(next.title).slice(0, 44))}</b> — ${esc(next.time)} ${next.format === 'long' ? '🎬' : ''}`
                : 'Nothing scheduled — approve shorts to fill the calendar'}
            </div>
          </div>
          ${ytState[c.id]
            ? '<span class="pill published">✓ YouTube connected</span>'
            : `<button class="btn sm" onclick="connectChannel('${c.id}')">⚠ connect YouTube</button>`}
        </div>

        <div class="days-grid">
          ${(c.days || []).map(d => `
            <div class="day-card ${d.label.startsWith('Today') ? 'today' : ''}">
              <div class="day-label">${esc(d.label)}</div>
              ${(d.entries || []).length
                ? d.entries.map(dayEntry).join('')
                : '<div class="sched-entry open"><span class="st-title">—</span></div>'}
            </div>`).join('')}
        </div>
      </div>`;
    }).join('')}

    <div class="panel">
      <h2>Queue — all channels</h2>
      ${queue.length ? `<table>
        <tr><th>Short</th><th style="width:130px">Channel</th><th style="width:150px">Goes live (ET)</th><th style="width:120px">Status</th><th style="width:260px">Actions</th></tr>
      ${queue.map(q => `
          <tr>
            <td><b>${esc(q.short_title || q.short_id)}</b>
              ${(q.format || 'short') === 'long' ? '<span class="pill" style="font-size:9px">🎬 long</span>' : ''}
              ${q.youtube_id ? `<div><a href="https://youtu.be/${q.youtube_id}" target="_blank" class="mono">${q.youtube_id} ↗</a></div>` : ''}
              ${q.error ? `<div class="dim mono" style="color:var(--err);font-size:10.5px">${esc(q.error).slice(0, 110)}</div>` : ''}</td>
            <td class="dim">${esc(q.channel || '—')}</td>
            <td class="dim">${esc(q.scheduled_at_et || when(q.scheduled_at))}</td>
            <td><span class="pill ${q.status === 'scheduled_on_youtube' ? 'approved' : q.status}">${q.status === 'scheduled_on_youtube' ? 'scheduled (YT)' : q.status}</span></td>
            <td>
              ${q.status === 'scheduled' ? `
                <button class="btn sm primary" onclick="queueAction(${q.id},'publish-now')">publish now</button>
                <button class="btn sm" onclick="queueAction(${q.id},'pause')">pause</button>` : ''}
              ${q.status === 'scheduled_on_youtube' ? `
                <button class="btn sm primary" onclick="queueAction(${q.id},'publish-now')">publish now</button>
                <span class="dim" style="font-size:11px">on YouTube's clock</span>` : ''}
              ${q.status === 'paused' ? `<button class="btn sm" onclick="queueAction(${q.id},'resume')">resume</button>` : ''}
              ${q.status === 'failed' ? `<button class="btn sm" onclick="queueAction(${q.id},'retry')">retry</button>` : ''}
              ${q.status !== 'publishing' && q.status !== 'published' ? `
                <button class="btn sm danger" onclick="removeQueue(${q.id}, '${esc(q.short_title || q.short_id)}')">remove</button>` : ''}
            </td>
          </tr>`).join('')}
      </table>` : '<div class="dim">queue empty — approve shorts in Review to schedule them</div>'}
    </div>`;
}
window.queueAction = async (id, action) => {
  try { await api.post(`/api/publish-queue/${id}/${action}`); toast(action, 'ok'); viewPublish(); }
  catch (e) { toast(e.message, 'err'); }
};
window.removeQueue = async (id, title) => {
  if (!confirm(`Remove "${title}" from the publish queue?\nThe short stays approved — re-schedule or reject it from the Library.`)) return;
  try { await api.post(`/api/publish-queue/${id}/remove`); toast('removed from queue', 'ok'); viewPublish(); refresh(); }
  catch (e) { toast(e.message, 'err'); }
};

/* ============ ANALYTICS ============ *//* ============ ANALYTICS ============ *//* ============ ANALYTICS ============ */
let analyticsChan = 'cosmic-archive';
async function viewAnalytics() {
  const chansR = await api.get('/api/channels').catch(() => ({ channels: [] }));
  const channels = arr(obj(chansR).channels);
  const shorts = arr(obj(await api.get(`/api/shorts?channel=${encodeURIComponent(analyticsChan)}`)).shorts);
  const chan = channels.find(c => c.id === analyticsChan) || channels[0] || { name: 'All', pipeline: 'space' };
  const meta = PIPELINE_META[chan.pipeline] || { accent: 'var(--ink)', icon: '◈', label: chan.pipeline };
  const pub = shorts.filter(s => s.status === 'published');
  const totalViews = pub.reduce((a, s) => a + (s.views || 0), 0);
  const totalLikes = pub.reduce((a, s) => a + (s.likes || 0), 0);
  const nasaShorts = shorts.filter(s => (safeMeta(s).nasaCount || 0) > 0).length;
  const nasaAssets = shorts.reduce((a, s) => a + (safeMeta(s).nasaCount || 0), 0);
  const winners = pub.filter(s => (safeMeta(s).retention || 0) >= 70);
  const rets = pub.map(s => safeMeta(s).retention).filter(Number.isFinite);
  const avgRet = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null;
  const retCell = (s) => {
    const r = safeMeta(s).retention;
    if (!Number.isFinite(r)) return '<span class="dimmer">—</span>';
    const cls = r >= 70 ? 'published' : (r >= 50 ? 'approved' : 'failed');
    return `<span class="pill ${cls}" title="average view percentage — 70%+ feeds the research loop">${r.toFixed(0)}%</span>`;
  };

  $('#main').innerHTML = `
    <div class="page-head"><h1>Analytics</h1><span class="sub">channel performance · retention · imagery mix</span>
      <span class="spacer"></span>
      <button class="btn" onclick="refreshAnalyticsNow()">↻ refresh from YouTube</button></div>

    <div class="row" style="margin-bottom:22px">
      ${channels.map(c => `
        <button class="btn ${c.id === analyticsChan ? 'primary' : 'ghost'}" onclick="setAnalyticsChan('${c.id}')">${esc(c.name)}</button>`).join('')}
    </div>

    <div class="stats">
      <div class="stat"><div class="v">${pub.length}</div><div class="l">Published</div></div>
      <div class="stat"><div class="v">${totalViews.toLocaleString()}</div><div class="l">Total views</div></div>
      <div class="stat"><div class="v">${totalLikes.toLocaleString()}</div><div class="l">Total likes</div></div>
      <div class="stat"><div class="v">${nasaAssets}</div><div class="l">Real archive assets</div>
        <div class="hint">across ${nasaShorts} short(s)</div></div>
      <div class="stat"><div class="v">${avgRet ? avgRet.toFixed(0) + '%' : '—'}</div><div class="l">Avg retention</div>
        <div class="hint">measured shorts only</div></div>
      <div class="stat"><div class="v">${winners.length}</div><div class="l">70%+ retention</div>
        <div class="hint">${winners.length ? 'fed to the research loop' : 'needs published shorts with views + re-connected channels'}</div></div>
    </div>

    ${pub.length ? `
    <div class="panel">
      <h2>${meta.icon || ''} ${esc(chan.name)} — views per short</h2>
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
      <h2>All ${esc(chan.name)} shorts</h2>
      ${shorts.length ? `<table>
        <tr><th>Title</th><th>Status</th><th>NASA / AI</th><th>Views</th><th>Likes</th><th>Retention</th><th>Published</th></tr>
        ${shorts.map(s => {
          const m = safeMeta(s);
          return `<tr>
            <td><b>${esc(s.title)}</b><div class="dimmer" style="font-size:10.5px">${esc(s.id)}${s.variant_group ? ` · 🧪 ${esc(s.variant_group)}` : ''}</div></td>
            <td><span class="pill ${s.status}">${s.status}</span></td>
            <td><span class="src-badge ${m.majorSrc}">${m.nasaCount}/${m.total}</span></td>
            <td>${(s.views || 0).toLocaleString()}</td>
            <td>${(s.likes || 0).toLocaleString()}</td>
            <td>${retCell(s)}</td>
            <td class="dim">${when(s.published_at)}</td>
          </tr>`;
        }).join('')}
      </table>` : '<div class="dim">nothing yet</div>'}
    </div>`;
}
window.setAnalyticsChan = (id) => {
  analyticsChan = id;
  viewAnalytics();
};
window.refreshAnalyticsNow = async () => {
  try {
    const r = await api.post('/api/analytics/refresh');
    toast(`refreshed: ${r.views_updated} stats, ${r.retention_updated} retention (0 retention? re-connect YouTube to grant the new analytics permission)`, 'ok');
    viewAnalytics();
  } catch (e) { toast(e.message, 'err'); }
};

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
      <h2>Notifications & review from anywhere</h2>
      <div class="grid2">
        <label class="f"><span class="lt">WEBHOOK URL (Discord/Slack-compatible — posts every notification)</span>
          <input id="s-webhook" value="${esc(s.notify_webhook || '')}" placeholder="https://discord.com/api/webhooks/…"></label>
        <label class="f"><span class="lt">PUBLIC BASE URL (makes review links clickable from your phone)</span>
          <input id="s-baseurl" value="${esc(s.public_base_url || '')}" placeholder="https://your-tunnel.example.com"></label>
      </div>
      <div class="dim" style="font-size:12px">"Short ready for review" notifications then carry a tokenized approve/reject link — no API key exposed, valid for that one short only. For phone access over the internet, point public_base_url at a tunnel (e.g. <span class="mono">cloudflared tunnel --url localhost:3457</span>).</div>
      <div class="row" style="margin-top:8px">
        <button class="btn primary" onclick="saveNotify()">save</button>
      </div>
    </div>

    <div class="panel">
      <h2>Channel & automation</h2>
      <label class="f"><span class="lt">AUDIENCE COUNTRY — drives tags, SEO, topic bias, and metadata ('usa' = US English, $ amounts, ET slots)</span>
        <input id="s-audience" value="${esc(s.audience_country || 'usa')}"></label>
      <div class="dim" style="font-size:12px;margin:-6px 0 10px">
        USA targeting stack: US-English metadata (en-US) on every upload · USA tags from the SEO
        generator · US-resonant topic bias · slots in Eastern Time with Fri-PM/weekend boosts.
        One manual step: set the channel's <b>country to United States</b> in YouTube Studio → Settings → Channel (not available via API).</div>
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
        <label class="f"><span class="lt">PUBLISH SLOTS — US EASTERN (HH:MM)</span>
          <input id="s-slots" value="${(s.publish_slots || []).join(', ')}" placeholder="13:00, 19:00"></label>
      </div>
      <div class="dim" style="font-size:12px;margin:-6px 0 10px">
        USA audience targeting: slots are interpreted in <b>America/New_York</b> (ET), DST-safe.
        2 slots daily (13:00 + 19:00 ET = 1:00 PM & 7:00 PM ET) = 14 shorts/week — set cadence to 14 to auto-fill both slots.</div>

      <div class="setting-row">
        <label class="toggle"><input type="checkbox" id="s-auto" ${s.auto_generate ? 'checked' : ''}><span class="tr"></span></label>
        <div class="st"><b>Auto-generate</b><div class="d">scheduler researches & produces shorts to fill the weekly cadence</div></div>
      </div>
      <div class="setting-row">
        <label class="toggle"><input type="checkbox" id="s-aicheck" ${s.declare_ai_media ? 'checked' : ''}><span class="tr"></span></label>
        <div class="st"><b>Declare altered/synthetic content</b><div class="d">YouTube AI disclosure — marks uploads as containing altered or synthetic media (containsSyntheticMedia)</div></div>
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
        audience_country: $('#s-audience').value.trim().toLowerCase() || 'usa',
        channel_name: $('#s-channel').value,
        niche: $('#s-niche').value,
        cadence_per_week: parseInt($('#s-cadence').value) || 5,
        videos_per_run: parseInt($('#s-perrun').value) || 1,
        default_voice: $('#s-voice').value,
        default_style: $('#s-style').value,
        youtube_privacy: $('#s-privacy').value,
        declare_ai_media: $('#s-aicheck').checked,
        publish_slots: $('#s-slots').value.split(',').map(t => t.trim()).filter(Boolean),
        auto_generate: $('#s-auto').checked,
        auto_approve: $('#s-autopr').checked,
      });
      toast('settings saved', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  window.saveNotify = async () => {
    try {
      await api.put('/api/settings', {
        notify_webhook: $('#s-webhook').value.trim(),
        public_base_url: $('#s-baseurl').value.trim(),
      });
      toast('notification settings saved', 'ok');
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
  if (tab !== t) {
    const mainEl = $('#main');
    if (mainEl) {
      delete mainEl.dataset.renderedKey;
      delete mainEl.dataset.viewType;
    }
  }
  tab = t;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  refresh();
};

async function refresh() {
  try {
    if (tab === 'overview') await viewOverview();
    else if (tab === 'channels') await viewChannels();
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
  if (['overview', 'generate', 'channels'].includes(tab)) refresh();
  else {
    refreshBadges();
    refreshStatus();
  }
}, 6000);
