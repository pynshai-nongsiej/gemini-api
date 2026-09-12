/**
 * SEO metadata via the LOCAL AI (web2api proxy) — the previous agent's
 * seo-optimizer-agent, local edition. Returns {title, description, tags,
 * hashtags} with a template fallback when the AI is down.
 */
const { config } = require('./config');

async function callLocalAI(prompt, maxTokens = 700, timeoutMs = 60000) {
  const body = {
    model: config.LOCAL_AI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.7,
  };
  const res = await fetch(`${config.LOCAL_AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`local AI HTTP ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (!content.trim()) throw new Error('empty local AI response');
  return content;
}

function extractJSON(text) {
  text = text.replace(/^```(?:json)?|```$/gm, '').trim();
  try { return JSON.parse(text); } catch {}
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) return JSON.parse(text.slice(first, last + 1));
  throw new Error('no JSON in response');
}

async function suggestSEO(title, scriptText, settings) {
  const niche = settings?.niche || 'general';
  const usa = (settings?.audience_country || 'usa') === 'usa';
  const locale = usa ? `
USA-ONLY AUDIENCE TARGETING (critical):
- "title" and "description" in US English spelling, US idioms
- money topics use DOLLARS and US institutions ($, 401k, Roth IRA, US banks, credit score)
- include 2-4 USA-targeting tags from: "usa", "united states", "american", "us news", "america today"
- phrases that resonate with American viewers ("here in the US", "most Americans")` : '';
  const prompt = `You are a YouTube Shorts SEO specialist for a ${niche} channel.
Given this short's working title and script, return JSON with:
- "title": an improved, curiosity-driven title under 70 chars (no clickbait lies, no ALL CAPS)
- "description": 1-2 sentence description with 3 relevant hashtags
- "tags": 8-12 lowercase tags, no # symbols
- "hashtags": 3 hashtags with # symbol
${locale}
TITLE: ${title}
SCRIPT: ${scriptText.slice(0, 900)}
Return ONLY valid JSON.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callLocalAI(prompt);
      const seo = extractJSON(raw);
      if (seo.title && seo.description && Array.isArray(seo.tags)) {
        const tags = seo.tags.slice(0, 15).map(t => String(t).toLowerCase().replace(/^#/, ''));
        return {
          title: String(seo.title).slice(0, 100),
          description: String(seo.description).slice(0, 4000),
          tags: usa ? ensureUSATags(tags) : tags,
          hashtags: (seo.hashtags || []).slice(0, 5).map(h => String(h).startsWith('#') ? h : `#${h}`),
          generated_by: 'local-ai',
        };
      }
    } catch (err) {
      if (attempt === 1) console.warn('[seo] local AI unavailable, using template:', err.message);
    }
  }
  // template fallback (previous agent's pattern)
  const words = title.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 3);
  const tags = [...new Set([...words, 'shorts', 'facts', niche.split(' ')[0]])].slice(0, 12);
  return {
    title: title.slice(0, 100),
    description: `${title}. ${settings?.channel_name || 'Our channel'} — new shorts weekly. ${usa ? ['#shorts', '#usa', '#america'].join(' ') : ['#shorts', `#${(niche.split(' ')[0] || 'facts')}`, '#science'].join(' ')}`,
    tags: usa ? ensureUSATags(tags) : tags,
    hashtags: usa ? ['#shorts', '#usa', '#america'] : ['#shorts', `#${(niche.split(' ')[0] || 'facts')}`, '#science'],
    generated_by: 'template',
  };
}

/** USA targeting: make sure the US signal tags are present (2-4 of them) */
function ensureUSATags(tags) {
  const usTags = ['usa', 'united states', 'american'];
  const out = [...tags];
  for (const t of usTags) {
    if (out.length >= 13) break;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

module.exports = { suggestSEO, callLocalAI, extractJSON };
