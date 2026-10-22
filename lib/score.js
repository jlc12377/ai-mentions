'use strict';

// Visibility score, formula version 2.
//
// A recommendation answer is still scored 0–100:
//   70% mention points + 30% citation points.
//
// Mention points:
//   0   if the business name and domain are absent
//   50  if the business is named but not inside a list
//   max(20, 100 - (position - 1) * 12) if it appears in a list
//       position 1 = 100, 2 = 88, 3 = 76, … floor 20
//
// Citation points:
//   100 if the domain is cited as a source, otherwise 0
//
// R is the rounded average of every successful recommendation answer.
// Each of those answers counts equally. The awareness question is not
// one of them. Unconfigured providers and failed calls are left out of R.
//
// Separately, each provider is asked what it knows about the business.
// An awareness answer counts as known only when it is not the sentinel
// UNKNOWN and it plausibly refers to this business (name or domain match),
// rather than a generic disclaimer that merely echoes the question.
// A is 100 × (known answers / awareness answers that came back).
// A timed-out or failed awareness call is left out of A, not scored as
// "never heard of you". If no awareness answer came back, the visibility
// score is R.
//
// Otherwise the visibility score is
//   round(0.75 × R + 0.25 × A)
// Recommendation mentions stay the dominant weight. Awareness is partial
// credit on top of that weight:
//   known by all that answered, recommended by none (R = 0, A = 100) → 25
//     which sits in the 20–30 band
//   known by 2 of 3 (A = 66.6…) → round(16.66…) = 17
//   known by 1 of 3 (A = 33.3…) → round(8.33…) = 8
//   unknown everywhere (R = 0, A = 0) → 0, in the 0–5 band
//   recommended and known (R = 100, A = 100) → 100
// If no recommendation answer succeeded, the score is null — never a
// placeholder — even when an awareness answer came back.

const FORMULA_VERSION = 2;
const MENTION_WEIGHT = 0.7;
const CITATION_WEIGHT = 0.3;
const RECOMMENDATION_WEIGHT = 0.75;
const AWARENESS_WEIGHT = 0.25;

const METHODOLOGY =
  'Each recommendation answer scores 0–100: 70% mention and 30% citation. ' +
  'Mention points are 100 for list position 1, minus 12 points per rank lower (floor 20), ' +
  '50 if the business is named but not in a list, and 0 if it is not named. ' +
  'Names are matched case-insensitively with suffixes such as Inc, LLC, and Ltd removed. ' +
  'The domain counts as a mention when it appears in the answer, and as a citation when a source URL uses that domain. ' +
  'The recommendation score is the rounded average of those answers. Each recommendation answer counts equally. ' +
  'A separate question asks what the assistant knows about the business. ' +
  'Known means the reply is not UNKNOWN and it plausibly refers to the business, not a generic disclaimer. ' +
  'The visibility score is round(0.75 × recommendation score + 0.25 × awareness rate). ' +
  'The awareness rate is 100 times the share of assistants whose awareness answer came back and knows the business. ' +
  'Failed awareness calls are left out of that share. If no awareness answer came back, the visibility score is the recommendation score. ' +
  'Known by every assistant that answered, and recommended by none, is 25. ' +
  'Known by 2 of 3 is 17, and known by 1 of 3 is 8. Unknown everywhere, with no recommendation, is 0. ' +
  'Assistants that are not configured, time out, or return an error are excluded. ' +
  'A failed recommendation question is shown with its error and left out of the average. ' +
  'If web search returns no answer, Claude is asked again without search and that answer is labeled. ' +
  'If every assistant fails, the score is unavailable rather than guessed. ' +
  'The buyer questions do not include the business name. The awareness question does.';

const SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'plc', 'gmbh', 'lp', 'llp',
]);

// Trailing words that mark a product line, not a different company.
const PRODUCT_WORDS = new Set([
  'crm', 'erp', 'hcm', 'hris', 'ats', 'pos', 'cms', 'emr', 'ehr', 'rcm',
  'cloud', 'platform', 'software', 'suite', 'plus', 'pro', 'enterprise',
  'online', 'app', 'apps', 'sales', 'marketing', 'service', 'commerce',
  'support', 'analytics', 'billing', 'payroll', 'recruiting',
]);

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
    this.status = 400;
    this.reason = 'validation';
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collapse(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  let text = String(value == null ? '' : value).toLowerCase();
  text = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  text = text.replace(/&/g, ' and ');
  text = text.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!text) return '';
  const parts = text.split(' ');
  while (parts.length > 1 && SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts.join(' ');
}

function normalizeDomain(value) {
  const raw = collapse(value);
  if (!raw) return '';
  if (raw.length > 200) {
    throw new InputError('Website must be 200 characters or fewer');
  }
  let host = raw.toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.replace(/^www\./, '');
  host = host.split(/[/?#]/)[0].replace(/\.$/, '');
  if (!host) return '';
  if (host.length > 253 || host.includes('..') || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
    throw new InputError('Enter a website like example.com');
  }
  return host;
}

function validateInput(body) {
  const source = body && typeof body === 'object' ? body : {};
  const businessName = collapse(source.businessName || source.company || source.name);
  const category = collapse(source.category || source.industry);
  const city = collapse(source.city);
  if (businessName.length < 2) throw new InputError('Enter a company name');
  if (businessName.length > 80) throw new InputError('Company name must be 80 characters or fewer');
  if (!normalizeName(businessName)) throw new InputError('Enter a company name');
  if (category.length < 2) throw new InputError('Enter a category');
  if (category.length > 80) throw new InputError('Category must be 80 characters or fewer');
  if (city && city.length < 2) throw new InputError('City must be at least 2 characters, or left blank');
  if (city.length > 80) throw new InputError('City must be 80 characters or fewer');
  const domain = normalizeDomain(source.domain || source.website || source.url || '');
  return { businessName, category, city, domain };
}

function mentionsBrand(text, businessName) {
  const name = normalizeName(businessName);
  if (!name) return false;
  const haystack = ` ${normalizeName(text)} `;
  return haystack.includes(` ${name} `);
}

function textHasDomain(text, domain) {
  if (!domain) return false;
  const pattern = new RegExp(`(^|[^a-z0-9-])${escapeRegExp(domain)}([^a-z0-9-]|$)`, 'i');
  return pattern.test(String(text || ''));
}

function isMentioned(text, businessName, domain) {
  return mentionsBrand(text, businessName) || textHasDomain(text, domain);
}

function hostOf(url) {
  try {
    const raw = String(url || '').trim();
    if (!raw) return '';
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withProtocol).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function hostMatches(url, domain) {
  const host = hostOf(url);
  if (!host || !domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

function extractUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return matches.map((url) => url.replace(/[.,;]+$/, ''));
}

function isCited(citations, text, domain) {
  if (!domain) return false;
  const urls = [...(citations || []), ...extractUrls(text)];
  return urls.some((url) => hostMatches(url, domain));
}

function findPosition(text, businessName, domain) {
  const lines = String(text || '').split(/\n/);
  let position = null;
  let bulletIndex = 0;
  let inBullets = false;
  for (const line of lines) {
    const match = line.match(/^\s*(?:([-*•])|(\d{1,2})[.)])\s+(.+)$/);
    if (!match) {
      if (!line.trim()) inBullets = false;
      continue;
    }
    let index;
    if (match[2]) {
      index = Number(match[2]);
      inBullets = false;
    } else {
      bulletIndex = inBullets ? bulletIndex + 1 : 1;
      inBullets = true;
      index = bulletIndex;
    }
    if (index < 1) continue;
    if (isMentioned(match[3], businessName, domain) && (position == null || index < position)) {
      position = index;
    }
  }
  return position;
}

function mentionPoints({ mentioned, position }) {
  if (!mentioned) return 0;
  if (Number.isInteger(position) && position > 0) {
    return Math.max(20, 100 - (position - 1) * 12);
  }
  return 50;
}

function scoreCheck(check) {
  const mentioned = Boolean(check.mentioned) || (Number.isInteger(check.position) && check.position > 0);
  const mention = mentionPoints({ mentioned, position: check.position });
  const citation = check.cited ? 100 : 0;
  return Math.round(MENTION_WEIGHT * mention + CITATION_WEIGHT * citation);
}

function averageScores(values) {
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round(total / values.length);
}

function cleanListName(item) {
  let text = String(item || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/\*\*/g, '').replace(/^["']+|["']+$/g, '').trim();
  text = text.split(/\s+[—–]\s+|\s+-\s+|:\s+|\s+\(/)[0].trim();
  text = text.replace(/[.,;:!?]+$/g, '').trim();
  if (text.length < 2 || text.length > 60) return null;
  const words = text.split(/\s+/);
  if (words.length > 6) return null;
  if (!/[a-z]/i.test(text)) return null;
  return text;
}

function extractNames(text) {
  const names = [];
  for (const line of String(text || '').split(/\n/)) {
    const match = line.match(/^\s*(?:[-*•]|\d{1,2}[.)])\s+(.+)$/);
    if (!match) continue;
    const name = cleanListName(match[1]);
    if (name) names.push(name);
  }
  return names;
}

function isSameBrand(candidate, businessName, domain) {
  const left = normalizeName(candidate);
  const right = normalizeName(businessName);
  if (!left || !right) return false;
  if (left === right || left.startsWith(`${right} `)) return true;
  if (right.startsWith(`${left} `) && left.length >= 4) return true;
  if (domain) {
    const stem = domain.split('.')[0];
    if (stem && stem.length >= 3 && (left === stem || left.startsWith(`${stem} `))) return true;
  }
  return false;
}

function competitorStem(name) {
  const key = normalizeName(name);
  if (!key) return '';
  const words = key.split(' ');
  while (words.length > 1 && PRODUCT_WORDS.has(words[words.length - 1])) {
    const next = words.slice(0, -1);
    if (next.length === 1 && PRODUCT_WORDS.has(next[0])) break;
    words.pop();
  }
  return words.join(' ');
}

function competitorLabel(name, stem) {
  const cleaned = String(name || '').replace(/[.,;:!?]+$/g, '').trim();
  if (normalizeName(cleaned) === stem) return cleaned;
  const words = cleaned.split(/\s+/).filter(Boolean);
  const stemCount = stem.split(' ').length;
  if (words.length >= stemCount) {
    const head = words.slice(0, stemCount).join(' ');
    if (normalizeName(head) === stem) return head;
  }
  return cleaned;
}

function collectCompetitors(checks, businessName, domain) {
  const counts = new Map();
  for (const check of checks) {
    const seen = new Set();
    for (const name of check.names || []) {
      if (isSameBrand(name, businessName, domain)) continue;
      const stem = competitorStem(name);
      if (!stem || stem.length < 2 || seen.has(stem)) continue;
      if (isSameBrand(stem, businessName, domain)) continue;
      seen.add(stem);
      const label = competitorLabel(name, stem);
      const row = counts.get(stem) || { name: label, mentions: 0 };
      row.mentions += 1;
      if (normalizeName(label) === stem && (normalizeName(row.name) !== stem || label.length < row.name.length)) {
        row.name = label;
      }
      counts.set(stem, row);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name))
    .slice(0, 8);
}

function excerptOf(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= 400) return flat;
  return `${flat.slice(0, 397)}...`;
}

function cleanCitations(urls) {
  const out = [];
  const seen = new Set();
  for (const raw of urls || []) {
    const url = String(raw || '').trim().replace(/[.,;]+$/, '');
    if (!/^https?:\/\//i.test(url)) continue;
    const key = url.replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= 8) break;
  }
  return out;
}

function judgeAnswer(answer, input) {
  const text = String(answer?.text || '');
  const citations = Array.isArray(answer?.citations) ? answer.citations : [];
  const position = findPosition(text, input.businessName, input.domain);
  const mentioned = isMentioned(text, input.businessName, input.domain) || position != null;
  const cited = isCited(citations, text, input.domain);
  return {
    mentioned,
    position,
    cited,
    score: scoreCheck({ mentioned, position, cited }),
    excerpt: excerptOf(text),
    citations: cleanCitations(citations),
    names: extractNames(text),
  };
}

function buildPrompts(category, city, count) {
  const where = city ? ` in ${city}` : '';
  const prompts = [
    `What are the best ${category}${where}?`,
    city
      ? `Which ${category} companies would you recommend in ${city}?`
      : 'Which ' + category + ' companies would you recommend?',
    `Who are the leading ${category} providers${where}?`,
    `What ${category} companies are buyers choosing${where}?`,
    `Compare popular ${category} options${where} and list the ones worth considering.`,
  ];
  const n = Math.min(5, Math.max(3, Number(count) || 4));
  return prompts.slice(0, n);
}

function summarize(checks) {
  const good = checks.filter((check) => check.ok);
  const mentions = good.filter((check) => check.mentioned).length;
  const citations = good.filter((check) => check.cited).length;
  return {
    checks: good.length,
    mentions,
    citations,
    mentionRate: good.length ? Math.round((mentions / good.length) * 1000) / 1000 : null,
  };
}

function awarenessPrompt(input) {
  const businessName = input && input.businessName ? input.businessName : '';
  const domain = input && input.domain ? input.domain : '';
  const who = domain ? `${businessName} (${domain})` : businessName;
  return `What do you know about ${who}? Answer in 2-3 sentences. If you don't know this business, reply exactly: UNKNOWN.`;
}

const DISCLAIMER = new RegExp([
  "i (?:do not|don't|dont) know",
  "i(?:'m| am) not (?:familiar|aware)",
  'not familiar with',
  'not aware of',
  'no information',
  "do not have (?:any |enough |specific )?(?:information|knowledge|data|details)",
  "don't have (?:any |enough |specific )?(?:information|knowledge|data|details)",
  'dont have (?:any |enough )?(?:information|knowledge|data)',
  'unable to (?:find|locate|verify|provide|confirm)',
  "cannot (?:find|verify|confirm|provide)",
  "can't (?:find|verify|confirm)",
  'could not find',
  "couldn't find",
  'never heard',
  "do not recognize",
  "don't recognize",
  'does not appear to',
  "doesn't appear to",
  'as an ai',
  'language model',
  'i have no (?:information|knowledge|data|record)',
  'beyond my knowledge',
].join('|'), 'i');

const AWARENESS_FILLER = new Set([
  'i', 'me', 'my', 'you', 'your', 'we', 'our', 'they', 'them', 'their', 'it', 'its',
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'and', 'or', 'but', 'if', 'of',
  'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'as', 'is', 'am', 'are', 'was',
  'were', 'be', 'been', 'being', 'do', 'does', 'did', 'not', 'no', 'nor', 'so', 'than',
  'too', 'very', 'just', 'about', 'into', 'over', 'after', 'before', 'out', 'up',
  'then', 'also', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must',
  'have', 'has', 'had', 'what', 'which', 'who', 'how', 'when', 'where', 'why',
  'there', 'here', 'any', 'some', 'such', 'only', 'much', 'know', 'known', 'knows',
  'information', 'info', 'knowledge', 'familiar', 'aware', 'unknown', 'business',
  'company', 'details', 'data', 'specific', 'sorry', 'unfortunately', 'unable',
  'please', 'note', 'however', 'beyond', 'name', 'exactly', 'reply',
  'language', 'model', 'assistant', 'cannot', 'cant', 'find', 'provide', 'confirm',
  'verify', 'locate', 'recognize', 'record', 'records', 'heard', 'never', 'appear',
  'appears', 'seem', 'seems', 'exist', 'exists', 'browsing', 'browse', 'training',
]);

function isUnknownSentinel(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^["'`“”]+|["'`“”]+$/g, '')
    .trim()
    .replace(/[.!]+$/g, '')
    .trim();
  return /^unknown$/i.test(cleaned);
}

function splitSentences(text) {
  return String(text || '')
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripAwarenessEcho(text, input) {
  let raw = String(text || '').trim();
  const prompt = awarenessPrompt(input);
  if (raw.toLowerCase().startsWith(prompt.toLowerCase())) {
    raw = raw.slice(prompt.length).trim();
  }
  const who = input.domain ? `${input.businessName} (${input.domain})` : input.businessName;
  const echo = new RegExp(`^what do you know about\\s+${escapeRegExp(who)}\\??\\s*`, 'i');
  return raw.replace(echo, '').trim();
}

function awarenessContentWords(sentence, input) {
  let text = String(sentence || '');
  const name = normalizeName(input.businessName);
  if (name) text = text.replace(new RegExp(escapeRegExp(name).replace(/ /g, '\\s+'), 'ig'), ' ');
  if (input.domain) {
    text = text.replace(new RegExp(escapeRegExp(input.domain), 'ig'), ' ');
  }
  return normalizeName(text)
    .split(' ')
    .filter((word) => word && word.length > 2 && !AWARENESS_FILLER.has(word));
}

function isQuestionEcho(sentence, input) {
  if (!/^\s*(what|who|how|why|when|where|do you|can you|tell me)\b/i.test(sentence)) return false;
  return awarenessContentWords(sentence, input).length < 2;
}

function isGenericDisclaimer(sentence, input) {
  if (isUnknownSentinel(sentence)) return true;
  if (!DISCLAIMER.test(sentence)) return false;
  return awarenessContentWords(sentence, input).length < 2;
}

// Known when the reply is not the UNKNOWN sentinel and some remaining
// sentence plausibly refers to this business. A generic disclaimer that
// only repeats the name or domain does not count, and neither does an
// echo of the question.
function classifyKnown(text, input) {
  const source = input || {};
  const raw = stripAwarenessEcho(text, source);
  if (!raw || isUnknownSentinel(raw)) return false;
  const kept = splitSentences(raw).filter((sentence) => (
    !isUnknownSentinel(sentence) && !isGenericDisclaimer(sentence, source) && !isQuestionEcho(sentence, source)
  ));
  if (!kept.length) return false;
  return kept.some((sentence) => isMentioned(sentence, source.businessName, source.domain));
}

function awarenessRate(results) {
  const answered = (results || []).filter((row) => row && row.ok);
  if (!answered.length) return null;
  const known = answered.filter((row) => row.known).length;
  return (known / answered.length) * 100;
}

// Blend recommendation and awareness. See the formula comment at the top.
function scoreVisibility(recommendationScores, awarenessResults) {
  const recommendation = averageScores(recommendationScores || []);
  if (recommendation == null) return null;
  const awareness = awarenessRate(awarenessResults);
  if (awareness == null) return recommendation;
  return Math.round(RECOMMENDATION_WEIGHT * recommendation + AWARENESS_WEIGHT * awareness);
}

module.exports = {
  FORMULA_VERSION,
  MENTION_WEIGHT,
  CITATION_WEIGHT,
  RECOMMENDATION_WEIGHT,
  AWARENESS_WEIGHT,
  METHODOLOGY,
  InputError,
  normalizeName,
  normalizeDomain,
  validateInput,
  mentionsBrand,
  textHasDomain,
  isMentioned,
  hostMatches,
  isCited,
  findPosition,
  mentionPoints,
  scoreCheck,
  averageScores,
  extractNames,
  isSameBrand,
  collectCompetitors,
  judgeAnswer,
  buildPrompts,
  summarize,
  excerptOf,
  cleanCitations,
  awarenessPrompt,
  classifyKnown,
  awarenessRate,
  scoreVisibility,
};
