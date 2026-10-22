'use strict';

const { collectCompetitors } = require('./score');

function joinAnd(names) {
  const list = (names || []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

function normalizeEmail(value) {
  const email = String(value || '').trim();
  if (email.length < 3 || email.length > 120) return '';
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return '';
  if (!email.slice(at + 1).includes('.')) return '';
  if (/[\s<>]/.test(email)) return '';
  return email;
}

function alreadyPublic(provider) {
  return Boolean(provider)
    && Array.isArray(provider.recommends)
    && !provider.rawChecks
    && !provider.checks;
}

function publicProvider(provider, businessName, domain) {
  if (alreadyPublic(provider)) {
    return {
      id: provider.id,
      label: provider.label,
      answered: Boolean(provider.answered),
      mentioned: Boolean(provider.answered && provider.mentioned),
      recommends: provider.recommends.slice(0, 3),
    };
  }
  const raw = Array.isArray(provider.rawChecks) ? provider.rawChecks : [];
  const answered = Boolean(provider.ok) && raw.length > 0;
  const recommends = answered
    ? collectCompetitors(raw, businessName, domain).slice(0, 3).map((row) => row.name)
    : [];
  return {
    id: provider.id,
    label: provider.label,
    answered,
    mentioned: answered && raw.some((check) => check.mentioned),
    recommends,
  };
}

function toPublicScore(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const out = {
    ok: source.score != null && source.ok !== false,
    unavailable: source.score == null,
    score: source.score == null ? null : source.score,
  };
  if (source.message) out.message = source.message;
  if (source.detail) out.detail = source.detail;
  if (source.reason) out.reason = source.reason;
  if (source.businessName) out.businessName = source.businessName;
  if (typeof source.domain === 'string') out.domain = source.domain;
  if (source.category) out.category = source.category;
  if (typeof source.city === 'string') out.city = source.city;
  if (source.timestamp) out.timestamp = source.timestamp;
  if (source.score != null && source.cached != null) out.cached = Boolean(source.cached);
  if (Array.isArray(source.providers)) {
    out.providers = source.providers.map((provider) => publicProvider(provider, source.businessName, source.domain));
  }
  if (Array.isArray(source.skipped)) {
    out.skipped = source.skipped.map((row) => ({
      id: row.id,
      label: row.label,
      reason: row.reason === 'no_api_key' ? 'no_api_key' : 'unavailable',
    }));
  }
  return out;
}

module.exports = {
  joinAnd,
  normalizeEmail,
  toPublicScore,
};
