'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PRODUCTS, classifyPaidSession } = require('../lib/products');
const { buildRecommendations, monthChange } = require('../lib/report-build');
const { supabaseConfig, createSupabaseStore, createPaidStore, createMemoryKv } = require('../lib/paid-store');
const {
  createReportHandler,
  createPrivateReportHandler,
  createCronHandler,
} = require('../lib/report-service');

require('../api/report');
require('../api/r');
require('../api/cron/reports');

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); },
    async json() { return payload; },
  };
}

function answerFor(url) {
  const href = String(url);
  const text = '1. HubSpot\n2. Salesforce';
  if (href.includes('api.openai.com')) return { output_text: text };
  if (href.includes('api.perplexity.ai')) {
    return { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] };
  }
  if (href.includes('api.anthropic.com')) {
    return {
      content: [{
        type: 'text',
        text,
        citations: [{ type: 'web_search_result_location', url: 'https://www.hubspot.com/a' }],
      }],
    };
  }
  throw new Error(`unexpected provider ${href}`);
}

function paidSession(overrides = {}) {
  return {
    id: 'cs_test_paidreport01',
    status: 'complete',
    payment_status: 'paid',
    mode: 'payment',
    amount_total: 15000,
    customer: 'cus_123',
    customer_details: { email: 'buyer@example.com' },
    subscription: null,
    ...overrides,
  };
}

function providerEnv(extra = {}) {
  return {
    STRIPE_RESTRICTED_KEY: 'rk_test_restricted',
    OPENAI_API_KEY: 'test-openai',
    PERPLEXITY_API_KEY: 'test-perplexity',
    ANTHROPIC_API_KEY: 'test-anthropic',
    GEMINI_API_KEY: 'test-gemini',
    SCORE_PROMPT_COUNT: '4',
    PERPLEXITY_PROMPT_DELAY_MS: '0',
    PUBLIC_BASE_URL: 'https://ai-mentions.com',
    ...extra,
  };
}

function mockFetch(calls, sessions) {
  return async (url, options) => {
    const href = String(url);
    calls.push({ url: href, options });
    if (href.includes('api.stripe.com/v1/checkout/sessions/')) {
      const id = href.split('/').pop();
      return jsonResponse(200, sessions[id] || paidSession({ id }));
    }
    if (href.includes('api.stripe.com/v1/subscriptions/')) {
      const id = href.split('/').pop();
      const status = id === 'sub_dead' ? 'canceled' : 'active';
      return jsonResponse(200, { id, status });
    }
    if (href.includes('api.resend.com')) return jsonResponse(200, { id: 'email_1' });
    if (href.includes('generativelanguage.googleapis.com')) {
      throw new Error('gemini is not part of the paid report');
    }
    return jsonResponse(200, answerFor(href));
  };
}

function memoryStore() {
  return createPaidStore(createMemoryKv());
}

function invoke(handler, { method = 'POST', body, headers = {}, url = '/' }) {
  const req = { method, headers, body, url, socket: { remoteAddress: '127.0.0.1' } };
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    text: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(payload) {
      this.text = String(payload);
      try { this.body = JSON.parse(this.text); } catch { this.body = null; }
    },
  };
  return handler(req, res).then(() => res);
}

const business = {
  sessionId: 'cs_test_paidreport01',
  businessName: 'HubSpot',
  domain: 'hubspot.com',
  category: 'CRM Software',
  city: 'Austin',
};

test('paid sessions map to the three products', () => {
  assert.equal(classifyPaidSession(paidSession()).product.id, 'report');
  assert.equal(classifyPaidSession(paidSession({
    mode: 'subscription',
    amount_total: 6500,
    subscription: 'sub_tracking1',
  })).product, PRODUCTS.tracking);
  assert.equal(classifyPaidSession(paidSession({
    mode: 'subscription',
    amount_total: 4900,
    subscription: 'sub_addon1',
  })).product.id, 'addon');
  assert.throws(() => classifyPaidSession(paidSession({ payment_status: 'unpaid' })), /not paid/);
  assert.equal(PRODUCTS.tracking.minimum, '3-month minimum');
});

test('recommendations use the competitors and missed citations from the check', () => {
  const view = {
    businessName: 'HubSpot',
    domain: 'hubspot.com',
    providers: [
      {
        id: 'openai',
        label: 'ChatGPT',
        ok: true,
        score: 70,
        checks: [{ ok: true, mentioned: true, position: 2, cited: false, score: 70 }],
      },
      {
        id: 'perplexity',
        label: 'Perplexity',
        ok: false,
        score: null,
        error: 'HTTP 429: Request rate limit exceeded',
        checks: [{ ok: false, error: 'HTTP 429: Request rate limit exceeded' }],
      },
    ],
    competitors: [{ name: 'Salesforce', mentions: 2 }],
    sources: [{ url: 'https://www.salesforce.com/crm', host: 'salesforce.com', own: false }],
  };
  const items = buildRecommendations(view);
  assert.match(items.map((item) => item.detail).join(' '), /Salesforce/);
  assert.match(items.map((item) => item.title).join(' '), /hubspot\.com cited/i);
  assert.match(items.map((item) => item.detail).join(' '), /failed assistant|did not return/i);
  const change = monthChange(
    { score: 40, summary: { mentions: 1, citations: 0 }, timestamp: '2026-09-01T00:00:00.000Z' },
    { score: 70, summary: { mentions: 3, citations: 1 } },
  );
  assert.equal(change.scoreDelta, 30);
  assert.match(change.text, /40 to 70/);
});

test('a paid session runs the three engines once and blocks a second business', async () => {
  const calls = [];
  const store = memoryStore();
  const handler = createReportHandler({
    env: providerEnv(),
    fetch: mockFetch(calls, {}),
    store,
    sleep: async () => {},
  });
  const first = await invoke(handler, { body: business });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.report.score, 80);
  assert.equal(first.body.emailSent, false);
  assert.equal(first.body.emailReason, 'not_configured');
  assert.match(first.body.url, /^https:\/\/ai-mentions\.com\/r\/[A-Za-z0-9_-]{20,}$/);
  assert.equal(first.body.report.providers.map((provider) => provider.id).join(','), 'openai,perplexity,anthropic');
  assert.ok(first.body.report.recommendations.length > 0);
  assert.ok(first.body.report.competitors.some((row) => row.name === 'Salesforce'));
  const providerCalls = calls.filter((call) => /openai|perplexity|anthropic/.test(call.url));
  assert.equal(providerCalls.length, 12);
  assert.equal(calls.some((call) => call.url.includes('generativelanguage')), false);

  const again = await invoke(handler, { body: business });
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.alreadyGenerated, true);
  assert.equal(again.body.token, first.body.token);
  assert.equal(calls.filter((call) => /openai|perplexity|anthropic/.test(call.url)).length, 12);

  const other = await invoke(handler, { body: { ...business, businessName: 'Salesforce', domain: 'salesforce.com' } });
  assert.equal(other.statusCode, 409);
  assert.match(other.body.error, /already used/);
  assert.equal(other.body.token, first.body.token);
  assert.equal(other.body.ok, false);

  const page = await invoke(createPrivateReportHandler({
    env: providerEnv(),
    fetch: mockFetch(calls, {}),
    store,
  }), { method: 'GET', url: `/?token=${first.body.token}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.text, /HubSpot/);
  assert.match(page.text, /Salesforce/);
  assert.match(page.text, /What to do next/);
  assert.match(page.text, /noindex/);
  assert.equal(page.headers['x-robots-tag'], 'noindex, nofollow');
});

test('email failure does not discard the report, and a configured Resend send includes the private link', async () => {
  const calls = [];
  const store = memoryStore();
  const env = providerEnv({ RESEND_API_KEY: 're_test', REPORT_FROM_EMAIL: 'reports@ai-mentions.com' });
  const handler = createReportHandler({
    env,
    fetch: mockFetch(calls, {}),
    store,
    sleep: async () => {},
  });
  const created = await invoke(handler, { body: business });
  assert.equal(created.body.emailSent, true);
  const emailCall = calls.find((call) => call.url.includes('api.resend.com'));
  const email = JSON.parse(emailCall.options.body);
  assert.equal(email.to[0], 'buyer@example.com');
  assert.equal(email.from, 'reports@ai-mentions.com');
  assert.match(email.html, new RegExp(created.body.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(emailCall.options.headers.Authorization, 'Bearer re_test');

  const failing = [];
  const second = memoryStore();
  const failedMail = createReportHandler({
    env,
    fetch: async (url, options) => {
      if (String(url).includes('api.resend.com')) return jsonResponse(500, { message: 'no' });
      return mockFetch(failing, {})(url, options);
    },
    store: second,
    sleep: async () => {},
  });
  const saved = await invoke(failedMail, { body: business });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.emailSent, false);
  assert.equal(saved.body.emailReason, 'send_failed');
  assert.ok(saved.body.url);
});

test('an unpaid or unfinished checkout cannot generate a report', async () => {
  const calls = [];
  const store = memoryStore();
  const handler = createReportHandler({
    env: providerEnv(),
    fetch: mockFetch(calls, {
      cs_test_paidreport01: paidSession({ payment_status: 'unpaid', status: 'complete' }),
    }),
    store,
    sleep: async () => {},
  });
  const unpaid = await invoke(handler, { body: business });
  assert.equal(unpaid.statusCode, 402);
  assert.equal(calls.some((call) => /openai|perplexity|anthropic/.test(call.url)), false);
  const missing = await invoke(handler, { body: { ...business, domain: '' } });
  assert.equal(missing.statusCode, 400);
});

test('a total provider failure does not consume the payment', async () => {
  const store = memoryStore();
  const handler = createReportHandler({
    env: providerEnv(),
    fetch: async (url) => {
      if (String(url).includes('api.stripe.com')) return jsonResponse(200, paidSession());
      return jsonResponse(500, { error: { message: 'down' } });
    },
    store,
    sleep: async () => {},
  });
  const failed = await invoke(handler, { body: business });
  assert.equal(failed.statusCode, 503);
  assert.match(failed.body.error, /not used/);
  assert.equal(await store.getSessionToken('cs_test_paidreport01'), '');
  const retry = await invoke(handler, { body: business });
  assert.equal(retry.statusCode, 503);
});

test('tracking checkout stores the subscriber and the daily job reruns due active subscriptions', async () => {
  const calls = [];
  const store = memoryStore();
  const sessions = {
    cs_test_paidreport01: paidSession({
      mode: 'subscription',
      amount_total: 6500,
      subscription: 'sub_tracking1',
    }),
  };
  const env = providerEnv({
    RESEND_API_KEY: 're_test',
    REPORT_FROM_EMAIL: 'reports@ai-mentions.com',
    CRON_SECRET: 'cron-secret',
    CRON_BUDGET_MS: '600000',
  });
  const handler = createReportHandler({
    env,
    fetch: mockFetch(calls, sessions),
    store,
    sleep: async () => {},
  });
  const created = await invoke(handler, { body: business });
  assert.equal(created.statusCode, 200);
  const subscriber = await store.getSubscriber('sub_tracking1');
  assert.equal(subscriber.email, 'buyer@example.com');
  assert.equal(subscriber.productId, 'tracking');
  assert.deepEqual(subscriber.business.domain, 'hubspot.com');
  assert.equal(subscriber.reportTokens.length, 1);
  subscriber.lastReportAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  await store.saveSubscriber(subscriber);
  await store.saveSubscriber({
    subscriptionId: 'sub_dead',
    customerId: 'cus_dead',
    email: 'old@example.com',
    productId: 'addon',
    business: subscriber.business,
    fingerprint: subscriber.fingerprint,
    reportTokens: [],
    lastReportAt: subscriber.lastReportAt,
    status: 'active',
    createdAt: subscriber.createdAt,
  });
  await store.saveSubscriber({
    ...subscriber,
    subscriptionId: 'sub_recent',
    lastReportAt: new Date().toISOString(),
    reportTokens: [],
  });

  const cron = createCronHandler({ env, fetch: mockFetch(calls, sessions), store, sleep: async () => {} });
  const denied = await invoke(cron, { method: 'GET', headers: {} });
  assert.equal(denied.statusCode, 401);
  const wrong = await invoke(cron, { method: 'GET', headers: { authorization: 'Bearer wrong' } });
  assert.equal(wrong.statusCode, 401);
  const ran = await invoke(cron, { method: 'GET', headers: { authorization: 'Bearer cron-secret' } });
  assert.equal(ran.statusCode, 200);
  assert.equal(ran.body.ran, 1);
  assert.equal(ran.body.stopped, 1);
  const updated = await store.getSubscriber('sub_tracking1');
  assert.equal(updated.reportTokens.length, 2);
  assert.equal((await store.getSubscriber('sub_dead')).status, 'inactive');
  const latest = await store.getReport(updated.reportTokens[1]);
  assert.equal(latest.origin, 'monthly');
  assert.match(latest.view.change.text, /moved from/);
  const quiet = await invoke(cron, { method: 'GET', headers: { authorization: 'Bearer cron-secret' } });
  assert.equal(quiet.body.ran, 0);
});

test('the daily job stops after one report inside the default time budget', async () => {
  const calls = [];
  const store = memoryStore();
  const businessRow = {
    businessName: 'HubSpot',
    domain: 'hubspot.com',
    category: 'CRM Software',
    city: 'Austin',
  };
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  for (const id of ['sub_one', 'sub_two']) {
    await store.saveSubscriber({
      subscriptionId: id,
      customerId: 'cus_123',
      email: 'buyer@example.com',
      productId: 'tracking',
      business: businessRow,
      fingerprint: 'hubspot',
      reportTokens: [],
      lastReportAt: old,
      status: 'active',
      createdAt: old,
    });
  }
  const cron = createCronHandler({
    env: providerEnv({ CRON_SECRET: 'cron-secret' }),
    fetch: mockFetch(calls, {}),
    store,
    sleep: async () => {},
  });
  const ran = await invoke(cron, { method: 'GET', headers: { authorization: 'Bearer cron-secret' } });
  assert.equal(ran.body.ran, 1);
  assert.equal(ran.body.due, 2);
});

test('supabase storage uses the service role on the server and keeps report history', async () => {
  assert.equal(supabaseConfig({}), null);
  assert.equal(supabaseConfig({ SUPABASE_URL: 'https://aaa.supabase.co' }), null);
  assert.equal(supabaseConfig({
    SUPABASE_URL: 'https://aaa.supabase.co',
    NEXT_PUBLIC_SUPABASE_URL: 'https://bbb.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
  }).url, 'https://aaa.supabase.co');
  assert.equal(supabaseConfig({
    NEXT_PUBLIC_SUPABASE_URL: 'https://bbb.supabase.co/',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
  }).url, 'https://bbb.supabase.co');

  const tables = {
    reports: [],
    subscribers: [],
    report_history: [],
    checkout_sessions: [],
    report_locks: [],
  };
  const calls = [];
  function keyOf(table, row) {
    if (table === 'reports') return row.token;
    if (table === 'subscribers') return row.subscription_id;
    if (table === 'checkout_sessions') return row.session_id;
    if (table === 'report_locks') return row.name;
    return `${row.subscription_id}:${row.token}`;
  }
  const store = createSupabaseStore({
    NEXT_PUBLIC_SUPABASE_URL: 'https://bbb.supabase.co/',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
  }, async (url, options) => {
    const href = String(url);
    calls.push(href);
    assert.equal(href.includes('sb_secret_test'), false);
    assert.equal(options.headers.apikey, 'sb_secret_test');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers['User-Agent'], 'ai-mentions');
    const parsed = new URL(href);
    const table = parsed.pathname.split('/').pop();
    const rows = tables[table];
    if (!rows) return jsonResponse(404, { code: 'PGRST205', message: 'Could not find the table in the schema cache' });
    if (options.method === 'GET') {
      let found = rows.slice();
      for (const [name, value] of parsed.searchParams.entries()) {
        if (name === 'select' || name === 'order' || name === 'on_conflict') continue;
        const dot = value.indexOf('.');
        const op = dot === -1 ? '' : value.slice(0, dot);
        const raw = dot === -1 ? '' : value.slice(dot + 1);
        if (op === 'eq') found = found.filter((row) => String(row[name]) === raw);
      }
      if ((parsed.searchParams.get('order') || '').startsWith('created_at')) {
        found.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      }
      return jsonResponse(200, found);
    }
    const body = options.body ? JSON.parse(options.body) : null;
    if (options.method === 'POST') {
      const conflict = (parsed.searchParams.get('on_conflict') || '').split(',').filter(Boolean);
      const index = conflict.length
        ? rows.findIndex((row) => conflict.every((column) => row[column] === body[column]))
        : rows.findIndex((row) => keyOf(table, row) === keyOf(table, body));
      if (index >= 0) {
        if (!String(options.headers.Prefer || '').includes('merge-duplicates')) {
          return jsonResponse(409, { code: '23505', message: 'duplicate' });
        }
        rows[index] = { ...rows[index], ...body };
      } else {
        rows.push({ ...body, created_at: body.created_at || new Date().toISOString() });
      }
      const saved = rows[index >= 0 ? index : rows.length - 1];
      return jsonResponse(201, String(options.headers.Prefer || '').includes('return=minimal') ? null : [saved]);
    }
    if (options.method === 'DELETE') {
      const nameFilter = parsed.searchParams.get('name') || '';
      const name = nameFilter.startsWith('eq.') ? nameFilter.slice(3) : '';
      const expiry = parsed.searchParams.get('expires_at') || '';
      const cutoff = expiry.startsWith('lt.') ? Date.parse(expiry.slice(3)) : null;
      tables[table] = rows.filter((row) => {
        if (name && row.name !== name) return true;
        if (cutoff != null) return Date.parse(row.expires_at) >= cutoff;
        return false;
      });
      return jsonResponse(204, null);
    }
    return jsonResponse(400, { message: 'unsupported' });
  });

  const missing = createSupabaseStore({
    SUPABASE_URL: 'https://aaa.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
  }, async () => jsonResponse(404, { code: 'PGRST205', message: 'schema cache' }));
  await assert.rejects(() => missing.getReport('missing-token'), /supabase\/schema\.sql/);

  const legacyCalls = [];
  const legacy = createSupabaseStore({
    SUPABASE_URL: 'https://aaa.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJub25lIn0.e30.sig',
  }, async (url, options) => {
    legacyCalls.push(options.headers);
    return jsonResponse(200, []);
  });
  await legacy.getReport('legacy-token');
  assert.equal(legacyCalls[0].apikey, 'eyJhbGciOiJub25lIn0.e30.sig');
  assert.equal(legacyCalls[0].Authorization, 'Bearer eyJhbGciOiJub25lIn0.e30.sig');

  const publishable = createSupabaseStore({
    SUPABASE_URL: 'https://aaa.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_test',
  }, async () => {
    throw new Error('publishable key must not be sent');
  });
  await assert.rejects(() => publishable.getReport('nope'), /server secret key/);

  await store.setSessionToken('cs_test_paidreport01', 'saved-token');
  assert.equal(await store.getSessionToken('cs_test_paidreport01'), 'saved-token');
  await store.saveReport({
    token: 'saved-token',
    sessionId: 'cs_test_paidreport01',
    subscriptionId: 'sub_tracking1',
    origin: 'checkout',
    productId: 'tracking',
    productName: 'AI Visibility Tracking',
    customerEmail: 'buyer@example.com',
    customerId: 'cus_123',
    business: { businessName: 'HubSpot', domain: 'hubspot.com', category: 'CRM Software', city: 'Austin' },
    fingerprint: 'hubspot',
    createdAt: '2026-10-01T00:00:00.000Z',
    view: { score: 80 },
    email: { sent: true, reason: '' },
  });
  await store.saveSubscriber({
    subscriptionId: 'sub_tracking1',
    customerId: 'cus_123',
    email: 'buyer@example.com',
    productId: 'tracking',
    business: { businessName: 'HubSpot' },
    fingerprint: 'hubspot',
    reportTokens: ['saved-token'],
    lastReportAt: '2026-10-01T00:00:00.000Z',
    status: 'active',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  });
  const loaded = await store.getSubscriber('sub_tracking1');
  assert.deepEqual(loaded.reportTokens, ['saved-token']);
  assert.equal((await store.getReport('saved-token')).view.score, 80);
  assert.deepEqual(await store.listSubscriberIds(), ['sub_tracking1']);
  assert.equal(await store.lock('session:cs_test_paidreport01', 30), true);
  assert.equal(await store.lock('session:cs_test_paidreport01', 30), false);
  await store.unlock('session:cs_test_paidreport01');
  assert.equal(await store.lock('session:cs_test_paidreport01', 30), true);
  assert.ok(calls.every((href) => href.startsWith('https://bbb.supabase.co/rest/v1/')));
});
