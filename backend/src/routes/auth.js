const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const prisma = require('../utils/prisma');
const {
  signAccess, signRefresh, verifyRefresh,
  accessCookie, refreshCookie,
} = require('../utils/jwt');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * Authentication.
 *
 * ── Why tokens come back in the body as well as in cookies ────────────────
 *
 * The frontend is on Vercel and the API on Render: different sites, so every
 * cookie this API sets is a third-party cookie from the browser's point of
 * view. `sameSite: 'none'; secure` is correct and is set — but Safari blocks
 * those outright and Chrome is walking the same way, so a cookie-only design
 * signs a share of real users out on load with no error to show them.
 *
 * So both are sent. The cookie is used where it survives; the access token is
 * returned so the client can present it as `Authorization: Bearer`, which
 * middleware/auth already accepts. The cost is that the token is reachable from
 * JavaScript on the client, which is a genuine XSS exposure and is the reason
 * the access token lives fifteen minutes.
 *
 * ── What logout can and cannot do ─────────────────────────────────────────
 *
 * Refresh tokens are stateless — nothing on the server records that one was
 * issued, so nothing can strike one out. /auth/logout clears the cookies and
 * the client discards its copy; a token already copied elsewhere keeps working
 * until it expires. Saying so here rather than calling the route "revoke",
 * which would name an operation that does not happen.
 */

/**
 * Sign-in attempts are limited far below the global 600, and by IP.
 *
 * Not by email: keying on the submitted address lets anyone lock a known user
 * out by failing at their address on purpose, which turns a brute-force defence
 * into a denial-of-service tool aimed at whoever you like.
 */
const attemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

/**
 * A real bcrypt hash of a string nobody has. Compared against when the email is
 * unknown, so a miss costs the same as a wrong password. Without it, "no such
 * user" returns in microseconds and "wrong password" in ~100ms, and the
 * difference is readable over the network — which is a user-enumeration oracle
 * regardless of how careful the error messages are.
 */
const DECOY_HASH = bcrypt.hashSync('no-such-account-placeholder', 10);

const BCRYPT_ROUNDS = 12;

/** Everything the client is told about itself. Never the password hash. */
const userShape = {
  id: true, email: true, name: true, emailVerified: true, isPlatformAdmin: true,
  unlockedAt: true, createdAt: true,
};

/** Memberships, flattened — the client needs "which organisations, as what". */
async function membershipsFor(userId) {
  const rows = await prisma.membership.findMany({
    where: { userId },
    select: {
      role: true,
      organisation: {
        select: { id: true, slug: true, name: true, logo: true, accentColor: true },
      },
    },
  });
  return rows.map((m) => ({ role: m.role, ...m.organisation }));
}

function issueSession(res, userId) {
  const accessToken = signAccess(userId);
  const refreshToken = signRefresh(userId);
  res.cookie('accessToken', accessToken, accessCookie);
  res.cookie('refreshToken', refreshToken, refreshCookie);
  return { accessToken, refreshToken };
}

const firstError = (req) => {
  const errors = validationResult(req);
  return errors.isEmpty() ? null : errors.array()[0].msg;
};

/* ── Register ─────────────────────────────────────────────────────────────── */

/**
 * POST /auth/register   { email, password, name }
 *
 * Open registration, with no organisation attached. A new account holds no
 * memberships and therefore can see nothing: authority in this system is per
 * membership, so an account on its own is inert until somebody adds it to an
 * organisation or it creates one.
 *
 * `emailVerified` stays false. The AuthToken model is here for the EMAIL_VERIFY
 * flow but no mail is sent yet, so nothing in this file claims an address has
 * been confirmed.
 */
router.post('/register',
  attemptLimiter,
  [
    body('email').trim().isEmail().withMessage('Enter a valid email address.')
      .normalizeEmail({ gmail_remove_dots: false }),
    /* Length over composition rules. A 12-character passphrase beats "P@ss1!"
       and does not push people towards writing the result on a card. */
    body('password').isLength({ min: 12 })
      .withMessage('Use at least 12 characters.')
      .isLength({ max: 200 }).withMessage('That password is too long.'),
    body('name').trim().isLength({ min: 1 }).withMessage('A name is required.')
      .isLength({ max: 120 }).withMessage('That name is too long.'),
  ],
  async (req, res, next) => {
    const bad = firstError(req);
    if (bad) return res.status(400).json({ error: bad });

    const email = String(req.body.email).toLowerCase();

    try {
      const user = await prisma.user.create({
        data: {
          email,
          password: await bcrypt.hash(req.body.password, BCRYPT_ROUNDS),
          name: String(req.body.name).trim(),
        },
        select: userShape,
      });

      const { accessToken } = issueSession(res, user.id);
      res.status(201).json({ user, memberships: [], accessToken });
    } catch (err) {
      /*
       * A taken address is reported plainly. The alternative — accepting the
       * registration and saying nothing — hides an enumeration vector that the
       * sign-in form leaks anyway, at the price of a person who genuinely has
       * an account being unable to work out why they cannot get in.
       */
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'An account already exists for that address.' });
      }
      next(err);
    }
  });

/* ── Login ────────────────────────────────────────────────────────────────── */

/**
 * POST /auth/login   { email, password }
 *
 * One message for both halves of a wrong answer. Naming which half was wrong
 * tells an attacker holding a list of addresses which ones are worth their time.
 */
router.post('/login',
  attemptLimiter,
  [
    body('email').trim().isEmail().withMessage('Enter your email and password.')
      .normalizeEmail({ gmail_remove_dots: false }),
    body('password').isString().isLength({ min: 1 })
      .withMessage('Enter your email and password.'),
  ],
  async (req, res, next) => {
    const bad = firstError(req);
    if (bad) return res.status(400).json({ error: bad });

    try {
      const record = await prisma.user.findUnique({
        where: { email: String(req.body.email).toLowerCase() },
      });

      const ok = await bcrypt.compare(req.body.password, record?.password || DECOY_HASH);
      if (!record || !ok) {
        return res.status(401).json({ error: 'Those details do not match an account.' });
      }

      const { accessToken } = issueSession(res, record.id);
      res.json({
        user: {
          id: record.id,
          email: record.email,
          name: record.name,
          emailVerified: record.emailVerified,
          isPlatformAdmin: record.isPlatformAdmin,
          unlockedAt: record.unlockedAt,
          createdAt: record.createdAt,
        },
        memberships: await membershipsFor(record.id),
        accessToken,
      });
    } catch (err) { next(err); }
  });

/* ── Refresh ──────────────────────────────────────────────────────────────── */

/**
 * POST /auth/refresh
 *
 * Takes the refresh token from its cookie, or from the body where the cookie
 * did not survive the cross-site trip.
 *
 * Both tokens are re-issued, so a session that stays in use keeps rolling
 * forward and one that is abandoned expires seven days after it was last
 * touched rather than seven days after sign-in.
 *
 * The user is re-read on every refresh rather than trusted from the token. It
 * is the one moment in the fifteen-minute cycle where a deleted account stops
 * being able to extend itself.
 */
router.post('/refresh', async (req, res, next) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!token) return res.status(401).json({ error: 'Not signed in.' });

  try {
    const { userId } = verifyRefresh(token);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: userShape });
    if (!user) return res.status(401).json({ error: 'Not signed in.' });

    const { accessToken } = issueSession(res, user.id);
    res.json({ user, memberships: await membershipsFor(user.id), accessToken });
  } catch (err) {
    if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
      /* Clear the cookies on the way out. A refresh token the browser keeps
         re-sending after it has expired produces a 401 on every page load and
         no way for the user to tell that signing in again would fix it. */
      res.clearCookie('accessToken', { ...accessCookie, maxAge: undefined });
      res.clearCookie('refreshToken', { ...refreshCookie, maxAge: undefined });
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
    next(err);
  }
});

/* ── Logout ───────────────────────────────────────────────────────────────── */

/**
 * POST /auth/logout
 *
 * Clears both cookies. It does not invalidate a token already held elsewhere —
 * see the note at the top of this file. Unauthenticated on purpose: signing out
 * with an already-expired access token has to work, and it is the state a
 * person is most likely to be in when they reach for the button.
 */
router.post('/logout', (req, res) => {
  res.clearCookie('accessToken', { ...accessCookie, maxAge: undefined });
  res.clearCookie('refreshToken', { ...refreshCookie, maxAge: undefined });
  res.json({ ok: true });
});

/* ── Me ───────────────────────────────────────────────────────────────────── */

/**
 * GET /auth/me
 *
 * Who is signed in, and what they may act as. The client calls this on load and
 * routes from the result, so memberships travel with it — a separate request for
 * "which organisations" would leave the first paint with a user and no idea
 * where to send them.
 */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    res.json({ user: req.user, memberships: await membershipsFor(req.user.id) });
  } catch (err) { next(err); }
});

module.exports = router;
