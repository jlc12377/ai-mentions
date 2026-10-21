'use strict';

const { SESSION_ID, classifyPaidSession } = require('./products');

function billingError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertSessionId(sessionId) {
  const id = String(sessionId || '').trim();
  if (!SESSION_ID.test(id)) throw billingError('This checkout link is missing a valid session.', 400);
  return id;
}

async function stripeGet(env, fetchImpl, path) {
  const key = String(env.STRIPE_RESTRICTED_KEY || '').trim();
  if (!key) throw billingError('Payment verification is not connected.', 503);
  let response;
  try {
    response = await fetchImpl(`https://api.stripe.com${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch {
    throw billingError('Payment verification failed.', 502);
  }
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!response.ok) {
    if (response.status === 404) throw billingError('We could not find that checkout.', 404);
    throw billingError('Payment verification failed.', 502);
  }
  return data;
}

async function loadPaidCheckout(env, fetchImpl, sessionId) {
  const id = assertSessionId(sessionId);
  const session = await stripeGet(env, fetchImpl, `/v1/checkout/sessions/${encodeURIComponent(id)}`);
  const paid = classifyPaidSession(session);
  if (paid.sessionId && paid.sessionId !== id) throw billingError('Payment verification failed.', 502);
  paid.sessionId = id;
  return paid;
}

async function loadSubscription(env, fetchImpl, subscriptionId) {
  const id = String(subscriptionId || '').trim();
  if (!/^sub_[A-Za-z0-9]+$/.test(id)) throw billingError('This subscription could not be checked.', 502);
  return stripeGet(env, fetchImpl, `/v1/subscriptions/${encodeURIComponent(id)}`);
}

function subscriptionIsActive(subscription) {
  return subscription && subscription.status === 'active';
}

function subscriptionShouldStop(subscription) {
  const status = subscription && subscription.status;
  return status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired' || status === 'paused';
}

module.exports = {
  assertSessionId,
  loadPaidCheckout,
  loadSubscription,
  subscriptionIsActive,
  subscriptionShouldStop,
};
