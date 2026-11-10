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
  assert.match(page, /by Listicle Liaison/);
  assert.match(page, /network of review sites/);
  assert.match(page, /Want to see more insights\? Get the full report: every answer AI gave, the sources it trusts, and what to fix\. \$150/);
  assert.match(page, /Or track it monthly for \$65\/mo/);
  assert.match(page, /Try again/);
  assert.match(page, /email this score to you/);
  assert.match(page, /Did not answer/);
  assert.match(page, /recommends /);
  assert.match(page, /Knows you: /);
  assert.match(page, /Recommends you: /);
  assert.match(page, /partial credit/);
  assert.match(page, /does not recommend you yet/);
  assert.match(page, /does not use web search/);
  assert.match(page, /cannot raise the score/);
  assert.match(page, /score-meaning/);
  assert.match(page, /0–5/);
  assert.match(page, /G-P8P36G6MZV/);
  assert.match(page, /score_started/);
  assert.match(page, /generate_lead/);
  assert.match(page, /if \(shownNumericScore\(data\)\) \{\s*trackEvent\('score_completed', \{ score_bucket: scoreBucket\(data\.score\) \}\);\s*\}/);
  assert.match(page, /upsell_click/);
  assert.match(page, /data-plan="report_150"/);
  assert.match(page, /data-plan="tracking_65"/);
  assert.match(page, /aim_attribution/);
  assert.match(page, /utm_source/);
  assert.match(page, /utm_campaign/);
  assert.match(page, /gclid/);
  assert.equal(page.includes("score_completed', { company"), false);
  assert.equal(page.includes('score_completed\', { businessName'), false);
  assert.equal(page.includes('Failed:'), false);
  assert.equal(page.includes('questions failed and were left out of this score'), false);
  assert.equal(page.includes('answered without web search'), false);
  assert.equal(page.includes('publishing network'), false);
  assert.equal(/Franklin|headquarters/i.test(page), false);
  assert.equal(page.includes('No answer returned'), false);
  assert.match(page, /https:\/\/buy\.stripe\.com\/cNieVeclZ8MrbkX15ld7q0u/);
  assert.match(page, /https:\/\/buy\.stripe\.com\/9B63cw71Fe6LfBd4hxd7q0v/);
  assert.match(page, /How we score/);
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
  assert.match(page, /src="\/lists\.js"/);
  assert.match(page, /id="categorySearch"/);
  assert.match(page, /id="listCta"/);
  assert.match(page, /There is no matching list for this category and city/);
  assert.match(page, /https:\/\/localsmallbusinessreviews\.com/);
  assert.match(page, /listDestination/);
  assert.match(page, /Plans from \$99\/mo/);
  assert.match(page, /Basic \$99\/mo/);
  assert.match(page, /Enhanced \$299\/mo/);
  assert.match(page, /Optimal \$699\/mo/);
  assert.match(page, /id="pricingCta"/);
  assert.match(page, /https:\/\/listicleliaison\.com\/pages\/pricing\.html/);
  assert.equal(page.includes('AI Visibility Package'), false);
  assert.equal(page.includes('View the package'), false);
  assert.equal(page.includes('softwareindustryreviews.com/pages/pricing'), false);
  assert.equal(page.includes('Gemini'), false);
  assert.equal(/you.?re invisible/i.test(page), false);
  assert.equal(/first-mover/i.test(page), false);
  assert.equal(page.includes('Millions of people'), false);
  assert.equal(/capturing demand/i.test(page), false);
  assert.equal(/about 10 seconds|10 seconds/i.test(page), false);
  assert.match(page, /Usually under a minute/);
  assert.match(page, /usually comes back in under a minute/);
  assert.match(page, /class="tool-scope"/);
  assert.match(page, /business owners checking whether ChatGPT, Claude, and Perplexity recommend their business/);
  assert.match(page, /not a checker for AI-written text/);
  assert.match(page, /id="tool"/);
  assert.match(page, /id="how"/);
  assert.match(page, /Which state\?/);
  assert.match(page, /id="cityChoices"/);
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
  assert.match(readme, /SCORE_BUDGET_MS/);
  assert.match(readme, /PERPLEXITY_429_RETRIES/);
  assert.match(readme, /STRIPE_RESTRICTED_KEY/);
  assert.match(readme, /RESEND_API_KEY/);
  assert.match(readme, /AI Mentions <reports@ai-mentions.com>/);
  assert.match(readme, /CRON_SECRET/);
  assert.match(readme, /supabase\/schema\.sql/);
  assert.match(readme, /server/);
  assert.match(readme, /3-month minimum/);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  for (const name of ['reports', 'subscribers', 'report_history', 'checkout_sessions', 'free_scores']) {
    assert.match(schema, new RegExp(`table if not exists public\\.${name}`));
    assert.match(schema, new RegExp(`alter table public\\.${name} enable row level security`, 'i'));
  }
  assert.match(schema, /revoke all on table public\.reports from public, anon, authenticated/i);
  assert.match(schema, /revoke all on table public\.free_scores from public, anon, authenticated/i);
  assert.match(readme, /supabase\/migrations\/free_scores\.sql/);
  assert.match(readme, /G-P8P36G6MZV/);
  assert.match(readme, /score_started/);
  assert.match(readme, /score_completed/);
  assert.match(readme, /generate_lead/);
  assert.match(readme, /upsell_click/);
  assert.match(schema, /notify pgrst, 'reload schema'/);
  assert.equal(/create policy/i.test(schema), false);
  assert.equal(/to anon/i.test(schema.replace(/from public, anon, authenticated/gi, '')), false);
  assert.equal(page.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'report.html'), 'utf8').includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(readme.includes('sk-'), false);
  assert.equal(/credited toward/i.test(readme), false);
  const reportPage = fs.readFileSync(path.join(__dirname, '..', 'report.html'), 'utf8');
  assert.match(reportPage, /by Listicle Liaison/);
  assert.match(reportPage, /3-month minimum/);
  assert.match(reportPage, /6oU5kEclZgeT1Kng0fd7q0w/);
  assert.equal(/credited toward/i.test(reportPage), false);
});

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, name);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return new Function(`return (${source.slice(start, i + 1)})`)();
    }
  }
  throw new Error(`unclosed function ${name}`);
}

test('score_completed fires only when a real numeric score is shown', () => {
  const shownNumericScore = extractFunction(page, 'shownNumericScore');
  const scoreBucket = extractFunction(page, 'scoreBucket');
  const failures = ['all_failed', 'no_providers', 'rate_limited', 'validation', 'error', 'unavailable'];
  for (const reason of failures) {
    assert.equal(shownNumericScore({ score: null, unavailable: true, reason }), false, reason);
    assert.equal(shownNumericScore({ score: 42, unavailable: true, reason }), false, reason);
    assert.equal(shownNumericScore({ score: 42, reason }), false, reason);
  }
  assert.equal(shownNumericScore(null), false);
  assert.equal(shownNumericScore(undefined), false);
  assert.equal(shownNumericScore({ unavailable: true, score: null, message: 'Score temporarily unavailable' }), false);
  assert.equal(shownNumericScore({ score: null }), false);
  assert.equal(shownNumericScore({ score: '25' }), false);
  assert.equal(shownNumericScore({ score: NaN }), false);
  assert.equal(shownNumericScore({ score: Infinity }), false);
  for (const score of [0, 8, 17, 25, 39, 40, 69, 70, 100]) {
    assert.equal(shownNumericScore({ ok: true, unavailable: false, score }), true, String(score));
  }
  assert.equal(scoreBucket(0), 'low');
  assert.equal(scoreBucket(39), 'low');
  assert.equal(scoreBucket(40), 'moderate');
  assert.equal(scoreBucket(69), 'moderate');
  assert.equal(scoreBucket(70), 'strong');
  assert.equal(scoreBucket(100), 'strong');
  assert.equal(page.split("trackEvent('score_completed'").length, 2);
  assert.match(page, /trackEvent\('score_started'\);\s*trackEvent\('generate_lead'\);/);
  const leadAt = page.indexOf("trackEvent('generate_lead')");
  const completedAt = page.indexOf("trackEvent('score_completed'");
  assert.ok(leadAt !== -1 && leadAt < completedAt);
  assert.match(readme, /only when a real numeric score is shown/);
  assert.match(readme, /does not fire `score_completed`/);
  const formAt = page.indexOf('id="checkForm"');
  const scopeAt = page.indexOf('class="tool-scope"');
  assert.ok(scopeAt !== -1 && formAt !== -1 && scopeAt < formAt);
});
