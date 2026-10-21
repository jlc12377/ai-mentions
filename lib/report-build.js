'use strict';

const { normalizeName } = require('./score');

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function businessFingerprint(input) {
  return [
    normalizeName(input.businessName),
    input.domain || '',
    String(input.category || '').toLowerCase(),
    String(input.city || '').toLowerCase(),
  ].join('\n');
}

function collectSources(providers, domain) {
  const seen = new Set();
  const sources = [];
  const own = String(domain || '').toLowerCase();
  for (const provider of providers || []) {
    for (const check of provider.checks || []) {
      for (const raw of check.citations || []) {
        const url = safeHttpUrl(raw);
        if (!url) continue;
        const key = url.replace(/\/$/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        const host = hostOf(url);
        sources.push({
          url,
          host,
          own: Boolean(own && (host === own || host.endsWith(`.${own}`))),
          engine: provider.label,
        });
        if (sources.length >= 12) return sources;
      }
    }
  }
  return sources;
}

function engineSnapshot(provider) {
  const checks = provider.checks || [];
  const good = checks.filter((check) => check.ok);
  const mentioned = good.filter((check) => check.mentioned);
  const positions = mentioned.map((check) => check.position).filter((position) => Number.isInteger(position) && position > 0);
  return {
    id: provider.id,
    label: provider.label,
    ok: provider.ok,
    score: provider.score,
    answers: good.length,
    mentions: mentioned.length,
    citations: good.filter((check) => check.cited).length,
    bestPosition: positions.length ? Math.min(...positions) : null,
    failed: checks.filter((check) => !check.ok).length,
  };
}

function buildRecommendations(view) {
  const items = [];
  const business = view.businessName;
  const engines = (view.providers || []).map(engineSnapshot);
  const answered = engines.filter((engine) => engine.ok);
  const missed = answered.filter((engine) => engine.mentions === 0);
  const uncited = answered.filter((engine) => engine.mentions > 0 && engine.citations === 0 && view.domain);
  const buried = answered.filter((engine) => engine.bestPosition != null && engine.bestPosition > 1);
  if (missed.length) {
    items.push({
      title: `Get named by ${missed.map((engine) => engine.label).join(', ')}`,
      detail: `${missed.map((engine) => engine.label).join(', ')} answered without naming ${business}. Publish a page on your domain that answers the buyer questions in this report, and earn a mention on a site those answers already cited for someone else.`,
    });
  }
  if (uncited.length) {
    items.push({
      title: `Get ${view.domain} cited where you were only named`,
      detail: `${uncited.map((engine) => engine.label).join(', ')} named ${business} and did not cite ${view.domain}. The citation half of the score stays at zero until a source URL uses that domain. A page on your site that matches the question, linked from a source already in the answer, is the direct fix.`,
    });
  }
  if (buried.length) {
    items.push({
      title: 'Move up where you were listed below first',
      detail: buried.map((engine) => `${engine.label} listed you at #${engine.bestPosition}`).join('. ') + '. First place is 100 mention points; each step down costs 12. The companies above you are in the competitor list — compare the facts those answers used.',
    });
  }
  const competitors = (view.competitors || []).slice(0, 3);
  if (competitors.length) {
    items.push({
      title: 'Study the companies these assistants recommended instead',
      detail: competitors.map((row) => `${row.name} (${row.mentions} ${row.mentions === 1 ? 'answer' : 'answers'})`).join(', ')
        + `. Read the excerpts next to your result and match the specifics a buyer would compare: who you serve, where you operate, and a page on ${view.domain || 'your domain'} that says so.`,
    });
  }
  const external = (view.sources || []).filter((source) => !source.own).slice(0, 4);
  if (external.length) {
    items.push({
      title: 'Use the sources these answers already trusted',
      detail: `Cited pages included ${external.map((source) => source.host).join(', ')}. A mention on one of those pages is more useful than a new page the assistants have not seen.`,
    });
  }
  const failed = engines.filter((engine) => !engine.ok);
  if (failed.length) {
    items.push({
      title: 'Do not read a failed assistant as a miss',
      detail: `${failed.map((engine) => engine.label).join(', ')} did not return a usable answer. Those questions were left out of the score. They are not evidence that ${business} is absent.`,
    });
  }
  if (!items.length) {
    items.push({
      title: 'Keep the pages these assistants already used',
      detail: `${business} was named in the answers that came back${view.domain ? `, and ${view.domain} was cited where the score shows a citation` : ''}. Leave those pages up. Tracking runs the same questions again in 30 days.`,
    });
  }
  return items.slice(0, 6);
}

function monthChange(previous, next) {
  if (!previous || previous.score == null || !next || next.score == null) return null;
  const scoreDelta = next.score - previous.score;
  const previousMentions = previous.summary?.mentions || 0;
  const nextMentions = next.summary?.mentions || 0;
  const previousCitations = previous.summary?.citations || 0;
  const nextCitations = next.summary?.citations || 0;
  const sign = scoreDelta > 0 ? '+' : '';
  return {
    previousScore: previous.score,
    score: next.score,
    scoreDelta,
    mentionDelta: nextMentions - previousMentions,
    citationDelta: nextCitations - previousCitations,
    previousCheckedAt: previous.timestamp || '',
    text: `Score moved from ${previous.score} to ${next.score} (${sign}${scoreDelta}). Mentions went from ${previousMentions} to ${nextMentions}. Citations went from ${previousCitations} to ${nextCitations}.`,
  };
}

function buildView(score, extras) {
  const sources = collectSources(score.providers, score.domain);
  const view = {
    businessName: score.businessName,
    domain: score.domain,
    category: score.category,
    city: score.city,
    prompts: score.prompts,
    score: score.score,
    timestamp: score.timestamp,
    summary: score.summary,
    providers: score.providers,
    competitors: score.competitors,
    formula: score.formula,
    sources,
    change: extras.change || null,
    origin: extras.origin || 'checkout',
  };
  view.recommendations = buildRecommendations(view);
  return view;
}

module.exports = {
  safeHttpUrl,
  businessFingerprint,
  collectSources,
  buildRecommendations,
  monthChange,
  buildView,
  engineSnapshot,
};
