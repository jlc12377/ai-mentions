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
// Separately, each provider is asked what it already knows about this
// business in this category and city. That question does not include the
// website and is not run with web search, so reading the site does not count
// as knowing the business. An awareness answer counts as known when it names
// this business (including a distinctive shorter form such as "Hattie B's"
// for "Hattie B's Hot Chicken"), places it in the category and city, and adds
// a detail beyond those words. UNKNOWN, a disclaimer, a different business
// with the same name, a sentence that only repeats the name, and a reply that
// only restates the website or says it looked the business up do not count.
// A recommendation mention still uses the naming rule, including the domain.
// A is 100 × (known answers / awareness calls that were attempted).
// A timed-out or failed awareness call stays in that denominator as not
// known. Dropping it would turn 2-of-3 into 2-of-2 and raise the score.
// If every awareness call failed, A is 0. If no awareness call was made, the
// visibility score is R.
//
// Otherwise the visibility score is
//   round(0.75 × R + 0.25 × A)
// Recommendation mentions stay the dominant weight. Awareness is partial
// credit on top of that weight:
//   known by all, recommended by none (R = 0, A = 100) → 25
//   known by 2 of 3, including a failed call (A = 66.6…) → round(16.66…) = 17
//   known by 1 of 3 (A = 33.3…) → round(8.33…) = 8
//   unknown everywhere (R = 0, A = 0) → 0
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
  'A separate question asks what the assistant already knows about this business in its category and city. ' +
  'That question does not include the website and does not use web search. ' +
  'Known means the answer names this business, including a distinctive shorter form of the name, places it in the category and city, and adds a detail beyond those words. ' +
  'A different business with the same name does not count. A reply that only repeats the website, or that says it looked the business up, does not count. ' +
  'UNKNOWN, a disclaimer, and a reply that only repeats the name while saying the business was not found do not count. ' +
  'The visibility score is round(0.75 × recommendation score + 0.25 × awareness rate). ' +
  'The awareness rate is 100 times known answers divided by awareness calls, including calls that failed or timed out. ' +
  'A failed awareness call counts as not known, so it cannot raise the score. If every awareness call failed, awareness credit is 0. ' +
  'If no awareness call was made, the visibility score is the recommendation score. ' +
  'Known by every assistant, and recommended by none, is 25. ' +
  'Known by 2 of 3 is 17, and known by 1 of 3 is 8. Unknown everywhere, with no recommendation, is 0. ' +
  'Assistants that are not configured are excluded. ' +
  'A failed recommendation question is shown with its error and left out of the recommendation average. ' +
  'If web search returns no answer on a buyer question, Claude is asked again without search and that answer is labeled. ' +
  'If every assistant fails, the score is unavailable rather than guessed. ' +
  'The buyer questions do not include the business name. The awareness question does, along with the category and city.';

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

// Trailing words that describe the kind of local business, not the brand.
// "Hattie B's Hot Chicken" is still "Hattie B's".
const PLACE_WORDS = new Set([
  'restaurant', 'restaurants', 'cafe', 'cafes', 'coffee', 'grill', 'kitchen',
  'chicken', 'hot', 'pizza', 'pizzeria', 'bar', 'shop', 'shops', 'store',
  'house', 'place', 'diner', 'eatery', 'bbq', 'barbecue', 'bakery', 'boutique',
  'salon', 'spa', 'studio', 'studios', 'clinic', 'services', 'hotel', 'inn',
  'tavern', 'pub', 'joint', 'shack',
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
  text = text.replace(/['’]s\b/g, 's');
  text = text.replace(/['’]/g, '');
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

function brandPhrases(businessName) {
  const full = normalizeName(businessName);
  if (!full) return [];
  const phrases = [full];
  const trimmed = full.split(' ').filter(Boolean);
  while (trimmed.length > 2 && (PLACE_WORDS.has(trimmed[trimmed.length - 1]) || PRODUCT_WORDS.has(trimmed[trimmed.length - 1]))) {
    trimmed.pop();
  }
  const short = trimmed.join(' ');
  if (short !== full && trimmed.length >= 2 && short.replace(/ /g, '').length >= 6) phrases.push(short);
  return phrases;
}

function mentionsBrand(text, businessName) {
  const phrases = brandPhrases(businessName);
  if (!phrases.length) return false;
  const haystack = ` ${normalizeName(text)} `;
  return phrases.some((phrase) => haystack.includes(` ${phrase} `));
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
    if (!lineIdentifies(match[3], businessName, domain)) continue;
    if (position == null || index < position) position = index;
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
  const mentioned = identifiesBusiness(text, input) || position != null;
  // A source URL for the domain still counts. A URL attached to a denial
  // that never identifies the business does not.
  const cited = (mentioned || !answerDenies(text, input))
    && isCited(citations, mentioned ? text : '', input.domain);
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
  const source = input || {};
  const businessName = source.businessName || '';
  const category = collapse(source.category);
  const city = collapse(source.city);
  const place = city ? ` in ${city}` : '';
  const kind = category ? `, a ${category}${place}` : place;
  const specific = category ? ` as a ${category}${place}` : place;
  return `What do you know about ${businessName}${kind}? Answer in 2-3 sentences from what you already know, without looking it up. If you do not already know this specific business${specific}, or you only know a different business with the same name, reply exactly: UNKNOWN.`;
}

const DISCLAIMER = new RegExp([
  "i (?:do not|don't|dont) know",
  "i(?:'m| am) not (?:familiar|aware)",
  'not familiar with',
  'not aware of',
  'no information',
  'no evidence',
  'no results',
  'no record',
  'no listing',
  "do not have[^.]{0,60}(?:information|knowledge|data|details|record|listing)",
  "don't have[^.]{0,60}(?:information|knowledge|data|details|record|listing)",
  'dont have[^.]{0,60}(?:information|knowledge|data|details|record|listing)',
  'unable to (?:find|locate|verify|provide|confirm|identify)',
  'not able to (?:find|locate|verify|provide|confirm|identify)',
  "(?:wasn't|was not|weren't|were not|isn't|is not|aren't|are not) able to",
  "cannot (?:find|locate|verify|confirm|provide|identify)",
  "can't (?:find|locate|verify|confirm|identify)",
  "(?:cannot|can't|could not|couldn't) be found",
  'could not (?:find|locate|verify|confirm|identify)',
  "couldn't (?:find|locate|verify|confirm|identify)",
  'did not (?:find|locate|identify)',
  "didn't (?:find|locate|identify)",
  'didnt (?:find|locate|identify)',
  'never heard',
  "do not recognize",
  "don't recognize",
  'does not (?:appear|exist|show up)',
  "doesn't (?:appear|exist|show up)",
  'not a real',
  'no such (?:business|company|domain|site|website|studio)',
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
  const source = input || {};
  let raw = String(text || '').trim();
  const prompt = awarenessPrompt(source);
  if (raw.toLowerCase().startsWith(prompt.toLowerCase())) {
    raw = raw.slice(prompt.length).trim();
  }
  const echo = new RegExp(`^what do you know about\\s+${escapeRegExp(source.businessName || '')}\\b[^?]*\\?\\s*`, 'i');
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

function splitClauses(sentence) {
  return String(sentence)
    .split(/\s*(?:;|(?:,\s*)?\b(?:but|however|although|though|yet|whereas)\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isDenial(text) {
  return DISCLAIMER.test(String(text || ''));
}

const DESCRIBES = /\b(restaurant|restaurants|chain|company|business|store|shop|cafe|founded|located|operates|serves|sells|offers|known for|location|locations)\b/i;

// Short modifiers that show up in a category label but do not identify the trade.
const CATEGORY_SKIP = new Set([
  'hot', 'best', 'top', 'new', 'big', 'local', 'good', 'pro', 'great', 'online',
]);

const LOOKUP = new RegExp([
  'according to (?:their|the|its) (?:website|site|web ?page)',
  'based on (?:their|the|its) (?:website|site|web ?page)',
  'from (?:their|the|its) (?:website|site|web ?page)',
  '(?:their|the|its) (?:website|site) (?:says|states|lists|shows|describes)',
  'i (?:looked|searched|checked) (?:this |it |them )?(?:up|online)',
  'web search',
  'search results',
  'a (?:quick |web )?search (?:shows|found|reveals)',
].join('|'), 'i');

function categoryWords(category) {
  return normalizeName(category)
    .split(' ')
    .filter((word) => word.length >= 3 && !AWARENESS_FILLER.has(word) && !CATEGORY_SKIP.has(word));
}

function textHasPhrase(text, phrase) {
  const needle = normalizeName(phrase);
  if (!needle) return false;
  return ` ${normalizeName(text)} `.includes(` ${needle} `);
}

function matchesCategory(text, input) {
  const words = categoryWords(input && input.category);
  if (!words.length) return true;
  const haystack = ` ${normalizeName(text)} `;
  return words.some((word) => haystack.includes(` ${word} `));
}

function matchesCity(text, input) {
  const city = normalizeName(input && input.city);
  if (!city) return true;
  if (textHasPhrase(text, city)) return true;
  const tokens = city.split(' ').filter((word) => word.length >= 4);
  if (!tokens.length) return false;
  const haystack = ` ${normalizeName(text)} `;
  return tokens.every((word) => haystack.includes(` ${word} `));
}

function extraKnowledgeWords(text, input) {
  const source = input || {};
  const skip = new Set(categoryWords(source.category));
  for (const word of normalizeName(source.city).split(' ')) {
    if (word.length >= 2) skip.add(word);
  }
  return awarenessContentWords(text, source).filter((word) => !skip.has(word));
}

function isLookup(text) {
  return LOOKUP.test(String(text || ''));
}

function answerClauses(text, input) {
  const raw = stripAwarenessEcho(text, input || {});
  if (!raw || isUnknownSentinel(raw)) return [];
  return splitSentences(raw).flatMap((sentence) => splitClauses(sentence));
}

function clausePieces(clause) {
  return String(clause || '').split(/,/).map((part) => part.trim()).filter(Boolean);
}

// A comma piece or follow-on sentence can describe the business after the
// name showed up, including as "Hattie B's" rather than the full name.
// Awareness (nameOnly) requires the business name. A domain mention is not enough.
function pieceIdentifies(piece, input, priorNamed, nameOnly) {
  if (!piece || isUnknownSentinel(piece) || isDenial(piece) || isQuestionEcho(piece, input)) return false;
  const named = nameOnly
    ? mentionsBrand(piece, input.businessName)
    : isMentioned(piece, input.businessName, input.domain);
  if (named) return true;
  if (!priorNamed) return false;
  if (!/^(which|who|it|they|this|that)\b/i.test(piece)) return false;
  if (awarenessContentWords(piece, input).length < 2) return false;
  return DESCRIBES.test(piece);
}

// A list line counts only when it names the business outside a denial.
function lineIdentifies(line, businessName, domain) {
  if (!isMentioned(line, businessName, domain)) return false;
  if (!isDenial(line)) return true;
  return identifiesBusiness(line, { businessName, domain });
}

// Known or recommended when an affirmative clause names the business, uses a
// shorter form of that name, or clearly describes it. A denial that only
// repeats the name does not count. nameOnly ignores a bare domain mention.
function identifiesBusiness(text, input, nameOnly) {
  const source = input || {};
  let priorNamed = false;
  for (const clause of answerClauses(text, source)) {
    for (const piece of clausePieces(clause)) {
      const named = nameOnly
        ? mentionsBrand(piece, source.businessName)
        : isMentioned(piece, source.businessName, source.domain);
      if (named) priorNamed = true;
      if (pieceIdentifies(piece, source, priorNamed, nameOnly)) return true;
    }
  }
  return false;
}

function answerDenies(text, input) {
  const source = input || {};
  const raw = stripAwarenessEcho(text, source);
  if (!raw || isUnknownSentinel(raw)) return true;
  const clauses = answerClauses(text, source);
  if (!clauses.length) return true;
  return clauses.some((clause) => isUnknownSentinel(clause) || isDenial(clause));
}

function classifyKnown(text, input) {
  const source = input || {};
  // Opening the website, or citing the domain the question used to name,
  // is not prior knowledge of this business.
  if (isLookup(text)) return false;
  if (!identifiesBusiness(text, source, true)) return false;
  if (!matchesCategory(text, source)) return false;
  if (!matchesCity(text, source)) return false;
  return extraKnowledgeWords(text, source).length >= 1;
}

function awarenessRate(results) {
  const attempted = (results || []).filter((row) => row && typeof row === 'object');
  if (!attempted.length) return null;
  const known = attempted.filter((row) => row.ok && row.known).length;
  return (known / attempted.length) * 100;
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
