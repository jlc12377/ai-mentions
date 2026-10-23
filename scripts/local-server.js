'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createHandler } = require('../lib/handler');
const { createReportHandler, createPrivateReportHandler, createCronHandler } = require('../lib/report-service');

const root = path.join(__dirname, '..');
const handler = createHandler();
const reportHandler = createReportHandler();
const privateReportHandler = createPrivateReportHandler();
const cronHandler = createCronHandler();
const port = Number(process.env.PORT) || 3000;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === 'POST' && (url.pathname === '/api/score' || url.pathname === '/api/report' || url.pathname === '/api/cron/reports')) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    req.body = Buffer.concat(chunks).toString('utf8');
  }
  if (url.pathname === '/api/score') return handler(req, res);
  if (url.pathname === '/api/report') return reportHandler(req, res);
  if (url.pathname === '/api/cron/reports') return cronHandler(req, res);
  const privateReport = url.pathname.match(/^\/r\/([^/]+)$/);
  if (privateReport) {
    req.query = { token: privateReport[1] };
    return privateReportHandler(req, res);
  }

  const requested = url.pathname === '/report' ? '/report.html' : (url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.resolve(root, `.${path.normalize(requested)}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Type', types[path.extname(filePath)] || 'application/octet-stream');
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`AI Mentions listening on http://127.0.0.1:${port}`);
});
