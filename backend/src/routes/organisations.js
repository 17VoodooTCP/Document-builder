const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../utils/prisma');
const { ingest, AssetError } = require('../utils/assets');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * Organisations — the tenants.
 *
 * Everything a document needs in order to look like it came from somebody in
 * particular: name, address, contact, and the three brand assets.
 *
 * Every route here is authenticated, and every route below the collection is
 * additionally scoped to a membership of the organisation in the path. Reading
 * a tenant's identity is VIEWER; changing it — name, colours, letterhead,
 * signatories — is OWNER, because those are the things that decide what an
 * organisation's documents claim to be.
 *
 * Nothing public lives here. The verification portal needs an organisation's
 * identity in order to render in it, and gets it from /verify, which returns
 * only the fields a recipient is already looking at on paper.
 */

router.use(authenticate);

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** Public identity, for the portal and the renderer. Never internal fields. */
const publicShape = {
  id: true, slug: true, name: true, legalName: true,
  addressLine1: true, addressLine2: true, country: true,
  supportEmail: true, website: true,
  logo: true, watermark: true, seal: true,
  accentColor: true, inkColor: true, referencePrefix: true,
};

/**
 * GET /organisations
 *
 * The caller's own organisations, not every organisation on the platform. The
 * list is what the client routes from after sign-in, so it carries the role
 * alongside each one — the builder is hidden from a VIEWER by the same fact
 * that would make the API refuse them.
 *
 * A platform operator sees all of them, which is the one place that distinction
 * is load-bearing rather than a convenience.
 */
router.get('/', async (req, res, next) => {
  try {
    if (req.user.isPlatformAdmin) {
      const organisations = await prisma.organisation.findMany({
        select: { ...publicShape, createdAt: true },
        orderBy: { name: 'asc' },
      });
      return res.json({ organisations: organisations.map((o) => ({ ...o, role: 'OWNER' })) });
    }

    const memberships = await prisma.membership.findMany({
      where: { userId: req.user.id },
      select: { role: true, organisation: { select: { ...publicShape, createdAt: true } } },
    });

    const organisations = memberships
      .map((m) => ({ ...m.organisation, role: m.role }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ organisations });
  } catch (err) { next(err); }
});

/**
 * The guard has already fetched the organisation and proved the caller may see
 * it, so this hands back what it loaded rather than looking it up again by a
 * slug the caller supplied.
 */
router.get('/:slug', requireRole('VIEWER'), (req, res) => {
  const o = req.organisation;
  const organisation = Object.fromEntries(Object.keys(publicShape).map((k) => [k, o[k]]));
  res.json({ organisation, role: req.membership.role });
});

/**
 * POST /organisations
 *
 * Any signed-in account may create one, and the creator is made its OWNER in the
 * same breath. That is the only way authority enters this system from outside —
 * every other membership is granted by an owner who already has one — and
 * without it a fresh install has no organisation and no one who could make one.
 *
 * Both writes go in a transaction. An organisation created without its
 * membership is worse than a failed request: the slug is taken, nobody can
 * administer it, and the person who made it cannot even see it to try again.
 */
router.post('/',
  [
    body('slug').trim().toLowerCase().matches(SLUG)
      .withMessage('Slug must be 3–40 characters: lowercase letters, digits and hyphens.'),
    body('name').trim().isLength({ min: 1 }).withMessage('A name is required.'),
    body('legalName').optional().trim(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const b = req.body;
    try {
      const organisation = await prisma.$transaction(async (tx) => {
        const created = await tx.organisation.create({
          data: {
            slug: b.slug,
            name: b.name.trim(),
            legalName: (b.legalName || b.name).trim(),
            addressLine1: String(b.addressLine1 || '').trim(),
            addressLine2: String(b.addressLine2 || '').trim(),
            country: String(b.country || '').trim(),
            supportEmail: String(b.supportEmail || '').trim(),
            website: String(b.website || '').trim(),
            accentColor: /^#[0-9a-f]{6}$/i.test(b.accentColor || '') ? b.accentColor : '#0F5F5C',
            inkColor: /^#[0-9a-f]{6}$/i.test(b.inkColor || '') ? b.inkColor : '#1B2733',
            /* Falls back to the slug's first three letters, so a tenant that never
               sets one still gets readable references rather than "UNDEFINED-01". */
            referencePrefix: (b.referencePrefix || b.slug.slice(0, 3)).toUpperCase(),
          },
          select: publicShape,
        });

        await tx.membership.create({
          data: { userId: req.user.id, organisationId: created.id, role: 'OWNER' },
        });

        return created;
      });

      res.status(201).json({ organisation, role: 'OWNER' });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'That slug is already taken.' });
      }
      next(err);
    }
  });

router.patch('/:slug', requireRole('OWNER'), async (req, res, next) => {
  const b = req.body || {};
  const data = {};
  for (const k of ['name', 'legalName', 'addressLine1', 'addressLine2', 'country', 'supportEmail', 'website']) {
    if (typeof b[k] === 'string') data[k] = b[k].trim();
  }
  for (const k of ['accentColor', 'inkColor']) {
    if (/^#[0-9a-f]{6}$/i.test(b[k] || '')) data[k] = b[k];
  }
  if (typeof b.referencePrefix === 'string') {
    data.referencePrefix = b.referencePrefix.trim().toUpperCase().slice(0, 6);
  }

  /* The slug is not updatable and is not in that list. It appears in every
     verification link already printed, so changing it silently breaks every
     code in circulation — see the schema note. */

  try {
    /* By id, from the guard. Updating by the slug in the path would be
       re-deriving a target that has already been resolved and authorised. */
    const organisation = await prisma.organisation.update({
      where: { id: req.organisation.id },
      data,
      select: publicShape,
    });
    res.json({ organisation });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'No such organisation.' });
    next(err);
  }
});

/**
 * PUT /organisations/:slug/assets/:kind   { dataUrl }
 *
 * kind: logo | watermark | seal
 *
 * The image is re-encoded before it is stored, never trusted as sent — see
 * utils/assets for why that is what makes storing them in the database viable
 * at all. Sending null clears the slot, which is a real choice: a document with
 * no logo sets the organisation's name instead, and that is a proper letterhead
 * rather than a gap where one should be.
 */
router.put('/:slug/assets/:kind', requireRole('OWNER'), async (req, res, next) => {
  const kind = String(req.params.kind);
  if (!['logo', 'watermark', 'seal'].includes(kind)) {
    return res.status(400).json({ error: 'Asset must be logo, watermark or seal.' });
  }

  try {
    if (req.body?.dataUrl === null) {
      const organisation = await prisma.organisation.update({
        where: { id: req.organisation.id },
        data: { [kind]: null },
        select: publicShape,
      });
      return res.json({ organisation, cleared: true });
    }

    const asset = await ingest(req.body?.dataUrl, kind);
    const organisation = await prisma.organisation.update({
      where: { id: req.organisation.id },
      data: { [kind]: asset.dataUrl },
      select: publicShape,
    });
    res.json({
      organisation,
      asset: { bytes: asset.bytes, width: asset.width, height: asset.height },
    });
  } catch (err) {
    if (err instanceof AssetError) return res.status(400).json({ error: err.message });
    if (err.code === 'P2025') return res.status(404).json({ error: 'No such organisation.' });
    next(err);
  }
});

/* ── Signatories ──────────────────────────────────────────────────────────── */

router.get('/:slug/signatories', requireRole('VIEWER'), async (req, res, next) => {
  try {
    const signatories = await prisma.signatory.findMany({
      where: { organisationId: req.organisation.id, isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json({ signatories });
  } catch (err) { next(err); }
});

/**
 * OWNER, not ISSUER. Adding a signatory decides whose name and facsimile can
 * appear at the bottom of a page that leaves the building — that is a change to
 * the organisation's identity, not an act of issuing.
 */
router.post('/:slug/signatories', requireRole('OWNER'), async (req, res, next) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'A name is required.' });

  try {
    let signature = null;
    if (b.signature) signature = (await ingest(b.signature, 'signature')).dataUrl;

    const signatory = await prisma.signatory.create({
      data: {
        organisationId: req.organisation.id,
        name,
        title: String(b.title || '').trim(),
        department: String(b.department || '').trim(),
        prefix: b.prefix ? String(b.prefix).toUpperCase().slice(0, 2) : null,
        signature,
      },
    });
    res.status(201).json({ signatory });
  } catch (err) {
    if (err instanceof AssetError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

/**
 * Deactivated, not deleted — issued documents already name these people.
 *
 * Scoped with updateMany on (id, organisationId) rather than update on id
 * alone. A signatory id is not a secret, and being an owner somewhere is not
 * authority to retire somebody else's signatory: without the pairing, the guard
 * proves the caller owns *an* organisation and the write lands on whichever one
 * the id happens to belong to.
 */
router.delete('/:slug/signatories/:id', requireRole('OWNER'), async (req, res, next) => {
  /* Prisma throws on a malformed ObjectId rather than matching nothing. */
  if (!/^[0-9a-f]{24}$/i.test(String(req.params.id || ''))) {
    return res.status(404).json({ error: 'No such signatory.' });
  }
  try {
    const { count } = await prisma.signatory.updateMany({
      where: { id: req.params.id, organisationId: req.organisation.id },
      data: { isActive: false },
    });
    if (!count) return res.status(404).json({ error: 'No such signatory.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
