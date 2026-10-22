'use strict';

const { supabaseConfig } = require('./paid-store');
const { normalizeEmail } = require('./free-score');

function clip(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

function blank(value, max) {
  const text = clip(value, max);
  return text || null;
}

function readAttribution(body) {
  const source = body && typeof body === 'object' ? body : {};
  return {
    utm_source: blank(source.utm_source || source.utmSource, 120),
    utm_campaign: blank(source.utm_campaign || source.utmCampaign, 120),
    gclid: blank(source.gclid, 200),
  };
}

function leadProviders(providers) {
  return (Array.isArray(providers) ? providers : []).slice(0, 8).map((provider) => {
    const names = Array.isArray(provider.recommends) ? provider.recommends : [];
    return {
      id: clip(provider.id, 40),
      label: clip(provider.label, 40),
      answered: Boolean(provider.answered),
      known: Boolean(provider.known),
      mentioned: Boolean(provider.mentioned),
      recommends: names.slice(0, 3).map((name) => clip(name, 60)).filter(Boolean),
    };
  });
}

function leadScore(value) {
  if (value == null || value === '') return null;
  const score = Number(value);
  if (!Number.isInteger(score) || score < 0 || score > 100) return null;
  return score;
}

function buildFreeScoreLead(body, payload) {
  const email = normalizeEmail(body && body.email);
  if (!email) return null;
  const result = payload && typeof payload === 'object' ? payload : {};
  const source = body && typeof body === 'object' ? body : {};
  const created = typeof result.timestamp === 'string' && result.timestamp ? result.timestamp : new Date().toISOString();
  return {
    email,
    business_name: blank(result.businessName || source.businessName || source.company || source.name, 80),
    domain: blank(result.domain, 253),
    category: blank(result.category || source.category, 80),
    city: blank(result.city || source.city, 80),
    score: leadScore(result.score),
    providers: leadProviders(result.providers),
    ...readAttribution(source),
    email_sent: Boolean(result.emailSent),
    created_at: created,
  };
}

function secretKey(key) {
  return String(key || '').startsWith('sb_secret_');
}

async function saveFreeScoreLead(env, fetchImpl, row) {
  if (!row || !row.email) return { saved: false, reason: 'no_email' };
  const cfg = supabaseConfig(env);
  if (!cfg || String(cfg.key).startsWith('sb_publishable_')) {
    return { saved: false, reason: 'not_configured' };
  }
  const headers = {
    apikey: cfg.key,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Prefer: 'return=minimal',
    'User-Agent': 'ai-mentions',
  };
  if (!secretKey(cfg.key)) headers.Authorization = `Bearer ${cfg.key}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(`${cfg.url}/rest/v1/free_scores`, {
      method: 'POST',
      headers,
      body: JSON.stringify(row),
      signal: controller.signal,
    });
    if (!response || response.ok === false) return { saved: false, reason: 'insert_failed' };
    return { saved: true, reason: '' };
  } catch {
    return { saved: false, reason: 'insert_failed' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  buildFreeScoreLead,
  saveFreeScoreLead,
  readAttribution,
};
