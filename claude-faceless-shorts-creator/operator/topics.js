/**
 * Autonomous topic research — the previous agent's content-strategy-agent,
 * local edition: the local AI proposes fresh short topics for the channel's
 * niche, with the FULL production history as an exclusion list (the same
 * zero-duplicate rule the space-shorts studio used).
 */
const { callLocalAI, extractJSON } = require('./seo');

async function researchTopics(db, count = 5, extraHints = '') {
  const settings = db.getSettings();
  const niche = extraHints || settings.niche || 'space and science mysteries';
  const produced = db.producedTitles();

  const exclusion = produced.length
    ? `\nALREADY PRODUCED (never repeat these concepts or near-duplicates):\n${produced.slice(-80).map(t => `- ${t}`).join('\n')}`
    : '';

  const prompt = `You are the head of content research for a faceless YouTube Shorts channel in the "${niche}" niche.
Propose ${count} FRESH, specific, high-retention short topics.

Rules:
- Each topic is ONE concrete, surprising fact, mechanism, or story — not a broad theme
- Bold claims, huge numbers, "the photo/sound/thing that..." angles win
- No generic listicles, no "top 10", no news that will age in a week
- Each must be explainable in ~40 seconds with still images${exclusion}

Return ONLY valid JSON: {"topics": ["...", "..."]}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await callLocalAI(prompt, 600);
      const data = extractJSON(raw);
      const topics = (data.topics || [])
        .map(t => String(t).trim())
        .filter(t => t.length > 10 && t.length < 200);
      if (topics.length) {
        // hard dedup against history (case-insensitive substring both ways)
        const lower = new Set(produced.map(t => t.toLowerCase()));
        const fresh = topics.filter(t => {
          const tl = t.toLowerCase();
          return ![...lower].some(p => p.includes(tl) || tl.includes(p));
        });
        return fresh.length ? fresh : topics; // if all dups, still return (AI tried)
      }
    } catch (err) {
      if (attempt === 2) throw new Error(`topic research failed: ${err.message}`);
    }
  }
  throw new Error('topic research failed after 3 attempts');
}

/** Run an autonomous operator cycle: research → enqueue N jobs (previous
 *  agent's AutonomousChannelOperator.execute, condensed). */
async function runOperatorCycle(db, { count = null, hints = '' } = {}) {
  const settings = db.getSettings();
  const n = Math.max(1, Math.min(5, count || settings.videos_per_run || 1));
  const topics = await researchTopics(db, n + 2, hints); // research extras, use best N
  const chosen = topics.slice(0, n);

  const run = db.createOperatorRun(chosen.length);
  const jobs = [];
  for (const topic of chosen) {
    db.addTopic(topic, 'operator');
    jobs.push(db.createJob({ topic, source: 'operator', operatorRunId: run.id }));
  }
  db.updateOperatorRun(run.id, {
    status: 'completed',
    summary_json: JSON.stringify({ planned: chosen, jobs: jobs.map(j => j.id) }),
  });
  db.notify('info', `Operator planned ${chosen.length} short(s): ${chosen.map(t => `"${t.slice(0, 40)}…"`).join(', ')}`);
  return { run, topics: chosen, jobs };
}

module.exports = { researchTopics, runOperatorCycle };
