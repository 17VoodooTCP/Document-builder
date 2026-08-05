const prisma = require('../utils/prisma');

/**
 * The gate.
 *
 * ── What is behind it, and what must never be ─────────────────────────────
 *
 * The workspace is behind it: organisations, issuing, the register, drafts.
 *
 * `/verify` is not, and this is the load-bearing decision in the file. A
 * recipient who scans a code printed on a letter is not a customer of this
 * platform, has no account, and has no idea it exists. Charging them — or even
 * showing them a sign-in wall — would break the one promise the document makes
 * on its own face, and would break it for every code already in circulation,
 * including those issued while the tenant was paying.
 *
 * `/auth` is not behind it either, for the obvious reason that somebody has to
 * be able to sign in before they can pay, and `/payments` cannot be behind the
 * paywall it exists to lift.
 *
 * A platform operator passes. They administer the platform and are not its
 * customer, and locking the operator out of a tenant they support in order to
 * collect forty-nine dollars from themselves is ceremony rather than revenue.
 */
async function requirePaid(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  if (req.user.isPlatformAdmin) return next();

  try {
    /*
     * Read fresh rather than trusting the token or the object authenticate
     * populated. Access is granted by a chain watcher that may have run a
     * second ago, and a customer whose payment just confirmed should not have
     * to sign out and back in to use what they bought.
     */
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { unlockedAt: true },
    });

    if (!user?.unlockedAt) {
      return res.status(402).json({
        error: 'This account does not have access yet.',
        /* A machine-readable code, so the client can route to the unlock page
           rather than string-matching an error message that will be reworded. */
        code: 'PAYMENT_REQUIRED',
      });
    }

    req.user.unlockedAt = user.unlockedAt;
    next();
  } catch (err) { next(err); }
}

module.exports = { requirePaid };
