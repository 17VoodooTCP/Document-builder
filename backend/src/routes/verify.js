const express = require('express');
const prisma = require('../utils/prisma');

const router = express.Router();

/**
 * GET /verify/:slug/:reference
 *
 * Public, and where a scanned code lands.
 *
 * Returns the issuing organisation's identity alongside the document, because
 * the portal renders in *that* organisation's branding — a recipient who scans
 * a code should see the institution that wrote to them, not the platform that
 * generated it. That is the whole reason this is scoped by slug.
 *
 * Never returns the body. A verification endpoint that reprints the document
 * turns a reference number into a way to read other people's correspondence,
 * and references travel on the outside of envelopes. What comes back is what
 * the reader can already see on the paper in front of them, so they can compare
 * it — plus the fingerprint, so an altered field shows up.
 */
router.get('/:slug/:reference', async (req, res, next) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const reference = String(req.params.reference || '').trim().toUpperCase();

  if (!/^[a-z0-9-]{3,40}$/.test(slug) || !/^[A-Z0-9-]{4,40}$/.test(reference)) {
    return res.status(400).json({ found: false, error: 'Malformed verification link.' });
  }

  try {
    const organisation = await prisma.organisation.findUnique({
      where: { slug },
      select: {
        slug: true, name: true, legalName: true,
        addressLine1: true, addressLine2: true, country: true,
        supportEmail: true, website: true,
        logo: true, seal: true, accentColor: true, inkColor: true,
      },
    });
    if (!organisation) return res.status(404).json({ found: false, reference });

    const doc = await prisma.document.findFirst({
      where: { organisation: { slug }, reference },
    });

    /*
     * An unknown reference is answered, not errored. "We did not issue this" is
     * the single most useful thing this endpoint can say, and it deserves a
     * clean response — with the organisation attached, so the page can still
     * render in their identity while it delivers bad news.
     */
    if (!doc) return res.status(404).json({ found: false, reference, organisation });

    /*
     * Record the lookup, fire-and-forget. It feeds the history line, and a
     * failure to write it must never turn a successful verification into an
     * error — the answer the reader came for is already in hand.
     */
    const verifiedAt = new Date();
    prisma.document
      .update({
        where: { id: doc.id },
        data: { lastVerifiedAt: verifiedAt, verifyCount: { increment: 1 } },
      })
      .catch((e) => console.warn('[verify:touch]', e.message));

    res.json({
      found: true,
      organisation,
      document: {
        reference: doc.reference,
        verificationId: doc.verificationId,
        fingerprint: doc.fingerprint,
        kind: doc.kind,
        documentTitle: doc.documentTitle,
        recipientName: doc.recipientName,
        subject: doc.subject,
        department: doc.department,
        classification: doc.classification,
        signerName: doc.signerName,
        signerTitle: doc.signerTitle,
        authorizationId: doc.authorizationId,
        issuedOn: doc.issuedOn,
        status: doc.status || 'ACTIVE',
        statusReason: doc.statusReason || null,
        generatedAt: doc.generatedAt,
        recordedAt: doc.createdAt,
        /* The PREVIOUS lookup, not this one. "Last verified: a moment ago, by
           you" is noise. Null on a first scan, which the page says plainly. */
        lastVerifiedAt: doc.lastVerifiedAt,
        verifyCount: (doc.verifyCount || 0) + 1,
        verifiedAt,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
