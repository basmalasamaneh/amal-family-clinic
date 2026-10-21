// Test-only origin: production PWA files and the unmodified real Express API.
// No mock responses, fixture endpoints, or product transport changes.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import api from '../../artifacts/api-server/src/app';
const require = createRequire(resolve('artifacts/api-server/package.json'));
const express = require('express');
if (process.env.AMAL_OFFLINE_E2E !== '1' || process.env.NODE_ENV !== 'development')
  throw new Error('Offline E2E server is development-only');
const app = express();
app.use('/api', (req: any, res: any, next: any) => {
  req.url = `/api${req.url}`;
  api(req, res, next);
});
const root = resolve('artifacts/amal-network/dist/pwa-verification');
app.use(express.static(root, { etag: false, setHeaders: (res: any) => res.setHeader('Cache-Control', 'no-store') }));
app.get(/^\/(?:(?:desk|doctor|admin|work)\/[a-z-]+|login|data|ui-kit)?$/, (_req: any, res: any) => res.sendFile(resolve(root, 'index.html')));
app.listen(4189, '127.0.0.1', () => console.log('Offline E2E real API/PWA ready'));
