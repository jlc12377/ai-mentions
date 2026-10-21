'use strict';

const crypto = require('crypto');
const {
  METHODOLOGY,
  FORMULA_VERSION,
  InputError,
  validateInput,
  buildPrompts,
  averageScores,
  collectCompetitors,
  summarize,
} = require('./score');
const { readConfig, runProviders } = require('./providers');
const { PRODUCTS, MONTH_MS, publicProduct } = require('./products');
const { storeForEnv, createPaidStore, createMemoryKv } = require('./paid-store');
const {
  loadPaidCheckout,
  loadSubscription,
  subscriptionIsActive,
  subscriptionShouldStop,
} = require('./billing');
const { sendReportEmail } = require('./report-mail');
const { businessFingerprint, buildView, monthChange } = require('./report-build');
const { renderReportDocument } = require('./report-html');

const REQUIRED_ENGINES = ['openai', 'perplexity', 'anthropic'];
const CHECK_RESERVE_MS = 70000;

function reportError(message, status) {
  const error = new Error(message);
  error.status = status || 500;
  return error;
}

function siteBase(env) {
  return String(env.PUBLIC_BASE_URL || 'https://ai-mentions.com').replace(/\/$/, '');
}

function reportLink(env, token) {
  return `${siteBase(env)}/r/${token}`;
}

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function readBody(req) {
  const body = req.body;
  if (body == null || body === '') return {};
  if (typeof body === 'string') return JSON.parse(body);
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString('utf8'));
  if (typeof body === 'object') return body;
  return {};
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(JSON.stringify(payload));
}

function sendHtml(res, status, html) {
  res.statusCode = status;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  res.end(html);
}

function requireStore(deps, env, fetchImpl) {
  if (deps.store) return deps.store;
  const store = storeForEnv(env, fetchImpl);
  if (!store) throw reportError('Report storage is not connected.', 503);
  return store;
}

function clientPayload(env, record) {
  return {
    ok: true,
    token: record.token,
    url: reportLink(env, record.token),
    alreadyGenerated: Boolean(record.alreadyGenerated),
    emailSent: Boolean(record.email && record.email.sent),
    emailReason: (record.email && record.email.reason) || '',
    product: publicProduct(PRODUCTS[record.productId] || PRODUCTS.report),
    report: record.view,
  };
}

async function runThreeEngines(input, env, fetchImpl, options) {
  const config = readConfig(env);
  const missing = REQUIRED_ENGINES.filter((id) => {
    if (id === 'openai') return !config.openaiKey;
    if (id === 'perplexity') return !config.perplexityKey;
    return !config.anthropicKey;
  });
  if (missing.length) {
    throw reportError('The full report needs ChatGPT, Perplexity, and Claude connected.', 503);
  }
  const prompts = buildPrompts(input.category, input.city, config.promptCount);
  const { providers, skipped } = await runProviders(input, prompts, config, fetchImpl, {
    sleep: options.sleep,
    now: options.now,
    onlyIds: REQUIRED_ENGINES,
  });
  const successful = providers.flatMap((provider) => provider.rawChecks.map((check) => ({ ...check, ok: true })));
  if (!successful.length) {
    throw reportError('Every assistant failed or timed out. This payment was not used. Try the report again.', 503);
  }
  return {
    businessName: input.businessName,
    domain: input.domain,
    category: input.category,
    city: input.city,
    prompts,
    score: averageScores(successful.map((check) => check.score)),
    timestamp: new Date().toISOString(),
    summary: summarize(successful),
    providers: providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      model: provider.model,
      mode: provider.mode,
      ok: provider.ok,
      score: provider.score,
      error: provider.error,
      checks: provider.checks,
    })),
    skipped,
    competitors: collectCompetitors(successful, input.businessName, input.domain),
    formula: { version: FORMULA_VERSION, description: METHODOLOGY },
  };
}

function sameBusiness(record, input) {
  return record.fingerprint === businessFingerprint(input);
}

async function rememberSubscriber(store, paid, input, token, checkedAt) {
  if (!paid.product.recurring || !paid.subscriptionId) return;
  const existing = await store.getSubscriber(paid.subscriptionId);
  const tokens = existing && Array.isArray(existing.reportTokens) ? existing.reportTokens.slice() : [];
  if (!tokens.includes(token)) tokens.push(token);
  await store.saveSubscriber({
    subscriptionId: paid.subscriptionId,
    customerId: paid.customerId,
    email: paid.email,
    productId: paid.product.id,
    business: {
      businessName: input.businessName,
      domain: input.domain,
      category: input.category,
      city: input.city,
    },
    fingerprint: businessFingerprint(input),
    reportTokens: tokens,
    lastReportAt: checkedAt,
    status: 'active',
    createdAt: existing?.createdAt || checkedAt,
    updatedAt: checkedAt,
  });
}

async function finishExisting(env, fetchImpl, store, existing, input) {
  if (!sameBusiness(existing, input)) {
    const error = reportError('This payment was already used for a report.', 409);
    error.payload = clientPayload(env, existing);
    throw error;
  }
  if (!existing.email || !existing.email.sent) {
    await deliverEmail(env, fetchImpl, store, existing);
  }
  existing.alreadyGenerated = true;
  return clientPayload(env, existing);
}

async function deliverEmail(env, fetchImpl, store, record) {
  const email = await sendReportEmail(env, fetchImpl, {
    to: record.customerEmail,
    record,
    link: reportLink(env, record.token),
  });
  record.email = email;
  await store.saveReport(record);
  return email;
}

async function createCheckoutReport(paid, input, deps) {
  const env = deps.env;
  const fetchImpl = deps.fetch;
  const store = requireStore(deps, env, fetchImpl);
  const score = await runThreeEngines(input, env, fetchImpl, deps);
  const view = buildView(score, { origin: 'checkout', change: null });
  const token = newToken();
  const record = {
    token,
    sessionId: paid.sessionId,
    subscriptionId: paid.subscriptionId || '',
    origin: 'checkout',
    productId: paid.product.id,
    productName: paid.product.name,
    customerEmail: paid.email,
    customerId: paid.customerId,
    business: {
      businessName: input.businessName,
      domain: input.domain,
      category: input.category,
      city: input.city,
    },
    fingerprint: businessFingerprint(input),
    createdAt: score.timestamp,
    view,
    email: { sent: false, reason: 'pending' },
  };
  await store.saveReport(record);
  await store.setSessionToken(paid.sessionId, token);
  await rememberSubscriber(store, paid, input, token, score.timestamp);
  await deliverEmail(env, fetchImpl, store, record);
  return record;
}

async function previewCheckout(sessionId, deps) {
  const env = deps.env;
  const fetchImpl = deps.fetch;
  const store = requireStore(deps, env, fetchImpl);
  const paid = await loadPaidCheckout(env, fetchImpl, sessionId);
  const token = await store.getSessionToken(paid.sessionId);
  const record = token ? await store.getReport(token) : null;
  return {
    ok: true,
    paid: true,
    generated: Boolean(record),
    email: paid.email,
    product: publicProduct(paid.product),
    ...(record ? clientPayload(env, record) : {}),
  };
}

async function generateCheckoutReport(sessionId, body, deps) {
  const env = deps.env;
  const fetchImpl = deps.fetch;
  const store = requireStore(deps, env, fetchImpl);
  let input;
  try {
    input = validateInput(body);
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw reportError('Enter a company name and category', 400);
  }
  if (!input.domain) throw reportError('Enter a website like example.com', 400);
  const paid = await loadPaidCheckout(env, fetchImpl, sessionId);

  const existingToken = await store.getSessionToken(paid.sessionId);
  if (existingToken) {
    const existing = await store.getReport(existingToken);
    if (existing) return finishExisting(env, fetchImpl, store, existing, input);
  }

  const locked = await store.lock(`session:${paid.sessionId}`, 180);
  if (!locked) throw reportError('A report for this payment is already being generated.', 409);
  try {
    const again = await store.getSessionToken(paid.sessionId);
    if (again) {
      const existing = await store.getReport(again);
      if (existing) return finishExisting(env, fetchImpl, store, existing, input);
    }
    const record = await createCheckoutReport(paid, input, deps);
    return clientPayload(env, record);
  } finally {
    await store.unlock(`session:${paid.sessionId}`);
  }
}

async function loadPrivateReport(token, deps) {
  const id = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(id)) return null;
  const store = requireStore(deps, deps.env, deps.fetch);
  return store.getReport(id);
}

async function runMonthlyReports(deps) {
  const env = deps.env;
  const fetchImpl = deps.fetch;
  const store = requireStore(deps, env, fetchImpl);
  const now = deps.now || Date.now;
  const started = now();
  const budget = Number(env.CRON_BUDGET_MS) > 0 ? Number(env.CRON_BUDGET_MS) : 65000;
  const ids = await store.listSubscriberIds();
  const subscribers = [];
  for (const id of ids) {
    const subscriber = await store.getSubscriber(id);
    if (subscriber) subscribers.push(subscriber);
  }
  subscribers.sort((a, b) => (Date.parse(a.lastReportAt || '') || 0) - (Date.parse(b.lastReportAt || '') || 0));
  const summary = { ok: true, due: 0, ran: 0, skipped: 0, stopped: 0, failed: 0 };
  let startedOne = false;
  for (const subscriber of subscribers) {
    if (subscriber.status !== 'active') {
      summary.skipped += 1;
      continue;
    }
    const last = Date.parse(subscriber.lastReportAt || '');
    if (Number.isFinite(last) && now() - last < MONTH_MS) {
      summary.skipped += 1;
      continue;
    }
    summary.due += 1;
    if (startedOne && now() - started + CHECK_RESERVE_MS > budget) break;
    startedOne = true;
    const locked = await store.lock(`sub:${subscriber.subscriptionId}`, 300);
    if (!locked) {
      summary.skipped += 1;
      continue;
    }
    try {
      let subscription;
      try {
        subscription = await loadSubscription(env, fetchImpl, subscriber.subscriptionId);
      } catch {
        summary.failed += 1;
        continue;
      }
      if (!subscriptionIsActive(subscription)) {
        if (subscriptionShouldStop(subscription)) {
          subscriber.status = 'inactive';
          subscriber.inactiveReason = subscription.status || 'inactive';
          subscriber.updatedAt = new Date(now()).toISOString();
          await store.saveSubscriber(subscriber);
          summary.stopped += 1;
        } else {
          summary.skipped += 1;
        }
        continue;
      }
      const input = subscriber.business;
      const score = await runThreeEngines(input, env, fetchImpl, deps);
      const tokens = Array.isArray(subscriber.reportTokens) ? subscriber.reportTokens : [];
      const previous = tokens.length ? await store.getReport(tokens[tokens.length - 1]) : null;
      const change = monthChange(previous && previous.view, score);
      const view = buildView(score, { origin: 'monthly', change });
      const token = newToken();
      const record = {
        token,
        sessionId: '',
        subscriptionId: subscriber.subscriptionId,
        origin: 'monthly',
        productId: subscriber.productId,
        productName: (PRODUCTS[subscriber.productId] || PRODUCTS.tracking).name,
        customerEmail: subscriber.email,
        customerId: subscriber.customerId,
        business: subscriber.business,
        fingerprint: subscriber.fingerprint,
        createdAt: score.timestamp,
        view,
        email: { sent: false, reason: 'pending' },
      };
      await store.saveReport(record);
      const nextTokens = tokens.slice();
      nextTokens.push(token);
      subscriber.reportTokens = nextTokens;
      subscriber.lastReportAt = score.timestamp;
      subscriber.updatedAt = score.timestamp;
      subscriber.status = 'active';
      await store.saveSubscriber(subscriber);
      await deliverEmail(env, fetchImpl, store, record);
      summary.ran += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(`monthly report failed: ${error && error.status ? error.status : 'error'}`);
    } finally {
      await store.unlock(`sub:${subscriber.subscriptionId}`);
    }
  }
  return summary;
}

function cronAuthorized(req, env) {
  const secret = String(env.CRON_SECRET || '').trim();
  if (!secret) return false;
  const headers = req.headers || {};
  const header = headers.authorization || headers.Authorization || '';
  return header === `Bearer ${secret}`;
}

function createReportHandler(deps = {}) {
  return async function reportHandler(req, res) {
    const env = deps.env || process.env;
    const fetchImpl = deps.fetch || globalThis.fetch;
    const local = { ...deps, env, fetch: fetchImpl };
    try {
      if (req.method === 'GET') {
        const url = new URL(req.url || '/', 'http://localhost');
        const sessionId = (req.query && req.query.session_id) || url.searchParams.get('session_id') || '';
        return sendJson(res, 200, await previewCheckout(sessionId, local));
      }
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Use POST.' });
      const body = readBody(req);
      const payload = await generateCheckoutReport(body.sessionId || body.session_id, body, local);
      return sendJson(res, 200, payload);
    } catch (error) {
      if (error instanceof SyntaxError) return sendJson(res, 400, { ok: false, error: 'Enter a company name and category' });
      const status = error.status || 500;
      if (status >= 500) console.error('paid report failed');
      return sendJson(res, status, {
        ...(error.payload || {}),
        ok: false,
        error: status >= 500 && !error.status ? 'The report could not be finished.' : error.message,
      });
    }
  };
}

function createPrivateReportHandler(deps = {}) {
  return async function privateHandler(req, res) {
    const env = deps.env || process.env;
    const fetchImpl = deps.fetch || globalThis.fetch;
    const url = new URL(req.url || '/', 'http://localhost');
    const token = (req.query && req.query.token) || url.searchParams.get('token') || '';
    try {
      const record = await loadPrivateReport(token, { ...deps, env, fetch: fetchImpl });
      if (!record) {
        return sendHtml(res, 404, renderReportDocument({ missing: true }));
      }
      return sendHtml(res, 200, renderReportDocument({ record, link: reportLink(env, record.token) }));
    } catch (error) {
      const status = error.status || 500;
      return sendHtml(res, status, renderReportDocument({
        missing: true,
        message: status === 503 ? 'Report storage is not connected.' : 'This report could not be opened.',
      }));
    }
  };
}

function createCronHandler(deps = {}) {
  return async function cronHandler(req, res) {
    const env = deps.env || process.env;
    const fetchImpl = deps.fetch || globalThis.fetch;
    if (req.method !== 'GET' && req.method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'Use GET.' });
    }
    if (!cronAuthorized(req, env)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    try {
      const summary = await runMonthlyReports({ ...deps, env, fetch: fetchImpl });
      return sendJson(res, 200, summary);
    } catch (error) {
      console.error('monthly reports failed');
      return sendJson(res, error.status || 500, { ok: false, error: error.message || 'The monthly job failed.' });
    }
  };
}

module.exports = {
  createReportHandler,
  createPrivateReportHandler,
  createCronHandler,
  previewCheckout,
  generateCheckoutReport,
  runMonthlyReports,
  runThreeEngines,
  clientPayload,
  reportLink,
  createPaidStore,
  createMemoryKv,
};
