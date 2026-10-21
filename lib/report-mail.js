'use strict';

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

async function sendReportEmail(env, fetchImpl, { to, record, link }) {
  const key = String(env.RESEND_API_KEY || '').trim();
  const from = fromAddress(env);
  if (!to) return { sent: false, reason: 'no_customer_email' };
  if (!key || !from) return { sent: false, reason: 'not_configured' };
  let response;
  try {
    response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(reportEmail({ to, from, record, link })),
    });
  } catch {
    return { sent: false, reason: 'send_failed' };
  }
  if (!response.ok) return { sent: false, reason: 'send_failed' };
  return { sent: true, reason: '' };
}

module.exports = { reportEmail, sendReportEmail, fromAddress };
