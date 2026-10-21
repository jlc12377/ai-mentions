'use strict';

const SESSION_PREFIX = 'aim:paid:session:';
const REPORT_PREFIX = 'aim:paid:report:';
const SUB_PREFIX = 'aim:paid:sub:';
const SUB_INDEX = 'aim:paid:subs';
const LOCK_PREFIX = 'aim:paid:lock:';

function createMemoryKv() {
  const strings = new Map();
  const sets = new Map();
  return {
    async get(key) {
      return strings.has(key) ? strings.get(key) : null;
    },
    async set(key, value) {
      strings.set(key, String(value));
    },
    async del(key) {
      strings.delete(key);
    },
    async setIfAbsent(key, value, ttlSec) {
      if (strings.has(key)) return false;
      strings.set(key, String(value));
      void ttlSec;
      return true;
    },
    async sadd(key, member) {
      const set = sets.get(key) || new Set();
      set.add(String(member));
      sets.set(key, set);
    },
    async smembers(key) {
      return [...(sets.get(key) || [])];
    },
  };
}

function parseJson(value) {
  if (value == null || value === '') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function createPaidStore(kv) {
  return {
    async getReport(token) {
      return parseJson(await kv.get(REPORT_PREFIX + token));
    },
    async saveReport(report) {
      await kv.set(REPORT_PREFIX + report.token, JSON.stringify(report));
    },
    async getSessionToken(sessionId) {
      const value = await kv.get(SESSION_PREFIX + sessionId);
      return value || '';
    },
    async setSessionToken(sessionId, token) {
      await kv.set(SESSION_PREFIX + sessionId, token);
    },
    async getSubscriber(subscriptionId) {
      return parseJson(await kv.get(SUB_PREFIX + subscriptionId));
    },
    async saveSubscriber(subscriber) {
      await kv.set(SUB_PREFIX + subscriber.subscriptionId, JSON.stringify(subscriber));
      await kv.sadd(SUB_INDEX, subscriber.subscriptionId);
    },
    async listSubscriberIds() {
      return kv.smembers(SUB_INDEX);
    },
    async lock(name, ttlSec) {
      return kv.setIfAbsent(LOCK_PREFIX + name, '1', ttlSec);
    },
    async unlock(name) {
      await kv.del(LOCK_PREFIX + name);
    },
  };
}

function supabaseConfig(env) {
  const source = env || {};
  const url = String(source.SUPABASE_URL || source.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(source.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return { url, key };
}

function isSecretApiKey(key) {
  return key.startsWith('sb_secret_');
}

function storageError(status, data) {
  const code = data && data.code ? String(data.code) : '';
  const detail = data && data.message ? String(data.message) : '';
  if (status === 409 || code === '23505') {
    const error = new Error('conflict');
    error.status = 409;
    return error;
  }
  if (code === 'PGRST205' || code === '42P01' || /schema cache|does not exist/i.test(detail)) {
    const error = new Error('Report tables are missing. Run supabase/schema.sql in the Supabase SQL editor.');
    error.status = 503;
    return error;
  }
  const error = new Error('Report storage failed.');
  error.status = 503;
  return error;
}

async function rest(env, fetchImpl, method, path, { body, prefer } = {}) {
  const cfg = supabaseConfig(env);
  if (!cfg) {
    const error = new Error('Report storage is not connected.');
    error.status = 503;
    throw error;
  }
  if (cfg.key.startsWith('sb_publishable_')) {
    const error = new Error('Report storage needs the server secret key.');
    error.status = 503;
    throw error;
  }
  const headers = {
    apikey: cfg.key,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Prefer: prefer || 'return=representation',
    // A browser User-Agent makes Supabase reject an sb_secret_ key.
    'User-Agent': 'ai-mentions',
  };
  // sb_secret_ keys are not JWTs. The Data API reads them from apikey and
  // maps them to service_role. A bearer token of that key is rejected.
  if (!isSecretApiKey(cfg.key)) headers.Authorization = `Bearer ${cfg.key}`;
  const response = await fetchImpl(`${cfg.url}/rest/v1/${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = typeof response.text === 'function' ? await response.text() : '';
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!response.ok) throw storageError(response.status, data);
  return data;
}

function enc(value) {
  return encodeURIComponent(String(value));
}

function reportToRow(report) {
  return {
    token: report.token,
    session_id: report.sessionId || null,
    subscription_id: report.subscriptionId || null,
    origin: report.origin,
    product_id: report.productId,
    product_name: report.productName,
    customer_email: report.customerEmail || null,
    customer_id: report.customerId || null,
    business: report.business,
    fingerprint: report.fingerprint,
    view: report.view,
    email: report.email || {},
    created_at: report.createdAt,
  };
}

function rowToReport(row) {
  if (!row) return null;
  return {
    token: row.token,
    sessionId: row.session_id || '',
    subscriptionId: row.subscription_id || '',
    origin: row.origin,
    productId: row.product_id,
    productName: row.product_name,
    customerEmail: row.customer_email || '',
    customerId: row.customer_id || '',
    business: row.business,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    view: row.view,
    email: row.email || {},
  };
}

function rowToSubscriber(row, tokens) {
  return {
    subscriptionId: row.subscription_id,
    customerId: row.customer_id || '',
    email: row.email || '',
    productId: row.product_id,
    business: row.business,
    fingerprint: row.fingerprint || '',
    reportTokens: tokens,
    lastReportAt: row.last_report_at,
    status: row.status,
    inactiveReason: row.inactive_reason || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createSupabaseStore(env, fetchImpl) {
  async function rows(path) {
    const data = await rest(env, fetchImpl, 'GET', path);
    return Array.isArray(data) ? data : [];
  }

  async function upsert(table, conflict, body) {
    await rest(env, fetchImpl, 'POST', `${table}?on_conflict=${conflict}`, {
      body,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  return {
    async getReport(token) {
      const found = await rows(`reports?token=eq.${enc(token)}&select=*`);
      return rowToReport(found[0]);
    },
    async saveReport(report) {
      // History is written by saveSubscriber, after the subscribers row exists.
      // report_history.subscription_id references subscribers, so inserting it here
      // would fail on the first checkout for a new subscription.
      await upsert('reports', 'token', reportToRow(report));
    },
    async getSessionToken(sessionId) {
      const found = await rows(`checkout_sessions?session_id=eq.${enc(sessionId)}&select=token`);
      return found[0] && found[0].token ? found[0].token : '';
    },
    async setSessionToken(sessionId, token) {
      await upsert('checkout_sessions', 'session_id', { session_id: sessionId, token });
    },
    async getSubscriber(subscriptionId) {
      const found = await rows(`subscribers?subscription_id=eq.${enc(subscriptionId)}&select=*`);
      if (!found[0]) return null;
      const history = await rows(`report_history?subscription_id=eq.${enc(subscriptionId)}&select=token,created_at&order=created_at.asc`);
      return rowToSubscriber(found[0], history.map((row) => row.token));
    },
    async saveSubscriber(subscriber) {
      await upsert('subscribers', 'subscription_id', {
        subscription_id: subscriber.subscriptionId,
        customer_id: subscriber.customerId || null,
        email: subscriber.email || null,
        product_id: subscriber.productId,
        business: subscriber.business,
        fingerprint: subscriber.fingerprint || null,
        last_report_at: subscriber.lastReportAt || null,
        status: subscriber.status || 'active',
        inactive_reason: subscriber.inactiveReason || null,
        created_at: subscriber.createdAt,
        updated_at: subscriber.updatedAt || subscriber.createdAt,
      });
      for (const token of subscriber.reportTokens || []) {
        await upsert('report_history', 'subscription_id,token', {
          subscription_id: subscriber.subscriptionId,
          token,
        });
      }
    },
    async listSubscriberIds() {
      const found = await rows('subscribers?select=subscription_id');
      return found.map((row) => row.subscription_id);
    },
    async lock(name, ttlSec) {
      const nowIso = new Date().toISOString();
      await rest(env, fetchImpl, 'DELETE', `report_locks?name=eq.${enc(name)}&expires_at=lt.${enc(nowIso)}`, {
        prefer: 'return=minimal',
      });
      try {
        const inserted = await rest(env, fetchImpl, 'POST', 'report_locks', {
          body: { name, expires_at: new Date(Date.now() + ttlSec * 1000).toISOString() },
          prefer: 'return=representation',
        });
        return Array.isArray(inserted) ? inserted.length > 0 : Boolean(inserted);
      } catch (error) {
        if (error.status === 409) return false;
        throw error;
      }
    },
    async unlock(name) {
      await rest(env, fetchImpl, 'DELETE', `report_locks?name=eq.${enc(name)}`, { prefer: 'return=minimal' });
    },
  };
}

function storeForEnv(env, fetchImpl) {
  if (!supabaseConfig(env)) return null;
  return createSupabaseStore(env, fetchImpl);
}

module.exports = {
  supabaseConfig,
  createMemoryKv,
  createSupabaseStore,
  createPaidStore,
  storeForEnv,
};
