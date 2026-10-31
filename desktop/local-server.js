'use strict';
const http = require('node:http');
const HOST = '127.0.0.1';
const PORT = 45382;

function createLocalServer(html, port = PORT) {
  return http.createServer((request, response) => {
    let path;
    try { path = new URL(request.url, `http://${HOST}:${port}`).pathname; }
    catch (_) { response.writeHead(400).end(); return; }
    // Only one bundled static document; never use the request as a filesystem path.
    if (request.method !== 'GET' || request.headers.host !== `${HOST}:${port}` ||
        (path !== '/' && path !== '/index.html')) {
      response.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
    });
    response.end(html);
  });
}
module.exports = { createLocalServer, HOST, PORT };
