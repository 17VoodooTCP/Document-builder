const prisma = require('../utils/prisma');
const { verifyAccess } = require('../utils/jwt');

/**
 * Authentication, then authority.
 *
 * `authenticate` answers "who is this". `requireRole` answers "may they do this
 * here" — and the two are separate because authority in this system is per
 * organisation, not per user. Somebody may own one tenant and merely view
 * another, and a document must record which hat they were wearing.
 */

/** Populates req.user. 401 if the token is missing, expired or forged. */
async function authenticate(req, res, next) {
  const fromCookie = req.cookies?.accessToken;
  const header = req.headers.authorization || '';
  const token = fromCookie || (header.startsWith('Bearer ') ? header.slice(7) : null);

  if (!token) return res.status(401).json({ error: 'Not signed in.' });

  try {
    const { userId } = verifyAccess(token);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, isPlatformAdmin: true, emailVerified: true },
    });
    if (!user) return res.status(401).json({ error: 'Not signed in.' });

    req.user = user;
    next();
  } catch (err) {
    /*
     * Expiry is distinguished from every other failure, and only expiry. The
     * client needs to know when to call /auth/refresh rather than bouncing the
     * reader to a sign-in screen they do not need — but "malformed" and
     * "forged" are told apart only in the logs, because naming them tells an
     * attacker which half of their guess was wrong.
     */
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Not signed in.' });
  }
}

/** Ranked, so a check can ask for "at least this much". */
const RANK = { VIEWER: 1, ISSUER: 2, OWNER: 3 };

/**
 * Requires a membership of the organisation named by :slug, at or above `min`.
 *
 * Issuing is deliberately not the default a new member gets: it puts an
 * organisation's name and seal on a page that leaves the building.
 *
 * Populates req.organisation and req.membership, so handlers never look the
 * organisation up a second time — and never look it up by a slug the caller
 * supplied but was not authorised for.
 */
function requireRole(min = 'VIEWER') {
  const floor = RANK[min] || 1;

  return async function guard(req, res, next) {
    const slug = String(req.params.slug || '').toLowerCase();
    if (!slug) return res.status(400).json({ error: 'No organisation specified.' });

    try {
      const organisation = await prisma.organisation.findUnique({ where: { slug } });
      if (!organisation) return res.status(404).json({ error: 'No such organisation.' });

      /* A platform operator passes without a membership. They administer the
         platform, so requiring them to join every tenant to support one would
         be ceremony rather than security. */
      if (req.user?.isPlatformAdmin) {
        req.organisation = organisation;
        req.membership = { role: 'OWNER', synthetic: true };
        return next();
      }

      const membership = await prisma.membership.findFirst({
        where: { userId: req.user.id, organisationId: organisation.id },
      });

      /*
       * 404, not 403, when there is no membership at all. Telling a stranger
       * that an organisation exists but they cannot touch it confirms the
       * organisation exists, and slugs are guessable. A member who is merely
       * ranked too low gets a 403, because they already know it is there.
       */
      if (!membership) return res.status(404).json({ error: 'No such organisation.' });

      if ((RANK[membership.role] || 0) < floor) {
        return res.status(403).json({
          error: `This action needs ${min.toLowerCase()} access.`,
        });
      }

      req.organisation = organisation;
      req.membership = membership;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { authenticate, requireRole, RANK };
