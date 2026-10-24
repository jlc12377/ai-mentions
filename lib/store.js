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

function cacheKey(input, config, promptCount) {
  const models = {};
  if (config.openaiKey) models.openai = config.openaiModel;
  if (config.perplexityKey) models.perplexity = config.perplexityModel;
  if (config.geminiKey) models.gemini = config.geminiModel;
  if (config.anthropicKey) models.anthropic = config.anthropicModel;
  const payload = {
    formula: FORMULA_VERSION,
    promptSet: 1,
    // Awareness prompt shipped with formula 2. Bump this when known/recommended
    // identification changes so a cached false positive is not reused.
    awareness: 3,
    promptCount,
    name: normalizeName(input.businessName),
    domain: input.domain,
    category: input.category.toLowerCase(),
    city: input.city.toLowerCase(),
    models,
  };
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  // v3 busts entries cached before the awareness score. Formula version is
  // also inside the hash, so a formula change misses old results either way.
  return `aim:score:v3:${hash}`;
}

async function readCache(env, fetchImpl, cache, key) {
  return cache.get(key);
}

async function writeCache(env, fetchImpl, cache, key, value, ttlSec) {
  cache.set(key, value, ttlSec * 1000);
}

async function takeRateLimit(env, fetchImpl, limiter, ip, max, windowSec) {
  const result = limiter.hit(ip, max, windowSec * 1000);
  return { ...result, backend: 'memory' };
}

const sharedCache = createMemoryCache();
const sharedLimiter = createMemoryLimiter();

module.exports = {
  createMemoryCache,
  createMemoryLimiter,
  cacheKey,
  readCache,
  writeCache,
  takeRateLimit,
  sharedCache,
  sharedLimiter,
};
