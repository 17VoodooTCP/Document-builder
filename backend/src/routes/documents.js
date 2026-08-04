const express = require('express');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * Documents — issuing, and the drafts on the way there.
 *
 * Issuing is what makes a QR code mean anything: until a reference is on the
 * register, a scan of it can only report that we have never heard of it.
 *
 * Which is also why issuing is ISSUER and not VIEWER. It is the privileged act
 * in this system — it puts an organisation's name and seal on a page that
 * leaves the building, and adds a row that the public portal will vouch for.
 * Reading the register is VIEWER; writing to it is not.
 */

router.use(authenticate);

/* ── Identifiers ──────────────────────────────────────────────────────────── */

/** PREFIX-YYMMDD-XXXX. Short enough to quote over the phone. */
function newReference(prefix) {
  const d = new Date();
  const stamp =
    String(d.getFullYear()).slice(2) +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');
  const tail = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
  return `${(prefix || 'DOC').toUpperCase()}-${stamp}-${tail}`;
}

const canonical = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * The exact string that gets hashed.
 *
 * Canonicalised first — ordered keys, collapsed whitespace, upper-cased
 * reference — because a fingerprint that changes when a trailing space does is
 * one that fails for the wrong reason. Everything surviving canonicalisation is
 * something a reader could see altered on the paper.
 *
 * The frontend computes this identically, so the value printed on the document
 * matches the value on the register. Change it here and it must change there.
 */
function fingerprintPayload(d) {
  return [
    ['org', canonical(d.organisationSlug).toLowerCase()],
    ['reference', canonical(d.reference).toUpperCase()],
    ['recipient', canonical(d.recipientName)],
    ['subject', canonical(d.subject)],
    ['department', canonical(d.department)],
    ['classification', canonical(d.classification)],
    ['signer', canonical(d.signerName)],
    ['title', canonical(d.signerTitle)],
    ['issued', canonical(d.issuedOn)],
  ]
    .map(([k, v]) => `${k}=${v}`)
    .join('|');
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Short, stable id derived from the reference. */
const shortId = (input, length = 16) => sha256(input).toUpperCase().slice(0, length);

/* Prisma throws on a malformed ObjectId rather than matching nothing, which
   turns a typo'd id into a 500. Checked here so it reads as a 404. */
const isObjectId = (v) => /^[0-9a-f]{24}$/i.test(String(v || ''));

/* ── Issue ────────────────────────────────────────────────────────────────── */

/**
 * POST /documents/:slug/issue
 *
 * Records a document at the moment it is exported. Upsert on reference:
 * reprinting the same document must not create a second record, and the
 * reference is what a reader will quote back.
 */
router.post('/:slug/issue', requireRole('ISSUER'), async (req, res, next) => {
  const org = req.organisation;
  const b = req.body || {};

  try {
    const reference = String(b.reference || newReference(org.referencePrefix)).toUpperCase();

    const core = {
      organisationSlug: org.slug,
      reference,
      recipientName: String(b.recipientName || ''),
      subject: String(b.subject || ''),
      department: String(b.department || ''),
      classification: String(b.classification || ''),
      signerName: String(b.signerName || ''),
      signerTitle: String(b.signerTitle || ''),
      issuedOn: String(b.issuedOn || ''),
    };

    const prefix = (core.department || org.referencePrefix || 'DOC').slice(0, 2).toUpperCase();

    const data = {
      organisationId: org.id,
      reference,
      verificationId: shortId(reference, 16),
      fingerprint: sha256(fingerprintPayload(core)),
      kind: String(b.kind || 'LETTER'),
      documentTitle: String(b.documentTitle || ''),
      recipientName: core.recipientName,
      subject: core.subject,
      department: core.department,
      classification: core.classification,
      signerName: core.signerName,
      signerTitle: core.signerTitle,
      authorizationId: String(
        b.authorizationId || `${prefix}-${shortId(reference + core.signerName, 5)}`,
      ),
      issuedOn: core.issuedOn,
      status: ['ACTIVE', 'PENDING', 'EXPIRED', 'REVOKED'].includes(b.status) ? b.status : 'ACTIVE',
      /* From the session, never from the body. A field recording who issued
         something is worthless if the issuer chooses what it says. */
      issuedBy: req.user.id,
    };

    const document = await prisma.document.upsert({
      where: { organisationId_reference: { organisationId: org.id, reference } },
      create: data,
      update: data,
    });

    res.json({ document, verifyPath: `/verify/${org.slug}/${reference}` });
  } catch (err) {
    next(err);
  }
});

/** Revoke or reinstate. Somebody holding a withdrawn document needs to know. */
router.patch('/:slug/:reference/status', requireRole('ISSUER'), async (req, res, next) => {
  const status = String(req.body?.status || '').toUpperCase();
  if (!['ACTIVE', 'PENDING', 'EXPIRED', 'REVOKED'].includes(status)) {
    return res.status(400).json({ error: 'status must be ACTIVE, PENDING, EXPIRED or REVOKED.' });
  }

  try {
    const document = await prisma.document.update({
      where: {
        organisationId_reference: {
          organisationId: req.organisation.id,
          reference: String(req.params.reference).toUpperCase(),
        },
      },
      data: { status, statusReason: req.body?.reason ? String(req.body.reason).trim() : null },
    });
    res.json({ document });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'No such document.' });
    next(err);
  }
});

router.get('/:slug', requireRole('VIEWER'), async (req, res, next) => {
  try {
    const documents = await prisma.document.findMany({
      where: { organisationId: req.organisation.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ documents });
  } catch (err) {
    next(err);
  }
});

/* ── Drafts ───────────────────────────────────────────────────────────────── */

router.get('/:slug/drafts', requireRole('VIEWER'), async (req, res, next) => {
  try {
    const drafts = await prisma.draft.findMany({
      where: { organisationId: req.organisation.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    res.json({ drafts });
  } catch (err) {
    next(err);
  }
});

router.post('/:slug/drafts', requireRole('ISSUER'), async (req, res, next) => {
  const b = req.body || {};
  try {
    /*
     * The whole builder state travels as one JSON blob rather than as columns.
     * A draft is working state whose shape changes as the builder grows, and
     * migrating a collection every time a field is added buys nothing here.
     */
    const data = {
      organisationId: req.organisation.id,
      title: String(b.title || b.recipientName || 'Untitled document').trim(),
      kind: String(b.kind || 'LETTER'),
      payload: JSON.stringify(b.payload || {}),
      reference: String(b.reference || ''),
      savedBy: req.user.id,
    };

    if (!b.id) {
      return res.json({ draft: await prisma.draft.create({ data }) });
    }
    if (!isObjectId(b.id)) return res.status(404).json({ error: 'No such draft.' });

    /*
     * Updating an existing draft is filtered on the organisation as well as the
     * id. A draft id sent by a client is a claim about which draft, not proof of
     * which tenant — and being an issuer here is not licence to overwrite
     * somebody else's working state elsewhere.
     */
    const { count } = await prisma.draft.updateMany({
      where: { id: b.id, organisationId: req.organisation.id },
      data,
    });
    if (!count) return res.status(404).json({ error: 'No such draft.' });

    res.json({ draft: await prisma.draft.findUnique({ where: { id: b.id } }) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:slug/drafts/:id', requireRole('ISSUER'), async (req, res, next) => {
  if (!isObjectId(req.params.id)) return res.status(404).json({ error: 'No such draft.' });
  try {
    const { count } = await prisma.draft.deleteMany({
      where: { id: req.params.id, organisationId: req.organisation.id },
    });
    if (!count) return res.status(404).json({ error: 'No such draft.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
