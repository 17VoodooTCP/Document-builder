const jwt = require('jsonwebtoken');

/**
 * Two tokens, two secrets.
 *
 * The access token is short-lived and sent on every request; the refresh token
 * is long-lived and sent only to /auth/refresh. They are signed with different
 * secrets on purpose — sharing one means a leaked access token can be replayed
 * to mint refresh tokens, which turns a fifteen-minute problem into a
 * seven-day one.
 */

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';

function requireSecret(name) {
  const value = process.env[name];
  if (!value) {
    /* Fail at first use rather than signing with `undefined`, which jsonwebtoken
       accepts and which produces tokens anyone can forge. */
    throw new Error(`${name} is not set. Refusing to sign tokens.`);
  }
  return value;
}

const signAccess = (userId) =>
  jwt.sign({ userId }, requireSecret('JWT_SECRET'), { expiresIn: ACCESS_TTL });

const signRefresh = (userId) =>
  jwt.sign({ userId }, requireSecret('JWT_REFRESH_SECRET'), { expiresIn: REFRESH_TTL });

const verifyAccess = (token) => jwt.verify(token, requireSecret('JWT_SECRET'));
const verifyRefresh = (token) => jwt.verify(token, requireSecret('JWT_REFRESH_SECRET'));

/**
 * Cookie options.
 *
 * `sameSite: 'none'` in production because the frontend is on Vercel and the
 * API on Render — different sites, so a lax cookie is never sent. That requires
 * `secure`, which is correct anyway. In development both are on localhost, where
 * 'strict' works and 'none' would be rejected without HTTPS.
 */
const IS_PROD = process.env.NODE_ENV === 'production';

const accessCookie = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: IS_PROD ? 'none' : 'strict',
  maxAge: 15 * 60 * 1000,
};

const refreshCookie = {
  ...accessCookie,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

module.exports = {
  signAccess, signRefresh, verifyAccess, verifyRefresh,
  accessCookie, refreshCookie,
};
