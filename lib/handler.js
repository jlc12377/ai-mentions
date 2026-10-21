'use strict';

const {
  METHODOLOGY,
  FORMULA_VERSION,
  MENTION_WEIGHT,
  CITATION_WEIGHT,
  InputError,
  validateInput,
  buildPrompts,
  averageScores,
  collectCompetitors,
  summarize,
} = require('./score');
const { readConfig, runProviders } = require('./providers');
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

function unavailableBody(extra) {
  return {
    ok: false,
    unavailable: true,
    score: null,
    message: 'Score temporarily unavailable',
    ...extra,
  };
}

function publicProviders(providers) {
  return providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    model: provider.model,
    mode: provider.mode,
    ok: provider.ok,
    score: provider.score,
    error: provider.error,
    checks: provider.checks,
  }));
}

function createHandler(deps = {}) {
  const cache = deps.cache || sharedCache;
  const limiter = deps.limiter || sharedLimiter;

  return async function handler(req, res) {
    const env = deps.env || process.env;
    const fetchImpl = deps.fetch || globalThis.fetch;
    const config = readConfig(env);

    if (req.method !== 'POST') {
      return send(res, 405, unavailableBody({
        reason: 'method',
        detail: 'Use POST.',
      }));
    }

    let input;
    try {
      input = validateInput(readBody(req));
    } catch (error) {
      if (error instanceof SyntaxError) {
        return send(res, 400, unavailableBody({
          reason: 'validation',
          message: 'Enter a company name and category',
        }));
      }
      if (error instanceof InputError || error.status === 400) {
        return send(res, 400, unavailableBody({
          reason: 'validation',
          message: error.message,
        }));
      }
      console.error('score request failed');
      return send(res, 500, unavailableBody({ reason: 'error' }));
    }

    const prompts = buildPrompts(input.category, input.city, config.promptCount);
    const base = {
      businessName: input.businessName,
      domain: input.domain,
      category: input.category,
      city: input.city,
      prompts,
      formula: {
        version: FORMULA_VERSION,
        mentionWeight: MENTION_WEIGHT,
        citationWeight: CITATION_WEIGHT,
        description: METHODOLOGY,
      },
    };

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
        return send(res, 429, unavailableBody({
          ...base,
          reason: 'rate_limited',
          detail: 'Too many checks from this network. Try again later.',
          timestamp: new Date().toISOString(),
        }));
      }

      const key = cacheKey(input, config, prompts.length);
      const cached = await readCache(env, fetchImpl, cache, key);
      if (cached && cached.score != null) {
        return send(res, 200, {
          ...cached,
          businessName: input.businessName,
          cached: true,
          ok: true,
          unavailable: false,
        });
      }

      const { providers, skipped } = await runProviders(input, prompts, config, fetchImpl);
      const successful = providers.flatMap((provider) => provider.rawChecks.map((check) => ({
        ...check,
        ok: true,
      })));
      const timestamp = new Date().toISOString();
      const summary = summarize(successful);

      if (!providers.length) {
        return send(res, 503, unavailableBody({
          ...base,
          reason: 'no_providers',
          detail: 'The live check is not connected right now.',
          timestamp,
          providers: [],
          skipped,
          competitors: [],
          summary,
          cached: false,
        }));
      }

      if (!successful.length) {
        return send(res, 503, unavailableBody({
          ...base,
          reason: 'all_failed',
          detail: 'Every connected assistant failed or timed out.',
          timestamp,
          providers: publicProviders(providers),
          skipped,
          competitors: [],
          summary,
          cached: false,
        }));
      }

      const payload = {
        ...base,
        ok: true,
        unavailable: false,
        score: averageScores(successful.map((check) => check.score)),
        timestamp,
        cached: false,
        summary,
        providers: publicProviders(providers),
        skipped,
        competitors: collectCompetitors(successful, input.businessName, input.domain),
      };
      await writeCache(env, fetchImpl, cache, key, payload, config.cacheTtlSec);
      return send(res, 200, payload);
    } catch (error) {
      console.error('score request failed');
      return send(res, 500, unavailableBody({
        ...base,
        reason: 'error',
        timestamp: new Date().toISOString(),
      }));
    }
  };
}

module.exports = { createHandler, clientIp };
