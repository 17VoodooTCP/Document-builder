const prisma = require('../utils/prisma');
const { settings } = require('../utils/settings');

/* Logged once per process. A warning on every request would bury the rest of
   the log under it, and it is a state, not an event. */
let warnedOpen = false;

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
     * If nothing can be paid with, nothing is charged for.
     *
     * A deployment with no receiving address on either chain cannot take a
     * payment — the unlock screen offers both assets as unavailable and there
     * is no path through it. Enforcing the gate in that state locks every
     * account out of a working product, permanently, with no action available
     * to anybody: not the customer, who cannot pay, and not the operator, who
     * may be the one locked out.
     *
     * That is a misconfiguration rather than a business decision, so it fails
     * open and says so in the log. It is a narrow exception — a single
     * configured address on either chain closes the gate again — and it is
     * worth the small risk of an unbilled hour against the certainty of a
     * total lockout the first time this ships ahead of its wallets.
     */
    const config = await settings();
    if (!config.btcAddress && !config.usdtTronAddress) {
      if (!warnedOpen) {
        warnedOpen = true;
        console.warn(
          '[paywall] No receiving address configured on either chain. Access is ' +
          'open until one is set at /admin or in the environment.',
        );
      }
      return next();
    }

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
