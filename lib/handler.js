'use strict';

const {
  InputError,
  validateInput,
  buildPrompts,
  scoreVisibility,
  summarize,
} = require('./score');
const { readConfig, runProviders } = require('./providers');
const { toPublicScore, normalizeEmail } = require('./free-score');
const { sendFreeScoreEmail } = require('./report-mail');
const { buildFreeScoreLead, saveFreeScoreLead } = require('./free-leads');
const {
  cacheKey,
  readCache,
  writeCache,
  takeRateLimit,
  sharedCache,
  sharedLimiter,
} = require('./store');

function clientIp(req) {
  const headers = req.headers || {};
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  let ip = '';
  if (typeof forwarded === 'string' && forwarded.trim()) ip = forwarded.split(',')[0].trim();
  else if (Array.isArray(forwarded) && forwarded.length) ip = String(forwarded[0]).split(',')[0].trim();
  else ip = headers['x-real-ip'] || headers['X-Real-Ip'] || req.socket?.remoteAddress || 'unknown';
  ip = String(ip).replace(/[^a-zA-Z0-9:.\-]/g, '').slice(0, 64);
  return ip || 'unknown';
}

function readBody(req) {
  const body = req.body;
  if (body == null || body === '') return {};
  if (typeof body === 'string') return JSON.parse(body);
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString('utf8'));
  if (typeof body === 'object') return body;
  return {};
}

function send(res, status, payload) {
  const json = JSON.stringify(payload);
  res.statusCode = status;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(json);
}

function unavailable(extra) {
  return {
    ok: false,
    unavailable: true,
    score: null,
    message: 'Score temporarily unavailable',
    ...extra,
  };
}

function createHandler(deps = {}) {
  const cache = deps.cache || sharedCache;
  const limiter = deps.limiter || sharedLimiter;

  return async function handler(req, res) {
    const env = deps.env || process.env;
    const fetchImpl = deps.fetch || globalThis.fetch;
    const config = readConfig(env);

    if (req.method !== 'POST') {
      return send(res, 405, toPublicScore(unavailable({
        reason: 'method',
        detail: 'Use POST.',
      })));
    }

    let raw = {};
    let input;
    try {
      raw = readBody(req);
      input = validateInput(raw);
    } catch (error) {
      let payload;
      if (error instanceof SyntaxError) {
        payload = toPublicScore(unavailable({
          reason: 'validation',
          message: 'Enter a company name and category',
        }));
      } else if (error instanceof InputError || error.status === 400) {
        payload = toPublicScore(unavailable({
          reason: 'validation',
          message: error.message,
        }));
      } else {
        console.error('score request failed');
        payload = toPublicScore(unavailable({ reason: 'error' }));
      }
      const status = payload.reason === 'error' ? 500 : 400;
      await saveFreeScoreLead(env, fetchImpl, buildFreeScoreLead(raw, payload));
      return send(res, status, payload);
    }

    const email = normalizeEmail(raw && raw.email);
    const prompts = buildPrompts(input.category, input.city, config.promptCount);
    const identity = {
      businessName: input.businessName,
      domain: input.domain,
      category: input.category,
      categoryKey: input.categoryKey,
      city: input.city,
    };

    async function finish(status, payload, { store = false } = {}) {
      const pub = toPublicScore(payload);
      if (store && pub.score != null) {
        await writeCache(env, fetchImpl, cache, cacheKey(input, config, prompts.length), pub, config.cacheTtlSec);
      }
      const withEmail = await attachEmail(pub);
      await saveFreeScoreLead(env, fetchImpl, buildFreeScoreLead(raw, withEmail));
      return send(res, status, withEmail);
    }

    async function attachEmail(payload) {
      if (!email || payload.score == null) return payload;
      try {
        const sent = await sendFreeScoreEmail(env, fetchImpl, { to: email, score: payload });
        const next = { ...payload, emailSent: Boolean(sent.sent) };
        if (sent.id) next.emailId = sent.id;
        if (!sent.sent) next.emailReason = sent.reason || 'send_failed';
        return next;
      } catch {
        console.error('free score email failed');
        return { ...payload, emailSent: false, emailReason: 'send_failed' };
      }
    }

    try {
      const limit = await takeRateLimit(
        env,
        fetchImpl,
        limiter,
        clientIp(req),
        config.rateLimitMax,
        config.rateLimitWindowSec,
      );
      if (typeof res.setHeader === 'function') {
        res.setHeader('X-RateLimit-Limit', String(config.rateLimitMax));
        res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
      }
      if (!limit.allowed) {
        return finish(429, unavailable({
          ...identity,
          reason: 'rate_limited',
          detail: 'Too many checks from this network. Try again later.',
          timestamp: new Date().toISOString(),
        }));
      }

      const key = cacheKey(input, config, prompts.length);
      const cached = await readCache(env, fetchImpl, cache, key);
      if (cached && cached.score != null) {
        return finish(200, {
          ...cached,
          ...identity,
          cached: true,
          ok: true,
          unavailable: false,
        });
      }

      const { providers, skipped } = await runProviders(input, prompts, config, fetchImpl, {
        sleep: deps.sleep,
        now: deps.now,
      });
      const successful = providers.flatMap((provider) => provider.rawChecks.map((check) => ({
        ...check,
        ok: true,
      })));
      const timestamp = new Date().toISOString();

      if (!providers.length) {
        return finish(503, unavailable({
          ...identity,
          reason: 'no_providers',
          detail: 'The live check is not connected right now.',
          timestamp,
          providers: [],
          skipped,
        }));
      }

      if (!successful.length) {
        return finish(503, unavailable({
          ...identity,
          reason: 'all_failed',
          detail: 'Every connected assistant failed or timed out.',
          timestamp,
          providers,
          skipped,
        }));
      }

      return finish(200, {
        ...identity,
        ok: true,
        unavailable: false,
        score: scoreVisibility(successful.map((check) => check.score), providers.map((provider) => provider.awareness)),
        timestamp,
        cached: false,
        providers,
        skipped,
        summary: summarize(successful),
      }, { store: true });
    } catch (error) {
      console.error('score request failed');
      return finish(500, unavailable({
        ...identity,
        reason: 'error',
        timestamp: new Date().toISOString(),
      }));
    }
  };
}

function clipText(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function scoreFromClient(body) {
  const source = body && typeof body === 'object' ? body : {};
  const numeric = Number(source.score);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null;
  const businessName = clipText(source.businessName, 80);
  const category = clipText(source.category, 80);
  if (businessName.length < 2 || category.length < 2) return null;
  const providers = (Array.isArray(source.providers) ? source.providers : []).slice(0, 6).map((provider) => {
    const row = provider && typeof provider === 'object' ? provider : {};
    return {
      id: clipText(row.id, 40),
      label: clipText(row.label, 40) || 'Assistant',
      answered: Boolean(row.answered),
      known: Boolean(row.known),
      mentioned: Boolean(row.mentioned),
      recommends: (Array.isArray(row.recommends) ? row.recommends : [])
        .slice(0, 3)
        .map((name) => clipText(name, 80))
        .filter(Boolean),
    };
  });
  const timestamp = /^\d{4}-\d{2}-\d{2}T/.test(String(source.timestamp || ''))
    ? String(source.timestamp).slice(0, 40)
    : new Date().toISOString();
  return {
    ok: true,
    unavailable: false,
    score: Math.round(numeric),
    businessName,
    domain: clipText(source.domain, 253),
    category,
    city: clipText(source.city, 80),
    timestamp,
    providers,
  };
}

function createScoreEmailHandler(deps = {}) {
  const limiter = deps.limiter || sharedLimiter;

  return async function scoreEmailHandler(req, res) {
    const env = deps.env || process.env;
    const fetchImpl = deps.fetch || globalThis.fetch;
    const config = readConfig(env);

    if (req.method !== 'POST') {
      return send(res, 405, { ok: false, emailSent: false, emailReason: 'method' });
    }

    let raw = {};
    try {
      raw = readBody(req);
    } catch {
      return send(res, 400, { ok: false, emailSent: false, emailReason: 'validation' });
    }

    const email = normalizeEmail(raw && raw.email);
    if (!email) return send(res, 400, { ok: false, emailSent: false, emailReason: 'invalid_email' });
    const score = scoreFromClient(raw);
    if (!score) return send(res, 400, { ok: false, emailSent: false, emailReason: 'invalid_score' });

    const limit = await takeRateLimit(
      env,
      fetchImpl,
      limiter,
      clientIp(req),
      config.rateLimitMax,
      config.rateLimitWindowSec,
    );
    if (typeof res.setHeader === 'function') {
      res.setHeader('X-RateLimit-Limit', String(config.rateLimitMax));
      res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
    }
    if (!limit.allowed) {
      return send(res, 429, { ok: false, emailSent: false, emailReason: 'rate_limited' });
    }

    let result = { sent: false, reason: 'send_failed' };
    try {
      result = await sendFreeScoreEmail(env, fetchImpl, { to: email, score });
    } catch {
      console.error('free score email failed');
      result = { sent: false, reason: 'send_failed' };
    }
    const payload = {
      ...score,
      emailSent: Boolean(result.sent),
      emailReason: result.sent ? '' : (result.reason || 'send_failed'),
    };
    if (result.id) payload.emailId = result.id;
    await saveFreeScoreLead(env, fetchImpl, buildFreeScoreLead({ ...raw, email }, payload));
    return send(res, 200, {
      ok: true,
      emailSent: payload.emailSent,
      emailReason: payload.emailReason,
      ...(payload.emailId ? { emailId: payload.emailId } : {}),
    });
  };
}

module.exports = { createHandler, createScoreEmailHandler, clientIp };
