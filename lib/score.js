'use strict';

// Visibility score, formula version 1.
//
// Each successful answer is scored 0–100:
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
// The visibility score is the rounded average of every successful answer.
// Each answer counts equally. Unconfigured providers and failed calls are
// left out. If none succeed, the score is null — never a placeholder.

const FORMULA_VERSION = 1;
const MENTION_WEIGHT = 0.7;
const CITATION_WEIGHT = 0.3;

const METHODOLOGY =
  'Each successful answer scores 0–100: 70% mention and 30% citation. ' +
  'Mention points are 100 for list position 1, minus 12 points per rank lower (floor 20), ' +
  '50 if the business is named but not in a list, and 0 if it is not named. ' +
  'Names are matched case-insensitively with suffixes such as Inc, LLC, and Ltd removed. ' +
  'The domain counts as a mention when it appears in the answer, and as a citation when a source URL uses that domain. ' +
  'The visibility score is the rounded average of those answers. Each answer counts equally. ' +
  'Assistants that are not configured, time out, or return an error are excluded. ' +
  'A failed question is shown with its error and left out of the average. ' +
  'If web search returns no answer, Claude is asked again without search and that answer is labeled. ' +
  'If every assistant fails, the score is unavailable rather than guessed. ' +
  'The buyer questions do not include the business name.';

const SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'plc', 'gmbh', 'lp', 'llp',
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
  text = text.replace(/[.,;]+$/g, '').trim();
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

function collectCompetitors(checks, businessName, domain) {
  const counts = new Map();
  for (const check of checks) {
    const seen = new Set();
    for (const name of check.names || []) {
      if (isSameBrand(name, businessName, domain)) continue;
      const key = normalizeName(name);
      if (!key || key.length < 2 || seen.has(key)) continue;
      seen.add(key);
      const row = counts.get(key) || { name, mentions: 0 };
      row.mentions += 1;
      if (name.length > row.name.length && name.length <= 60) row.name = name;
      counts.set(key, row);
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

module.exports = {
  FORMULA_VERSION,
  MENTION_WEIGHT,
  CITATION_WEIGHT,
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
};
