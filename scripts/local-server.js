'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createHandler } = require('../lib/handler');

const root = path.join(__dirname, '..');
const handler = createHandler();
const port = Number(process.env.PORT) || 3000;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/api/score') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    req.body = Buffer.concat(chunks).toString('utf8');
    return handler(req, res);
  }

  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
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
