'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeName,
  normalizeDomain,
  validateInput,
  InputError,
  mentionsBrand,
  isMentioned,
  isCited,
  findPosition,
  mentionPoints,
  scoreCheck,
  averageScores,
  buildPrompts,
  collectCompetitors,
  judgeAnswer,
  METHODOLOGY,
  MENTION_WEIGHT,
  CITATION_WEIGHT,
  RECOMMENDATION_WEIGHT,
  AWARENESS_WEIGHT,
  FORMULA_VERSION,
  awarenessPrompt,
  classifyKnown,
  scoreVisibility,
} = require('../lib/score');

test('name normalization ignores case, punctuation, and company suffixes', () => {
  assert.equal(normalizeName('HubSpot, Inc.'), 'hubspot');
  assert.equal(normalizeName('  Acme LLC '), 'acme');
  assert.equal(normalizeName('Foo & Bar Co.'), 'foo and bar');
  assert.equal(normalizeName('SAP'), 'sap');
});

test('brand mentions use word boundaries', () => {
  assert.equal(mentionsBrand('We recommend HubSpot for inbound.', 'HubSpot, Inc.'), true);
  assert.equal(mentionsBrand('asap delivery and saplings', 'SAP'), false);
  assert.equal(mentionsBrand('SAP S/4HANA is common.', 'SAP'), true);
  assert.equal(mentionsBrand('Xerox is a printer brand', 'Xero'), false);
  assert.equal(mentionsBrand("Hattie B's is a Nashville restaurant.", "Hattie B's Hot Chicken"), true);
  assert.equal(mentionsBrand('Hattie Bs Hot Chicken is in Nashville.', "Hattie B's Hot Chicken"), true);
  assert.equal(mentionsBrand('Hattie went home.', "Hattie B's Hot Chicken"), false);
  assert.equal(mentionsBrand('The best hot chicken in Nashville.', "Hattie B's Hot Chicken"), false);
  assert.equal(isMentioned('See https://www.hubspot.com/crm', 'Example Co', 'hubspot.com'), true);
  assert.equal(isMentioned('nothubspot.com is unrelated', 'Example', 'hubspot.com'), false);
});

test('citations match the domain and its subdomains only', () => {
  assert.equal(isCited(['https://blog.hubspot.com/a'], '', 'hubspot.com'), true);
  assert.equal(isCited(['https://www.hubspot.com/pricing'], '', 'hubspot.com'), true);
  assert.equal(isCited(['https://nothubspot.com/'], '', 'hubspot.com'), false);
  assert.equal(isCited(['https://hubspot.com.evil.com/'], '', 'hubspot.com'), false);
  assert.equal(isCited([], 'Source: https://hubspot.com/blog.', 'hubspot.com'), true);
  assert.equal(isCited(['https://hubspot.com'], 'named only', ''), false);
});

test('list position is the earliest matching item', () => {
  const numbered = [
    'A few options:',
    '1. Salesforce',
    '2. HubSpot — inbound CRM',
    '3. Zoho CRM',
  ].join('\n');
  assert.equal(findPosition(numbered, 'HubSpot', 'hubspot.com'), 2);

  const bullets = ['- Salesforce', '- HubSpot', '- Zoho'].join('\n');
  assert.equal(findPosition(bullets, 'HubSpot', ''), 2);

  const paren = '1) Salesforce\n2) HubSpot\n';
  assert.equal(findPosition(paren, 'HubSpot', ''), 2);

  assert.equal(findPosition('I recommend HubSpot for small teams.', 'HubSpot', ''), null);
  assert.equal(findPosition('1. Salesforce\n2. Zoho', 'HubSpot', 'hubspot.com'), null);
});

test('score formula weights mention position and citations', () => {
  assert.equal(FORMULA_VERSION, 2);
  assert.equal(MENTION_WEIGHT, 0.7);
  assert.equal(CITATION_WEIGHT, 0.3);
  assert.equal(RECOMMENDATION_WEIGHT, 0.75);
  assert.equal(AWARENESS_WEIGHT, 0.25);
  assert.match(METHODOLOGY, /70%/);
  assert.match(METHODOLOGY, /0\.75/);
  assert.match(METHODOLOGY, /unavailable/);

  assert.equal(mentionPoints({ mentioned: false, position: null }), 0);
  assert.equal(mentionPoints({ mentioned: true, position: null }), 50);
  assert.equal(mentionPoints({ mentioned: true, position: 1 }), 100);
  assert.equal(mentionPoints({ mentioned: true, position: 2 }), 88);
  assert.equal(mentionPoints({ mentioned: true, position: 3 }), 76);
  assert.equal(mentionPoints({ mentioned: true, position: 8 }), 20);

  assert.equal(scoreCheck({ mentioned: true, position: 1, cited: true }), 100);
  assert.equal(scoreCheck({ mentioned: true, position: 1, cited: false }), 70);
  assert.equal(scoreCheck({ mentioned: true, position: 2, cited: true }), 92);
  assert.equal(scoreCheck({ mentioned: true, position: null, cited: false }), 35);
  assert.equal(scoreCheck({ mentioned: false, position: null, cited: true }), 30);
  assert.equal(scoreCheck({ mentioned: false, position: null, cited: false }), 0);
  assert.equal(averageScores([92, 92, 0]), 61);
  assert.equal(averageScores([]), null);
});

test('judgeAnswer scores a real answer and does not invent a mention', () => {
  const hit = judgeAnswer({
    text: '1. Salesforce\n2. HubSpot\n3. Zoho CRM',
    citations: ['https://www.hubspot.com/crm'],
  }, { businessName: 'HubSpot', domain: 'hubspot.com' });
  assert.equal(hit.mentioned, true);
  assert.equal(hit.position, 2);
  assert.equal(hit.cited, true);
  assert.equal(hit.score, 92);

  const miss = judgeAnswer({
    text: '1. Salesforce\n2. Zoho CRM',
    citations: ['https://www.salesforce.com'],
  }, { businessName: 'HubSpot', domain: 'hubspot.com' });
  assert.equal(miss.mentioned, false);
  assert.equal(miss.position, null);
  assert.equal(miss.cited, false);
  assert.equal(miss.score, 0);
});

test('competitors are the other names that show up most often', () => {
  const checks = [1, 2, 3, 4].map(() => judgeAnswer({
    text: '1. Salesforce:\n2. HubSpot:\n3. Zoho CRM\n4. Salesforce Sales Cloud\n5. HubSpot CRM\n6. Zoho',
    citations: [],
  }, { businessName: 'HubSpot', domain: 'hubspot.com' }));
  const competitors = collectCompetitors(checks, 'HubSpot', 'hubspot.com');
  assert.deepEqual(competitors.map((row) => row.name), ['Salesforce', 'Zoho']);
  assert.equal(competitors[0].mentions, 4);
  assert.equal(competitors[1].mentions, 4);
  assert.equal(competitors.some((row) => /hubspot/i.test(row.name)), false);
  assert.equal(competitors.some((row) => /[:]$/.test(row.name)), false);
});

test('buyer prompts do not contain the business name', () => {
  const prompts = buildPrompts('CRM Software', 'Austin', 4);
  assert.equal(prompts.length, 4);
  assert.equal(prompts[0], 'What are the best CRM Software in Austin?');
  assert.equal(prompts[1], 'Which CRM Software companies would you recommend in Austin?');
  assert.equal(buildPrompts('CRM Software', '', 4)[1], 'Which CRM Software companies would you recommend?');
  assert.equal(buildPrompts('CRM Software', '', 5).length, 5);
  assert.equal(buildPrompts('CRM Software', '', 3).length, 3);
  for (const prompt of prompts) assert.equal(prompt.toLowerCase().includes('hubspot'), false);
});

test('input limits reject oversized or empty fields and normalize the domain', () => {
  assert.deepEqual(validateInput({
    businessName: ' HubSpot ',
    website: 'https://www.HubSpot.com/products',
    category: 'CRM Software',
    city: 'Austin',
  }), {
    businessName: 'HubSpot',
    domain: 'hubspot.com',
    category: 'CRM Software',
    city: 'Austin',
  });
  assert.equal(validateInput({ businessName: 'Acme', category: 'Widgets' }).domain, '');
  assert.throws(() => validateInput({ businessName: 'A', category: 'CRM' }), InputError);
  assert.throws(() => validateInput({ businessName: 'Acme', category: '' }), InputError);
  assert.throws(() => validateInput({ businessName: 'A'.repeat(81), category: 'CRM' }), InputError);
  assert.throws(() => validateInput({ businessName: 'Acme', category: 'CRM', domain: 'not a domain' }), InputError);
  assert.throws(() => normalizeDomain('https://nothubspot'), InputError);
});

test('awareness is partial credit and a disclaimer is not knowledge', () => {
  const input = { businessName: 'ACCESS Newswire', domain: 'accessnewswire.com' };
  assert.equal(
    awarenessPrompt(input),
    "What do you know about ACCESS Newswire (accessnewswire.com)? Answer in 2-3 sentences. If you don't know this business, reply exactly: UNKNOWN.",
  );
  assert.equal(awarenessPrompt({ businessName: 'ACCESS Newswire', domain: '' }).includes('()'), false);

  assert.equal(classifyKnown('UNKNOWN', input), false);
  assert.equal(classifyKnown('unknown.', input), false);
  assert.equal(classifyKnown('UNKNOWN!', input), false);
  assert.equal(classifyKnown("I don't know this business.", input), false);
  assert.equal(classifyKnown("I don't have information about ACCESS Newswire (accessnewswire.com).", input), false);
  assert.equal(classifyKnown("I'm not familiar with ACCESS Newswire.", input), false);
  assert.equal(classifyKnown('As an AI language model, I cannot find ACCESS Newswire.', input), false);
  assert.equal(classifyKnown('What do you know about ACCESS Newswire (accessnewswire.com)? UNKNOWN', input), false);
  assert.equal(classifyKnown('1. PR Newswire\n2. Business Wire', input), false);
  assert.equal(classifyKnown(
    'ACCESS Newswire is a press release distribution service. Companies use accessnewswire.com to send announcements to journalists.',
    input,
  ), true);
  assert.equal(classifyKnown(
    "I don't have live browsing, but ACCESS Newswire distributes press releases to newsrooms.",
    input,
  ), true);
  assert.equal(classifyKnown('1. HubSpot\n2. Salesforce', { businessName: 'HubSpot', domain: 'hubspot.com' }), true);

  const fake = {
    businessName: 'Zzqx Test Brow Studio QA',
    domain: 'zzqx-test-brow-studio-qa.example',
  };
  const denial = 'I couldn\'t find any reliable information about "Zzqx Test Brow Studio QA" or the website zzqx-test-brow-studio-qa.example. It does not show up as a real aesthetics studio in Nashville.';
  assert.equal(classifyKnown(denial, fake), false);
  assert.equal(classifyKnown('I searched for Zzqx Test Brow Studio QA and did not find a business by that name.', fake), false);
  assert.equal(classifyKnown('There is no evidence that Zzqx Test Brow Studio QA (zzqx-test-brow-studio-qa.example) exists.', fake), false);
  assert.equal(classifyKnown('UNKNOWN. I have no record of Zzqx Test Brow Studio QA.', fake), false);
  assert.equal(classifyKnown('Zzqx Test Brow Studio QA (zzqx-test-brow-studio-qa.example) — I wasn\'t able to find a verified listing for this name.', fake), false);
  const denied = judgeAnswer({
    text: 'I couldn\'t find any reliable information about "Zzqx Test Brow Studio QA" at https://zzqx-test-brow-studio-qa.example/.',
    citations: [],
  }, fake);
  assert.equal(denied.mentioned, false);
  assert.equal(denied.position, null);
  assert.equal(denied.cited, false);
  assert.equal(denied.score, 0);
  const site = judgeAnswer({
    text: 'HubSpot sells CRM software at https://www.hubspot.com/crm.',
    citations: [],
  }, { businessName: 'HubSpot', domain: 'hubspot.com' });
  assert.equal(site.mentioned, true);
  assert.equal(site.cited, true);
  const listed = judgeAnswer({
    text: '1. HubSpot — inbound CRM\n2. Salesforce',
    citations: ['https://www.hubspot.com/crm'],
  }, { businessName: 'HubSpot', domain: 'hubspot.com' });
  assert.equal(listed.mentioned, true);
  assert.equal(listed.position, 1);
  assert.equal(listed.cited, true);

  const known = { ok: true, known: true };
  const unknown = { ok: true, known: false };
  const failed = { ok: false, known: false };
  assert.equal(scoreVisibility([0, 0, 0], [known, known, known]), 25);
  assert.equal(scoreVisibility([0, 0, 0], [known, known, unknown]), 17);
  assert.equal(scoreVisibility([0, 0, 0], [known, unknown, unknown]), 8);
  assert.equal(scoreVisibility([0, 0, 0], [unknown, unknown, unknown]), 0);
  assert.equal(scoreVisibility([0, 0, 0], [known, known, failed]), 25);
  assert.equal(scoreVisibility([92, 92, 92], [known, known, known]), 94);
  assert.equal(scoreVisibility([100], [known]), 100);
  assert.equal(scoreVisibility([70], []), 70);
  assert.equal(scoreVisibility([], [known]), null);
});

test('a shorter name or a domain citation counts as knowing the business', () => {
  const hattie = { businessName: "Hattie B's Hot Chicken", domain: 'hattieb.com' };
  assert.equal(classifyKnown("Hattie B's is a hot chicken restaurant in Nashville.", hattie), true);
  assert.equal(classifyKnown(
    "I don't have specific information in my training data, but Hattie B's is a popular hot chicken restaurant in Nashville.",
    hattie,
  ), true);
  assert.equal(classifyKnown(
    "I don't have specific information about Hattie B's Hot Chicken, which is a Nashville hot chicken restaurant with several locations.",
    hattie,
  ), true);
  assert.equal(classifyKnown(
    'A Nashville hot chicken restaurant with several locations, known for spicy heat levels.',
    hattie,
    ['https://www.hattieb.com/menu'],
  ), true);
  assert.equal(classifyKnown(
    "Hattie B's Hot Chicken operates restaurants in Nashville. It serves hot chicken at hattieb.com.",
    hattie,
  ), true);

  const named = judgeAnswer({
    text: "1. Hattie B's\n2. Prince's Hot Chicken",
    citations: ['https://hattieb.com/'],
  }, hattie);
  assert.equal(named.mentioned, true);
  assert.equal(named.position, 1);
  assert.equal(named.cited, true);

  const fake = {
    businessName: 'Zzqx Test Brow Studio QA',
    domain: 'zzqx-test-brow-studio-qa.example',
  };
  const denial = 'I couldn\'t find any reliable information about "Zzqx Test Brow Studio QA" or the website zzqx-test-brow-studio-qa.example.';
  assert.equal(classifyKnown(denial, fake, [`https://${fake.domain}/`]), false);
  assert.equal(classifyKnown(
    'I searched for Zzqx Test Brow Studio QA and did not find a business by that name.',
    fake,
    ['https://zzqx-test-brow-studio-qa.example/'],
  ), false);
  assert.equal(classifyKnown(
    'Zzqx Test Brow Studio QA does not appear to be a real studio. Nashville has many brow studios such as Amalie Aesthetics.',
    fake,
    [`https://${fake.domain}/`],
  ), false);
  const denied = judgeAnswer({
    text: denial,
    citations: [`https://${fake.domain}/`],
  }, fake);
  assert.equal(denied.mentioned, false);
  assert.equal(denied.score, 0);
  assert.equal(scoreVisibility([0, 0, 0], [
    { ok: true, known: false },
    { ok: true, known: false },
    { ok: true, known: false },
  ]), 0);
});
