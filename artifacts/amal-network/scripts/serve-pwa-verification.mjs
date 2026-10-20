import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This isolated public-shell fixture deliberately has no backend, sessions or private data.
const root = fileURLToPath(new URL('../dist/pwa-verification/', import.meta.url));
const base = '/pwa-check/';
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  try {
    const url = new URL(req.url, 'http://127.0.0.1:4178');
    // Explicit anonymous session fixture, so online login controls can be verified.
    // Other API requests still fail; nothing simulates authenticated operational data.
    if (url.pathname === '/api/me') {
      res.writeHead(401, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ code: 'UNAUTHORIZED', messageKey: 'error.unauthorized', params: {} }));
      return;
    }
    if (/(?:^|\/)(?:api|auth)(?:\/|$)/.test(url.pathname)) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'Public-shell verification origin has no API.' }));
      return;
    }
    if (!url.pathname.startsWith(base)) { res.writeHead(404).end(); return; }
    const relative = decodeURIComponent(url.pathname.slice(base.length));
    if (relative.split('/').some((part) => part.startsWith('.'))) { res.writeHead(404).end(); return; }
    let file = path.resolve(root, relative);
    if (file !== path.resolve(root) && !file.startsWith(root)) { res.writeHead(404).end(); return; }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      const document = /^(?:|login|data|ui-kit|(?:desk|doctor|admin)\/[a-z-]+)\/?$/.test(relative);
      if (!document || !req.headers.accept?.includes('text/html')) { res.writeHead(404).end(); return; }
      file = path.join(root, 'index.html');
    }
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch {
    res.writeHead(500).end('PWA verification server could not serve the build.');
  }
}).listen(4178, '127.0.0.1', () => {
  console.info('Isolated PWA verification: http://127.0.0.1:4178/pwa-check/');
});
