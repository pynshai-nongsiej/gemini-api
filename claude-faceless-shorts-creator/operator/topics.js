/**
 * Autonomous topic research — the previous agent's content-strategy-agent,
 * local edition: the local AI proposes fresh short topics, with the FULL
 * production history OF THAT CHANNEL as an exclusion list (zero-duplicate
 * rule), and pipeline-specific topic shapes:
 *
 *   space    — startling fact/mechanism stories (NASA-tellable imagery)
 *   finance  — diagnostic numeric hooks: rules-of-thumb, milestone audits,
 *              hidden systemic costs (the viewer's own numbers)
 *   history  — evidence-first investigations: declassified incidents, forensic
 *              failures, geopolitical anomalies anchored to a date/place
 */
const { callLocalAI, extractJSON } = require('./seo');

const PIPELINE_TOPIC_RULES = {
  space: `- Each topic is ONE concrete, surprising fact, mechanism, or story — not a broad theme
- Bold claims, huge numbers, "the photo/sound/thing that..." angles win
- Prefer NASA / US missions / US observatories when natural (the audience is American)
- Each must be explainable in ~40 seconds with real astronomical imagery`,
  finance: `- Each topic is a DIAGNOSTIC hook about the viewer's own money: a specific numerical
  error, rule-of-thumb, milestone audit, or hidden systemic cost (dealership financing math,
  bank sweep rates, cohort net-worth medians, tax-advantaged account mechanics)
- USA audience ONLY: all figures in DOLLARS with US institutions — 401k, Roth IRA, US banks,
  US credit scores, US median incomes, US dealership/tax rules. No euro/pound/foreign framing
- The topic MUST contain at least one concrete number, percentage, or dollar figure
- No abstract economic theory, no generic budgeting tips, no "top 5" lists
- Each must be explainable in ~40 seconds with on-screen data graphics and kinetic numbers`,
  history: `- Each topic is an EVIDENCE-FIRST investigation: a declassified incident, a forensic
  engineering failure, a geographical/legal anomaly, a sealed report — anchored to a specific
  year, place, and physical artifact (document, blueprint, border, structure)
- Lead with the startling artifact or anomaly itself, never with background
- No wars-overview, no "history of X" — one incident, one mechanism
- USA audience: PREFER American incidents, places, and declassified US programs (US
  infrastructure failures, US declassified files, US borders/land quirks) — while keeping
  the story gripping for an American viewer
- Each must be explainable in ~40 seconds with archival photos, maps, and documents`,
};

/** A/B hook angles per pipeline — each variant rewrites the SAME topic's first
 *  3 seconds a different way (the swipe-away window). These ride into the
 *  script prompt as a HOOK REQUIREMENT. */
const HOOK_VARIANTS = {
  space: [
    'Open on the single most physically impossible-seeming detail, stated as plain fact in under 8 words. No scene-setting.',
    'Open with a huge on-screen number or measurement that demands explanation, then undercut it immediately.',
    'Open with "This is not X. It is Y." — misdirect then flip on frame 0.',
  ],
  finance: [
    'Open with a diagnostic percentage of the viewer\'s own paycheck/payment that indicts them. The number IS frame 0.',
    'Open with what "$X quietly disappears from" framing — a hidden monthly loss named to the dollar.',
    'Open with the median-vs-you comparison: "The average 30-year-old has $X. You probably have less."',
  ],
  history: [
    'Open on the physical artifact or anomaly itself with its exact date. No context before the evidence.',
    'Open with the death/damage toll and the absurdly small cause in one sentence.',
    'Open with the sealed/hidden document fact: "The report was classified for N years because…"',
  ],
};

async function researchTopics(db, count = 5, extraHints = '', channelId = null) {
  const channel = channelId ? db.getChannel(channelId) : null;
  const settings = db.getSettings();
  const niche = (channel && channel.niche) || extraHints || settings.niche || 'space and science mysteries';
  const pipeline = (channel && channel.pipeline) || 'space';
  const produced = db.producedTitles(channelId);

  const exclusion = produced.length
    ? `\nALREADY PRODUCED (never repeat these concepts or near-duplicates):\n${produced.slice(-80).map(t => `- ${t}`).join('\n')}`
    : '';

  // retention feedback loop: hooks from THIS channel's shorts that beat the
  // 70% promotion threshold teach the researcher what works here
  const winners = channelId ? db.winningHooks(channelId) : [];
  const winnersBlock = winners.length
    ? `\nHOOKS THAT MEASURED ABOVE 70% RETENTION ON THIS CHANNEL (study and imitate their angle, never their topic):\n${winners.slice(0, 8).map(w => `- "${w.hook || w.title}" (${Math.round(w.retention)}% retention)`).join('\n')}`
    : '';

  // comment mining: questions the audience literally asked under published
  // shorts — the highest-signal topic source there is
  const questions = channelId ? db.minedQuestions(channelId) : [];
  const questionsBlock = questions.length
    ? `\nVIEWER QUESTIONS mined from this channel's comment section (PRIORITIZE these — real people are asking):\n${questions.map(q => `- ${q.title}`).join('\n')}`
    : '';

  const prompt = `You are the head of content research for a faceless YouTube Shorts channel in the "${niche}" niche.
Propose ${count} FRESH, specific, high-retention short topics.

Rules:
${PIPELINE_TOPIC_RULES[pipeline] || PIPELINE_TOPIC_RULES.space}
- No generic listicles, no "top 10", no news that will age in a week
- Each must be explainable in ~40 seconds${extraHints ? `\nEXTRA HINTS: ${extraHints}` : ''}${winnersBlock}${questionsBlock}${exclusion}

Return ONLY valid JSON: {"topics": ["...", "..."]}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await callLocalAI(prompt, 600);
      const data = extractJSON(raw);
      const topics = (data.topics || [])
        .map(t => String(t).trim())
        .filter(t => t.length > 10 && t.length < 200);
      if (topics.length) {
        // hard dedup against history (substring both ways + token overlap —
        // "the 401k fee trap" must not sail through because "the 401(k) trap" differs)
        const lower = produced.map(t => t.toLowerCase());
        const toks = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3));
        const overlap = (a, b) => {
          const A = toks(a), B = toks(b);
          if (!A.size || !B.size) return 0;
          let inter = 0;
          for (const w of A) if (B.has(w)) inter++;
          return inter / Math.min(A.size, B.size);
        };
        const recent = lower.slice(-40);
        const fresh = topics.filter(t => {
          const tl = t.toLowerCase();
          if (lower.some(p => p.includes(tl) || tl.includes(p))) return false;
          if (recent.some(p => overlap(tl, p) > 0.6)) return false;
          return true;
        });
        return fresh.length ? fresh : topics; // if all dups, still return (AI tried)
      }
    } catch (err) {
      if (attempt === 2) throw new Error(`topic research failed: ${err.message}`);
    }
  }
  throw new Error('topic research failed after 3 attempts');
}

/** Curiosity scoring — rank fresh topics BEFORE spending generation compute.
 *  The local AI scores each candidate on the retention levers; on any failure
 *  the original order is kept (scoring must never block the cycle). */
async function scoreCuriosity(topics, niche) {
  const prompt = `You rate short-video topics for a faceless YouTube Shorts channel in the "${niche}" niche.
For each topic, score 0-10 (integers):
- curiosity: would a scroller NEED to know the answer? (contradiction, shock, impossible-seeming claim)
- specificity: concrete object/number/event, not a vague theme
- visual: can it be told with striking real imagery in ~40s?

TOPICS:
${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Return ONLY valid JSON: {"scores": [{"index": 1, "curiosity": 0, "specificity": 0, "visual": 0}, ...]}`;

  try {
    const raw = await callLocalAI(prompt, 500, 150000); // JSON scoring can be slow
    const data = extractJSON(raw);
    const byIndex = new Map((data.scores || []).map(s => [Number(s.index), s]));
    const scored = topics.map((topic, i) => {
      const s = byIndex.get(i + 1) || {};
      const total = (Number(s.curiosity) || 0) + (Number(s.specificity) || 0) +
                    (Number(s.visual) || 0);
      return { topic, score: total, parts: [s.curiosity, s.specificity, s.visual] };
    }).sort((a, b) => b.score - a.score);
    console.log('[topics] curiosity ranking:', scored.map(s => `${s.score} "${s.topic.slice(0, 40)}"`).join(' | '));
    return scored.map(s => s.topic);
  } catch (err) {
    console.warn('[topics] curiosity scoring unavailable, keeping order:', err.message);
    return topics;
  }
}

/** Run an operator cycle FOR ONE CHANNEL: research → score by curiosity →
 *  enqueue N jobs tagged with that channel (its own niche, voice, pipeline).
 *  hookVariants > 1 switches to A/B mode: ONE topic, N jobs with different
 *  hook angles — the feed votes, the winning angle becomes the channel's
 *  new default (retention loop closes via winningHooks). */
async function runOperatorCycle(db, { count = null, hints = '', channelId = null, hookVariants = 1 } = {}) {
  const channel = channelId ? db.getChannel(channelId) : null;
  const settings = db.getSettings();
  const cid = channel ? channel.id : 'cosmic-archive';
  const n = Math.max(1, Math.min(5, count || (channel && channel.videos_per_run) || settings.videos_per_run || 1));
  const niche = (channel && channel.niche) || settings.niche || 'space and science mysteries';

  const jobs = [];
  const planned = [];

  if (hookVariants > 1) {
    // A/B mode: one validated topic, N hook angles racing each other
    const topics = await researchTopics(db, 3, hints, cid);
    if (!topics.length) throw new Error('topic research returned nothing');
    const topic = topics[0];
    const angles = HOOK_VARIANTS[channel && channel.pipeline] || HOOK_VARIANTS.space;
    const useAngles = angles.slice(0, Math.min(hookVariants, angles.length));
    const run = db.createOperatorRun(useAngles.length, cid);
    const group = `var_${Date.now().toString(36)}`;
    for (const angle of useAngles) {
      db.addTopic(`${topic} [${group}]`, 'operator', cid);
      jobs.push(db.createJob({
        topic,
        style: (channel && channel.style) || settings.default_style,
        voice: (channel && channel.voice) || settings.default_voice || 'dynamic',
        source: 'operator-variants',
        operatorRunId: run.id,
        channelId: cid,
        variantGroup: group,
        variantHint: angle,
      }));
      planned.push(`${group}: ${angle.slice(0, 48)}…`);
    }
    db.updateOperatorRun(run.id, {
      status: 'completed',
      summary_json: JSON.stringify({ planned: useAngles, jobs: jobs.map(j => j.id), channel: cid, variantGroup: group, topic }),
    });
    db.notify('info', `A/B hook race [${channel ? channel.name : cid}]: ${useAngles.length} variants of "${topic.slice(0, 48)}…" (group ${group})`);
    return { run, topics: [topic], jobs };
  }

  const topics = await researchTopics(db, n + 2, hints, cid);
  const ranked = await scoreCuriosity(topics, niche);
  const chosen = ranked.slice(0, n);

  // the mined questions influenced this research call — mark them consumed
  if (cid) db.markMinedQuestionsUsed(cid);

  const run = db.createOperatorRun(chosen.length, cid);
  for (const topic of chosen) {
    db.addTopic(topic, 'operator', cid);
    jobs.push(db.createJob({
      topic,
      style: (channel && channel.style) || settings.default_style,
      voice: (channel && channel.voice) || settings.default_voice || 'dynamic',
      source: 'operator',
      operatorRunId: run.id,
      channelId: cid,
    }));
    planned.push(topic);
  }
  db.updateOperatorRun(run.id, {
    status: 'completed',
    summary_json: JSON.stringify({ planned, jobs: jobs.map(j => j.id), channel: cid }),
  });
  const chanLabel = channel ? ` [${channel.name}]` : '';
  db.notify('info', `Operator planned ${chosen.length} short(s)${chanLabel}: ${chosen.map(t => `"${t.slice(0, 40)}…"`).join(', ')}`);
  return { run, topics: chosen, jobs };
}

module.exports = { researchTopics, scoreCuriosity, runOperatorCycle };
