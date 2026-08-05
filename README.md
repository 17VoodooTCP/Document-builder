# Document Builder

Multi-tenant document issuance and verification. Any organisation uploads its
own logo, watermark and seal, sets its name, address and contact details, and
issues documents that carry a QR code resolving to a verification portal
rendered **in that organisation's identity**.

Descends from the NorthWhale Legacy correspondence system, generalised so that
nothing in the codebase is any particular brand.

---

## Why it is built this way

### One renderer, many identities

The temptation with a document builder is one template per document type. That
rots: five templates become five slightly different letterheads, and a change to
the footer has to be made five times and is made four.

There is a single layout engine. A `DocumentTemplate` supplies copy scaffolding
and declares which blocks are drawn — seal, watermark, QR, microtext, frame.
An `Organisation` supplies the identity. A document is the two composed.

### Brand assets live in the database

Logos, watermarks and seals are stored as data URLs on the `Organisation` row.

Render's filesystem is ephemeral, so uploading to disk was never available.
Adding S3 or Cloudinary means a second service, a second set of credentials, and
a second thing that can be down when somebody needs to print a letter. Brand
assets are small by nature and MongoDB documents cap at 16MB, which a brand kit
sits inside comfortably.

The moment a tenant needs a *media library* rather than a brand kit, that is when
to introduce object storage. Not before.

### The register stores what a reader can already see

`Document` deliberately does not store the body.

A verification page that reprints the document turns a reference number into a
way to read other people's correspondence — and references travel on the
outside of envelopes. What is kept is what a recipient can already read on the
paper in front of them, so they can compare it, plus a SHA-256 fingerprint over
the canonical field set so an altered field shows up.

The portal never receives the document and therefore cannot check it for the
reader. It says so.

### Claims are kept to what is true

Inherited as a rule from the system this descends from, and worth stating
because it is easy to erode:

- A seal, a watermark and a guilloché are conventions. No reader takes them as
  factual assertions, and they can be as elaborate as the design wants.
- A sentence is a claim. "Digitally authorized", "passed cryptographic
  verification", "has not been altered" all name operations. If the operation
  does not happen, the sentence is the one thing a recipient could later hold
  against the organisation.

Wording throughout says what the system actually did — registered, issued, in
good standing — and the visual weight is identical either way.

---

## Layout

```
backend/     Express + Prisma + MongoDB. Deploys to Render.
  routes/auth.js            register, login, refresh, logout, me
  routes/organisations.js   tenants, brand assets, signatories
  routes/documents.js       issuing, standing, drafts
  routes/verify.js          the public portal's only endpoint
  middleware/auth.js        authenticate (who) and requireRole (may they, here)

frontend/    React + TypeScript + Vite + Tailwind. Deploys to Vercel.
  components/DocumentSheet.tsx   the layout engine — one of it
  lib/fingerprint.ts             must match the backend byte for byte
  pages/Builder.tsx              form on the left, the real sheet on the right
  pages/Verify.tsx               public, and rendered in the tenant's identity
```

## Getting started

```bash
# backend
cd backend
npm install
cp .env.example .env      # then fill in DATABASE_URL and the JWT secrets
npx prisma db push
npm run dev

# frontend
cd frontend
npm install
cp .env.example .env      # VITE_API_URL=http://localhost:4000
npm run dev
```

### Environment

| Variable | Where | Notes |
|---|---|---|
| `DATABASE_URL` | backend | MongoDB Atlas. **Must include a database name** — `…mongodb.net/dbname?…`, not `…mongodb.net/?…`. Atlas's copy button omits it and the connection fails with "empty database name not allowed". |
| `JWT_SECRET` | backend | Long random string. |
| `JWT_REFRESH_SECRET` | backend | A **different** long random string. |
| `FRONTEND_URL` | backend | Comma-separated origins for CORS. |
| `PUBLIC_URL` | backend | Where QR codes point. The frontend's public origin. |
| `VITE_API_URL` | frontend | Backend origin, no trailing slash, no `/api`. |
| `UNLOCK_PRICE_USD` | backend | Price of the one-off unlock, in whole dollars. Defaults to 49. |
| `BTC_ADDRESS` | backend | Your Bitcoin receiving address. |
| `USDT_TRON_ADDRESS` | backend | Your **Tron (TRC-20)** USDT address. Any other chain will never match. |
| `TRONGRID_API_KEY` | backend | Optional. Raises the TronGrid rate limit. |

### Deployment notes

Two traps worth knowing, both learned the hard way:

- **`prisma db push` is not part of the build.** Render runs `npm install`,
  which triggers `prisma generate` — that generates the *client*, not the
  database. Push the schema explicitly after the first deploy and after any
  schema change.
- **Asset filenames are case-sensitive in production.** `Logo.png` resolves on
  Windows and 404s on Vercel. Keep everything lowercase.

---

## Authority

Authentication is per user; authority is per membership. Somebody may own one
tenant and merely view another, and a document records which hat they were
wearing when they issued it.

| Role | May |
|---|---|
| `VIEWER` | Read the register and the organisation's identity |
| `ISSUER` | Everything above, plus issue documents, change their standing, and keep drafts |
| `OWNER` | Everything above, plus edit the identity, brand assets and signatories |

Two details that are deliberate rather than accidental:

- **A stranger gets 404, not 403.** Telling somebody an organisation exists but
  is closed to them confirms it exists, and slugs are guessable. A member who is
  merely ranked too low gets 403, because they already know it is there.
- **Creating an organisation makes you its owner, in one transaction.** It is
  the only way authority enters the system from outside. Without the
  transaction, a half-failure takes the slug, leaves nobody able to administer
  it, and hides it from the person who made it.

`/verify` is the only unauthenticated route. A recipient holding a letter is not
a user of this system and is not asked to become one.

### Tokens

Access tokens last 15 minutes, refresh tokens 7 days, signed with different
secrets — sharing one secret means a leaked access token can mint refresh
tokens, which turns a fifteen-minute problem into a seven-day one.

Both are set as cookies *and* returned in the response body. The frontend is on
Vercel and the API on Render, so every cookie is third-party from the browser's
point of view; `sameSite=none; secure` is set and is correct, but Safari blocks
those outright. The client therefore holds the access token in memory — not
`localStorage`, which survives the tab and is readable by any script on the
page — and re-obtains it from `/auth/refresh` on load.

Refresh tokens are stateless, so nothing can strike an individual one out.
`/auth/logout` clears the cookies and the client discards its copy; a token
already copied elsewhere works until it expires. The route is not called
"revoke", because revocation is not what happens.

## Paid access

A one-off unlock per account, settled in Bitcoin or in USDT on Tron.

There is no payment processor. Funds go straight to the operator's own wallets,
and the API watches public explorers — mempool.space and TronGrid — for a
transfer that matches. Nothing in this codebase holds a key that could move
money, and the configured addresses are receive-only as far as it is concerned.

**How a payment is matched.** Every invoice shares one receiving address per
chain, so what distinguishes them is the amount: each is quoted a figure with a
few base units of noise on top, checked for uniqueness against every other open
invoice. The watcher looks for a transfer of exactly that figure, dated after
the invoice was raised. The honest limit is that this is amount-matching rather
than an address per invoice — a collision needs two payers quoted the same
figure inside the same half hour. When volume makes that real rather than
theoretical, per-invoice addresses are the change to make.

**Amounts are integers.** Satoshis and USDT×10⁶, compared as `BigInt`. Never
floats: `0.1 + 0.2` is not `0.3`, and a matcher that rounds silently rejects
correct payments and occasionally accepts short ones.

**Tron, specifically TRC-20.** Filtered on the USDT contract address, not on
the token's name — a TRC-20 token can call itself whatever it likes, and
matching on a symbol is how a checkout credits somebody for a worthless token
they minted that morning.

**What the paywall never covers.** `/verify` is free and always will be. A
recipient who scans a code on a letter is not a customer, has no account, and
has no idea this platform exists. Gating that would break the promise the
document makes on its own face — and break it for every code already printed,
including ones issued while the tenant was paying.

### The trap in this feature, twice

`Payment` matching taught the same lesson the schema already records against
`AuthToken.usedAt`, and it is worth stating a third time because it costs money
here rather than time. Prisma's MongoDB connector treats an **absent** field and
an explicit **null** as different things. Every `User` row written before
`unlockedAt` existed has no such key, so a guard of `where: { unlockedAt: null }`
matches nothing, updates nobody, and fails silently — leaving a customer with a
payment confirmed on-chain and no access to what they bought.

The filter is `OR: [{ unlockedAt: null }, { unlockedAt: { isSet: false } }]`, and
a confirmed payment that somehow did not unlock anything is repaired on the next
poll rather than left for a support ticket.

## The fingerprint

`backend/src/routes/documents.js` and `frontend/src/lib/fingerprint.ts` build the
same canonical string — same fields, same order, same separators — and hash it.
They must stay identical: the value printed on the paper comes from the browser
and the value on the register comes from the server, and if they drift, every
document issued in between shows a mismatch when nothing is actually wrong,
which teaches people to ignore the check.

Change one and you change both.

## Status

Working end to end: register, sign in, create an organisation, set its identity
and brand assets, build a document, issue it, print it, and scan the code to a
portal that renders in that organisation's identity.

Not built yet:

- `DocumentTemplate` has a model and no routes. The builder composes documents
  directly; saved templates are the next thing to add.
- No way to invite a second person to an organisation. Memberships exist and are
  enforced; only the owner-on-creation path writes one.
- `AuthToken` is unused. Email verification and password reset both need a mail
  service, and nothing in the UI claims an address has been confirmed.
