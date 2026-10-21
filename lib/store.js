'use strict';

const crypto = require('crypto');
const { FORMULA_VERSION, normalizeName } = require('./score');

function createMemoryCache() {
  const map = new Map();
  return {
    get(key, now = Date.now()) {
      const row = map.get(key);
      if (!row) return null;
      if (row.expires <= now) {
        map.delete(key);
        return null;
      }
      return row.value;
    },
    set(key, value, ttlMs, now = Date.now()) {
      if (map.size >= 200 && !map.has(key)) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
      map.set(key, { value, expires: now + ttlMs });
    },
  };
}

function createMemoryLimiter() {
  const hits = new Map();
  return {
    hit(ip, max, windowMs, now = Date.now()) {
      const fresh = (hits.get(ip) || []).filter((stamp) => now - stamp < windowMs);
      if (fresh.length >= max) {
        hits.set(ip, fresh);
        return { allowed: false, remaining: 0 };
      }
      fresh.push(now);
      if (hits.size >= 5000 && !hits.has(ip)) {
        const oldest = hits.keys().next().value;
        hits.delete(oldest);
      }
      hits.set(ip, fresh);
      return { allowed: true, remaining: max - fresh.length };
    },
  };
}

function kvConfig(env) {
  const url = String(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
  const token = String(env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '');
  if (!url || !token) return null;
  return { url, token };
}

async function kvCommand(env, fetchImpl, command) {
  const cfg = kvConfig(env);
  if (!cfg) return { configured: false, result: null };
  const response = await fetchImpl(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`kv HTTP ${response.status}`);
  const data = await response.json();
  return { configured: true, result: data.result };
}

function cacheKey(input, config, promptCount) {
  const models = {};
  if (config.openaiKey) models.openai = config.openaiModel;
  if (config.perplexityKey) models.perplexity = config.perplexityModel;
  if (config.geminiKey) models.gemini = config.geminiModel;
  if (config.anthropicKey) models.anthropic = config.anthropicModel;
  const payload = {
    formula: FORMULA_VERSION,
    promptSet: 1,
    promptCount,
    name: normalizeName(input.businessName),
    domain: input.domain,
    category: input.category.toLowerCase(),
    city: input.city.toLowerCase(),
    models,
  };
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `aim:score:v1:${hash}`;
}

async function readCache(env, fetchImpl, cache, key) {
  const local = cache.get(key);
  if (local) return local;
  try {
    const got = await kvCommand(env, fetchImpl, ['GET', key]);
    if (!got.configured || got.result == null || got.result === '') return null;
    const value = JSON.parse(got.result);
    cache.set(key, value, 60 * 60 * 1000);
    return value;
  } catch {
    return null;
  }
}

async function writeCache(env, fetchImpl, cache, key, value, ttlSec) {
  cache.set(key, value, ttlSec * 1000);
  try {
    if (!kvConfig(env)) return;
    await kvCommand(env, fetchImpl, ['SET', key, JSON.stringify(value), 'EX', ttlSec]);
  } catch {
    // The in-memory copy still serves this instance.
  }
}

async function takeRateLimit(env, fetchImpl, limiter, ip, max, windowSec) {
  if (kvConfig(env)) {
    try {
      const bucket = Math.floor(Date.now() / 1000 / windowSec);
      const key = `aim:rl:v1:${ip}:${bucket}`;
      const incr = await kvCommand(env, fetchImpl, ['INCR', key]);
      const count = Number(incr.result) || 0;
      if (count === 1) await kvCommand(env, fetchImpl, ['EXPIRE', key, windowSec]);
      return {
        allowed: count <= max,
        remaining: Math.max(0, max - count),
        backend: 'kv',
      };
    } catch {
      // Fall back to this instance if KV is unreachable.
    }
  }
  const result = limiter.hit(ip, max, windowSec * 1000);
  return { ...result, backend: 'memory' };
}

const sharedCache = createMemoryCache();
const sharedLimiter = createMemoryLimiter();

module.exports = {
  createMemoryCache,
  createMemoryLimiter,
  kvConfig,
  cacheKey,
  readCache,
  writeCache,
  takeRateLimit,
  sharedCache,
  sharedLimiter,
};
