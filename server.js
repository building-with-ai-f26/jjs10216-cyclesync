// Local development server. Only used on your laptop.
// It does two jobs:
//   1. Serves the files in public/ (the screens).
//   2. Sends requests for /api/<name> to the matching file in api/.
// On Vercel, this file isn't used: Vercel serves public/ and runs api/ files itself.

import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1'; // Only reachable from this laptop, not the rest of the Wi-Fi network.
const ROOT = import.meta.dirname;
const PUBLIC_DIR = join(ROOT, 'public');
const MAX_BODY_BYTES = 100_000;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(res, url.pathname);
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong on the server.' });
  }
}).listen(PORT, HOST, () => {
  console.log(`CycleSync is running at http://localhost:${PORT}`);
});

// /api/onboarding -> api/onboarding.js, calling its GET or POST function.
async function handleApi(req, res, url) {
  const name = url.pathname.slice('/api/'.length);
  if (!/^[a-z-]+$/.test(name)) return sendJson(res, 404, { error: 'Not found' });

  const file = join(ROOT, 'api', `${name}.js`);
  try {
    await access(file);
  } catch {
    return sendJson(res, 404, { error: 'Not found' });
  }

  const handlers = await import(file);
  const handler = handlers[req.method];
  if (typeof handler !== 'function') return sendJson(res, 405, { error: 'Method not allowed' });

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const body = hasBody ? await readBody(req) : undefined;
  const request = new Request(url, {
    method: req.method,
    headers: { 'content-type': req.headers['content-type'] || '' },
    body,
  });

  const response = await handler(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1);
  const file = normalize(join(PUBLIC_DIR, relative));
  // Refuse anything that tries to reach outside public/.
  if (!file.startsWith(PUBLIC_DIR + sep)) return sendText(res, 404, 'Not found');

  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}
