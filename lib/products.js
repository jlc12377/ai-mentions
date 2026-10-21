'use strict';

// Public Payment Links. The success URL for each one is
// https://ai-mentions.com/report?session_id={CHECKOUT_SESSION_ID}
const PRODUCTS = {
  report: {
    id: 'report',
    name: 'Full AI Visibility Report',
    priceLabel: '$150',
    cadence: 'one-time',
    minimum: '',
    amount: 15000,
    url: 'https://buy.stripe.com/cNieVeclZ8MrbkX15ld7q0u',
    recurring: false,
  },
  tracking: {
    id: 'tracking',
    name: 'AI Visibility Tracking',
    priceLabel: '$65/month',
    cadence: 'month',
    minimum: '3-month minimum',
    amount: 6500,
    url: 'https://buy.stripe.com/9B63cw71Fe6LfBd4hxd7q0v',
    recurring: true,
  },
  addon: {
    id: 'addon',
    name: 'Add-on tracking',
    priceLabel: '$49/month',
    cadence: 'month',
    minimum: '',
    amount: 4900,
    url: 'https://buy.stripe.com/6oU5kEclZgeT1Kng0fd7q0w',
    recurring: true,
    note: 'Sold with packages on other network sites.',
  },
};

const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{8,}$/;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function productList() {
  return [PRODUCTS.report, PRODUCTS.tracking, PRODUCTS.addon];
}

function publicProduct(product) {
  return {
    id: product.id,
    name: product.name,
    priceLabel: product.priceLabel,
    cadence: product.cadence,
    minimum: product.minimum || '',
    recurring: Boolean(product.recurring),
    note: product.note || '',
    url: product.url,
  };
}

function classifyPaidSession(session) {
  if (!session || typeof session !== 'object') {
    const error = new Error('This checkout is not paid.');
    error.status = 402;
    throw error;
  }
  if (session.status !== 'complete' || session.payment_status !== 'paid') {
    const error = new Error('This checkout is not paid.');
    error.status = 402;
    throw error;
  }
  const amount = Number(session.amount_total);
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : '';
  const recurring = session.mode === 'subscription' || Boolean(subscriptionId);
  let product = PRODUCTS.report;
  if (recurring) {
    if (!subscriptionId) {
      const error = new Error('This subscription checkout did not include a subscription.');
      error.status = 502;
      throw error;
    }
    product = amount === PRODUCTS.addon.amount ? PRODUCTS.addon : PRODUCTS.tracking;
  }
  const email = String(session.customer_details?.email || session.customer_email || '').trim();
  return {
    sessionId: String(session.id || ''),
    product,
    email,
    customerId: typeof session.customer === 'string' ? session.customer : '',
    subscriptionId,
    amount: Number.isFinite(amount) ? amount : null,
  };
}

module.exports = {
  PRODUCTS,
  SESSION_ID,
  MONTH_MS,
  productList,
  publicProduct,
  classifyPaidSession,
};
