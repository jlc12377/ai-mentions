'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

test('the page no longer ships the fake checker', () => {
  assert.equal(page.includes('Scanning AI knowledge bases'), false);
  assert.equal(page.includes('Checking ChatGPT recommendations'), false);
  assert.equal(page.includes('Analyzing Claude responses'), false);
  assert.equal(page.includes('Evaluating Perplexity citations'), false);
  assert.equal(page.includes('positionScores'), false);
  assert.equal(page.includes("top:['Salesforce'"), false);
  assert.equal(page.includes('top:["Salesforce"'), false);
  assert.match(page, /\/api\/score/);
  assert.match(page, /Score temporarily unavailable/);
  assert.match(page, /formspree\.io\/f\/xqegnezp/);
  assert.match(page, /id="methodology"/);
  assert.match(page, /70%/);
  assert.match(page, /30%/);
  assert.match(page, /Failed:/);
  assert.match(page, /questions failed and were left out of this score/);
  assert.match(page, /answered without web search/);
  assert.equal(page.includes('No answer returned'), false);
});

test('deploy notes name the provider env vars and the formula', () => {
  for (const name of ['OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY']) {
    assert.match(readme, new RegExp(name));
  }
  assert.match(readme, /gpt-4\.1-mini/);
  assert.match(readme, /perplexity\/sonar/);
  assert.match(readme, /gemini-2\.5-flash-lite/);
  assert.match(readme, /claude-haiku-5-5/);
  assert.match(readme, /24/);
  assert.match(readme, /in-memory/);
  assert.match(readme, /KV_REST_API_URL/);
  assert.match(readme, /\/v1\/responses/);
  assert.match(readme, /PERPLEXITY_BUDGET_MS/);
  assert.match(readme, /PERPLEXITY_429_RETRIES/);
  assert.equal(readme.includes('sk-'), false);
});
