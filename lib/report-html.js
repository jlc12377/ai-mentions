'use strict';

const { safeHttpUrl } = require('./report-build');

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scoreClass(score) {
  if (score >= 70) return 'score-high';
  if (score >= 40) return 'score-mid';
  return 'score-low';
}

function engineBlock(provider) {
  const checks = provider.checks || [];
  const good = checks.filter((check) => check.ok);
  const mentions = good.filter((check) => check.mentioned).length;
  const citations = good.filter((check) => check.cited).length;
  const positions = good.map((check) => check.position).filter((position) => Number.isInteger(position) && position > 0);
  const best = positions.length ? Math.min(...positions) : null;
  const failed = checks.length - good.length;
  const head = provider.ok && provider.score != null ? `${provider.score}/100` : 'Failed';
  const lines = checks.map((check) => {
    if (!check.ok) return `<div class="check failed">Failed: ${esc(check.error || 'no answer')}</div>`;
    const bits = [
      check.mentioned ? 'Named' : 'Not named',
      check.position ? `list #${check.position}` : (check.mentioned ? 'no list rank' : ''),
      check.cited ? 'domain cited' : 'domain not cited',
      check.grounded === false ? 'answered without web search' : '',
      `${check.score}/100`,
    ].filter(Boolean);
    const excerpt = check.excerpt ? `<p class="excerpt">${esc(check.excerpt)}</p>` : '';
    return `<div class="check">${esc(bits.join(' · '))}</div>${excerpt}`;
  }).join('');
  const note = failed
    ? `<p class="note">${failed} of ${checks.length} questions failed and were left out of this score.</p>`
    : '';
  const rank = best ? `Best list rank #${best}. ` : '';
  const awareness = awarenessBlock(provider.awareness);
  return `<section class="engine"><div class="engine-head"><strong>${esc(provider.label)}</strong><span>${esc(provider.model || '')}</span><b>${esc(head)}</b></div><p>${esc(rank)}Named in ${mentions} of ${good.length} answers. Domain cited in ${citations}.</p>${awareness}${note}${lines}</section>`;
}

function awarenessBlock(awareness) {
  if (!awareness) return '';
  if (!awareness.ok) {
    return '<p class="note">The question about what this assistant knows did not return an answer.</p>';
  }
  const verdict = awareness.known ? 'Knows you: Yes' : 'Knows you: No';
  const excerpt = awareness.excerpt ? `<p class="excerpt">${esc(awareness.excerpt)}</p>` : '';
  return `<div class="check">${esc(verdict)}</div>${excerpt}`;
}

function renderReportDocument({ record, link, missing, message }) {
  const title = missing ? 'Report link' : `${record.view.businessName} — AI visibility report`;
  let body;
  if (missing) {
    body = `<h1>This report link is not valid</h1><p>${esc(message || 'The link may be incomplete. Open the full address from your email.')}</p>`;
  } else {
    const view = record.view;
    const when = view.timestamp ? new Date(view.timestamp).toUTCString() : '';
    const change = view.change && view.change.text ? `<p class="change">${esc(view.change.text)}</p>` : '';
    const engines = (view.providers || []).map(engineBlock).join('');
    const competitors = (view.competitors || []).length
      ? `<ul>${view.competitors.map((row) => `<li><span>${esc(row.name)}</span><span>${esc(row.mentions)}</span></li>`).join('')}</ul>`
      : '<p>No other companies were named in the lists these assistants returned.</p>';
    const sources = (view.sources || []).length
      ? `<ul class="sources">${view.sources.map((source) => {
        const url = safeHttpUrl(source.url);
        if (!url) return '';
        return `<li><a href="${esc(url)}">${esc(url)}</a>${source.own ? ' <span>your domain</span>' : ''}</li>`;
      }).join('')}</ul>`
      : '<p>No source URLs came back with these answers.</p>';
    const recommendations = (view.recommendations || []).map((item) => `<li><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></li>`).join('');
    const prompts = (view.prompts || []).map((prompt) => `<li>${esc(prompt)}</li>`).join('');
    const summary = view.summary || {};
    const named = summary.checks ? `Named in ${summary.mentions} of ${summary.checks} answers.` : '';
    body = `
      <p class="kicker">${esc(record.productName)}${record.origin === 'monthly' ? ' · monthly check' : ''}</p>
      <div class="top"><div><h1>${esc(view.businessName)}</h1><p class="meta">${esc([view.category, view.city, view.domain].filter(Boolean).join(' · '))}<br>${esc(when)}</p></div><div class="badge ${scoreClass(view.score)}">${esc(view.score)}/100</div></div>
      ${change}
      <p>${esc(named)} ${view.domain ? `Citation matching used ${esc(view.domain)}.` : ''}</p>
      <p class="private">Private link: <a href="${esc(link)}">${esc(link)}</a></p>
      <h2>By assistant</h2>
      ${engines}
      <h2>Competitors recommended instead</h2>
      ${competitors}
      <h2>Sources cited</h2>
      ${sources}
      <h2>What to do next</h2>
      <ol class="recs">${recommendations}</ol>
      <h2>What we asked</h2>
      <ol>${prompts}</ol>
      <h2>How the score was calculated</h2>
      <p>${esc(view.formula && view.formula.description ? view.formula.description : '')}</p>`;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,600&display=swap" rel="stylesheet">
<style>
:root{--violet:#7c3aed;--ink:#09090b;--ink-2:#3f3f46;--ink-3:#71717a;--border:#e4e4e7}
*{box-sizing:border-box}body{margin:0;background:#09090b;color:#fff;font-family:'Space Grotesk',sans-serif;line-height:1.55}
.wrap{max-width:760px;margin:0 auto;padding:28px 20px 64px}
a{color:var(--violet)}
.card{background:#fff;color:var(--ink);border-radius:20px;padding:28px 24px}
h1{font-family:Newsreader,Georgia,serif;font-weight:600;font-size:32px;margin:0}
h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin:28px 0 8px}
p{margin:8px 0;color:var(--ink-2);font-size:14px}
.kicker{color:var(--violet);font-weight:600;font-size:13px;margin-top:0}
.top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.meta{color:var(--ink-3);font-size:13px}
.badge{padding:6px 14px;border-radius:20px;font-weight:700;font-size:14px;white-space:nowrap}
.score-high{background:#dcfce7;color:#166534}.score-mid{background:#fef3c7;color:#92400e}.score-low{background:#fee2e2;color:#991b1b}
.change{background:#f5f3ff;border-radius:8px;padding:12px 14px;color:#5b21b6}
.private{word-break:break-all;font-size:13px}
.engine{border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin:10px 0}
.engine-head{display:flex;gap:8px;justify-content:space-between;align-items:baseline}
.engine-head span{color:var(--ink-3);font-size:12px}
.check{font-size:13px;padding:6px 0;border-bottom:1px solid #f4f4f5}
.check.failed,.note{color:#92400e}
.excerpt{font-size:12px;color:var(--ink-3)}
ul,ol{margin:8px 0 0 18px;padding:0}li{margin:6px 0;font-size:14px;color:var(--ink-2)}
.sources{list-style:none;margin-left:0} .sources li{word-break:break-all}
.recs p{margin:2px 0 0}
.nav{margin-bottom:18px}.nav a{color:#fff;text-decoration:none;font-weight:600}
</style>
</head>
<body>
<div class="wrap">
<p class="nav"><a href="/">AI Mentions</a></p>
<div class="card">${body}</div>
</div>
</body>
</html>`;
}

module.exports = { renderReportDocument };
