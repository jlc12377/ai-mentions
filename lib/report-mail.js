'use strict';

const { PRODUCTS } = require('./products');
const { joinAnd } = require('./free-score');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function reportEmail({ to, from, record, link }) {
  const business = record.business.businessName;
  const score = record.view.score == null ? 'unavailable' : `${record.view.score}/100`;
  const change = record.view.change && record.view.change.text ? record.view.change.text : '';
  const summary = record.view.summary || {};
  const named = summary.checks
    ? `Named in ${summary.mentions} of ${summary.checks} answers.`
    : 'The assistants that answered are in the full report.';
  const subject = `AI visibility report: ${business} — ${score}`;
  const text = [
    `${record.productName} for ${business}`,
    `Score: ${score}`,
    named,
    change,
    '',
    `Private report: ${link}`,
    'This link is unlisted. Anyone with it can open the report.',
  ].filter((line) => line !== '').join('\n');
  const html = [
    `<p><strong>${escapeHtml(record.productName)}</strong> for ${escapeHtml(business)}</p>`,
    `<p>Score: ${escapeHtml(score)}<br>${escapeHtml(named)}</p>`,
    change ? `<p>${escapeHtml(change)}</p>` : '',
    `<p><a href="${escapeHtml(link)}">Open the private report</a></p>`,
    '<p>This link is unlisted. Anyone with it can open the report.</p>',
  ].join('');
  return {
    from,
    to: [to],
    subject,
    text,
    html,
  };
}

function fromAddress(env) {
  let from = String((env && env.REPORT_FROM_EMAIL) || '').trim();
  if ((from.startsWith('"') && from.endsWith('"')) || (from.startsWith("'") && from.endsWith("'"))) {
    from = from.slice(1, -1).trim();
  }
  return from;
}

function freeScoreLines(score) {
  return (score.providers || []).map((provider) => {
    const label = provider.label || 'Assistant';
    if (!provider.answered) return `${label}: did not answer`;
    const verdict = provider.mentioned ? 'mentioned' : 'not mentioned';
    const names = (provider.recommends || []).slice(0, 3);
    const instead = names.length ? `\n${label} recommends ${joinAnd(names)}.` : '';
    return `${label}: ${verdict}${instead}`;
  });
}

function freeScoreEmail({ to, from, score }) {
  const business = score.businessName || 'Your business';
  const points = score.score == null ? 'unavailable' : `${score.score}/100`;
  const how = 'How we score: each answer is mostly whether you were named, plus whether your site was cited.';
  const method = 'https://www.ai-mentions.com/#methodology';
  const reportLine = 'Want to see more insights? Get the full report: every answer AI gave, the sources it trusts, and what to fix. $150';
  const trackingLine = 'Or track it monthly for $65/mo';
  const lines = freeScoreLines(score);
  const text = [
    `${business}: ${points}`,
    '',
    ...lines,
    '',
    how,
    method,
    '',
    reportLine,
    PRODUCTS.report.url,
    trackingLine,
    PRODUCTS.tracking.url,
  ].join('\n');
  const html = [
    `<p><strong>${escapeHtml(business)}</strong>: ${escapeHtml(points)}</p>`,
    lines.map((line) => `<p>${escapeHtml(line).replace(/\n/g, '<br>')}</p>`).join(''),
    `<p>${escapeHtml(how)} <a href="${method}">How we score</a></p>`,
    `<p><a href="${escapeHtml(PRODUCTS.report.url)}">${escapeHtml(reportLine)}</a></p>`,
    `<p><a href="${escapeHtml(PRODUCTS.tracking.url)}">${escapeHtml(trackingLine)}</a></p>`,
  ].join('');
  return {
    from,
    to: [to],
    subject: `Your AI visibility score: ${business} — ${points}`,
    text,
    html,
  };
}

async function postResend(env, fetchImpl, message) {
  const key = String(env.RESEND_API_KEY || '').trim();
  const from = fromAddress(env);
  if (!key || !from) return { sent: false, reason: 'not_configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...message, from }),
      signal: controller.signal,
    });
    let id = '';
    try {
      const text = typeof response.text === 'function' ? await response.text() : '';
      if (text) id = JSON.parse(text).id || '';
    } catch {
      id = '';
    }
    if (!response.ok) return { sent: false, reason: 'send_failed' };
    return { sent: true, reason: '', id };
  } catch {
    return { sent: false, reason: 'send_failed' };
  } finally {
    clearTimeout(timer);
  }
}

async function sendReportEmail(env, fetchImpl, { to, record, link }) {
  const from = fromAddress(env);
  if (!to) return { sent: false, reason: 'no_customer_email' };
  if (!String(env.RESEND_API_KEY || '').trim() || !from) return { sent: false, reason: 'not_configured' };
  const result = await postResend(env, fetchImpl, reportEmail({ to, from, record, link }));
  return { sent: result.sent, reason: result.reason };
}

async function sendFreeScoreEmail(env, fetchImpl, { to, score }) {
  const from = fromAddress(env);
  if (!to) return { sent: false, reason: 'no_customer_email' };
  if (!String(env.RESEND_API_KEY || '').trim() || !from) return { sent: false, reason: 'not_configured' };
  const result = await postResend(env, fetchImpl, freeScoreEmail({ to, from, score }));
  if (result.sent && result.id) console.log(`free score email ${result.id}`);
  return result;
}

module.exports = {
  reportEmail,
  freeScoreEmail,
  sendReportEmail,
  sendFreeScoreEmail,
  fromAddress,
};
