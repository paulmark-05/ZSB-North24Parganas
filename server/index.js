require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { initStore } = require('./store');
const apiRouter = require('./routes/api');
const { ensureSeed } = require('./seed');

const app = express();
const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Render, Vercel and most hosts sit the app behind a reverse proxy — trust its
// X-Forwarded-For so express-rate-limit sees the real client IP.
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Static frontend + uploaded media
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// API
app.use('/api', apiRouter);

// Friendly routes
app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// 404 for unknown API endpoints (JSON, never HTML)
app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'Endpoint not found.' }));

// SPA-ish fallback for everything else -> public page
app.use((_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// Central error handler — always JSON for /api
app.use((err, req, res, _next) => {
  console.error('[error]', err.message);
  const status = err.status || 500;
  if (req.path.startsWith('/api')) {
    return res.status(status).json({ ok: false, error: err.message || 'Internal server error.' });
  }
  return res.status(status).send('Something went wrong.');
});

async function start() {
  await initStore();
  await ensureSeed();
  app.listen(PORT, () => {
    console.log(`\n  Zila Sainik Board portal running`);
    console.log(`  Public site : http://localhost:${PORT}/`);
    console.log(`  Admin CMS   : http://localhost:${PORT}/admin`);
    console.log(`  API health  : http://localhost:${PORT}/api/health\n`);
  });
}

if (require.main === module) start();

module.exports = { app, start };

/**
 * Serverless handler (Vercel). `start()` never runs here — the platform owns
 * the HTTP server — so the store must be initialised lazily, once, before the
 * first request is handled. The cached promise is reused across warm
 * invocations of the same function instance.
 */
let readyPromise = null;
function ready() {
  if (!readyPromise) readyPromise = initStore().then(() => ensureSeed());
  return readyPromise;
}
module.exports.default = async (req, res) => {
  await ready();
  return app(req, res);
};
