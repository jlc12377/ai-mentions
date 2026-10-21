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
  assert.match(page, /https:\/\/buy\.stripe\.com\/cNieVeclZ8MrbkX15ld7q0u/);
  assert.match(page, /https:\/\/buy\.stripe\.com\/9B63cw71Fe6LfBd4hxd7q0v/);
  assert.match(page, /Full AI Visibility Report — \$150/);
  assert.match(page, /\$65\/mo/);
  assert.match(page, /3-month minimum/);
  assert.equal(/credited toward/i.test(page), false);
  assert.equal(page.includes('We saved your request'), false);
  assert.equal(page.includes('There is no score to act on yet'), false);
  assert.equal(page.includes('separate from the live AI check'), false);
  assert.equal(/priority placement/i.test(page), false);
  assert.equal(page.includes('cross-network syndication'), false);
  assert.match(page, /We could not score this one/);
  assert.match(page, /we did not invent a number/);
  assert.match(page, /See where businesses rank on our independent Best-of lists/);
  assert.match(page, /Get verified and listed/);
  assert.match(page, /AI Visibility Package from \$299\/mo/);
  assert.equal(page.includes('cNi8wQ3Pt3s7bkXdS7d7q04'), false);
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
  assert.match(readme, /SUPABASE_URL/);
  assert.match(readme, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.equal(/KV_REST_API_URL|UPSTASH_REDIS/.test(readme), false);
  assert.match(readme, /\/v1\/responses/);
  assert.match(readme, /PERPLEXITY_BUDGET_MS/);
  assert.match(readme, /PERPLEXITY_429_RETRIES/);
  assert.match(readme, /STRIPE_RESTRICTED_KEY/);
  assert.match(readme, /RESEND_API_KEY/);
  assert.match(readme, /AI Mentions <reports@ai-mentions.com>/);
  assert.match(readme, /CRON_SECRET/);
  assert.match(readme, /supabase\/schema\.sql/);
  assert.match(readme, /server/);
  assert.match(readme, /3-month minimum/);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  for (const name of ['reports', 'subscribers', 'report_history', 'checkout_sessions']) {
    assert.match(schema, new RegExp(`table if not exists public\\.${name}`));
    assert.match(schema, new RegExp(`alter table public\\.${name} enable row level security`, 'i'));
  }
  assert.match(schema, /revoke all on table public\.reports from public, anon, authenticated/i);
  assert.match(schema, /notify pgrst, 'reload schema'/);
  assert.equal(/create policy/i.test(schema), false);
  assert.equal(/to anon/i.test(schema.replace(/from public, anon, authenticated/gi, '')), false);
  assert.equal(page.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'report.html'), 'utf8').includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(readme.includes('sk-'), false);
  assert.equal(/credited toward/i.test(readme), false);
  const reportPage = fs.readFileSync(path.join(__dirname, '..', 'report.html'), 'utf8');
  assert.match(reportPage, /3-month minimum/);
  assert.match(reportPage, /6oU5kEclZgeT1Kng0fd7q0w/);
  assert.equal(/credited toward/i.test(reportPage), false);
});
