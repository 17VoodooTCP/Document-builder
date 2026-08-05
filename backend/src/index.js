require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const prisma = require('./utils/prisma');

const app = express();
const PORT = process.env.PORT || 4000;

/*
 * Trust exactly one proxy hop.
 *
 * Render sits in front of this. Without it, express-rate-limit sees every
 * request as coming from the proxy's address — one client making all the
 * traffic — so the platform's own health check gets rate limited, the instance
 * is declared unhealthy, and it is killed for being busy. An outage the limiter
 * invented. Add a CDN in front and this becomes 2.
 */
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

/*
 * CORS. FRONTEND_URL may be a comma-separated list, and every entry is
 * normalised — a trailing slash on an origin is the single most common reason
 * a correctly-configured deployment still fails at the browser.
 */
const allowed = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    // No Origin header: server-to-server, curl, health checks.
    if (!origin || allowed.includes(origin.replace(/\/+$/, ''))) return cb(null, true);
    return cb(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

/*
 * 6MB, not the usual 10kb. Brand assets arrive as base64 data URLs on the
 * organisation routes, and base64 inflates by about a third — a 4MB logo is a
 * 5.4MB body. Everything else is small, but one limit that fits the largest
 * legitimate request beats a second parser mounted on a subset of paths.
 */
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: true, limit: '6mb' }));
app.use(cookieParser());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  /* Never rate-limit the health checks — see the trust-proxy note above. */
  skip: (req) => req.path === '/health' || req.path === '/health/db',
});
app.use(limiter);

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth', require('./routes/auth'));
app.use('/payments', require('./routes/payments'));
app.use('/admin', require('./routes/admin'));
app.use('/organisations', require('./routes/organisations'));
app.use('/documents', require('./routes/documents'));
app.use('/verify', require('./routes/verify'));

// ── Health ───────────────────────────────────────────────────────────────────

/** Liveness only. Proves the process is listening and nothing more. */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

/**
 * Readiness, per model.
 *
 * `/health` returns ok while every query fails, which is how a database whose
 * connection string is missing its name can sit behind a green check for days.
 * This runs the cheapest possible query against each model and reports which
 * answer. Safe to expose: no rows, no connection string. The error text is
 * Prisma's own and is the entire point — without it the only copy of the
 * failure is in the platform's log viewer.
 */
app.get('/health/db', async (req, res) => {
  const probes = {
    organisation: () => prisma.organisation.findFirst({ select: { id: true } }),
    user: () => prisma.user.findFirst({ select: { id: true } }),
    document: () => prisma.document.findFirst({ select: { id: true } }),
    template: () => prisma.documentTemplate.findFirst({ select: { id: true } }),
  };

  const models = {};
  for (const [name, run] of Object.entries(probes)) {
    try {
      await run();
      models[name] = { ok: true };
    } catch (err) {
      models[name] = {
        ok: false,
        code: err.code || null,
        message: String(err.message || err).split('\n').slice(0, 6).join(' '),
      };
    }
  }

  const ok = Object.values(models).every((m) => m.ok);
  res.status(ok ? 200 : 503).json({ ok, models });
});

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[unhandled]', err);
  res.status(status).json({ error: err.message || 'Something went wrong.' });
});

app.listen(PORT, '0.0.0.0', () => {
  const publicUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`\n📄 Document Builder API — ${publicUrl}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Origins:     ${allowed.join(', ') || '(none configured)'}`);
  console.log(`   QR target:   ${process.env.PUBLIC_URL || '(PUBLIC_URL unset)'}\n`);
});

module.exports = app;
