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
  assert.equal(MENTION_WEIGHT, 0.7);
  assert.equal(CITATION_WEIGHT, 0.3);
  assert.match(METHODOLOGY, /70%/);
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
