'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createLocalServer, HOST } = require('../local-server');

function request(port, path, {host = `${HOST}:${port}`, method = 'GET'} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port, path, method, headers: { host } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end();
  });
}
test('serves only the bundled page on the expected host', async () => {
  const html = Buffer.from('<title>Material Chat</title>');
  // Pick a free port, then configure the handler for that actual port.
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, HOST, resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const server = createLocalServer(html, port);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, HOST, resolve); });
  try {
    const ok = await request(port, '/index.html');
    assert.equal(ok.status, 200); assert.equal(ok.text, html.toString());
    assert.equal(ok.headers['cache-control'], 'no-store');
    assert.equal((await request(port, '/etc/passwd')).status, 404);
    assert.equal((await request(port, '/index.html', { host: 'evil.example' })).status, 404);
    assert.equal((await request(port, '/index.html', { method: 'POST' })).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
