import { useEffect, useState } from 'react';
import type { DocumentDraft, PortalOrganisation } from '../lib/types';
import { groupHex } from '../lib/fingerprint';
import { longDate, paragraphs } from '../lib/format';
import { qrDataUrl, verifyUrl } from '../lib/qr';
import { Guilloche, HoloStrip, Signature } from './Security';
import { foil as foilFor, typeface as typefaceFor } from '../lib/typefaces';

/**
 * The layout engine. One of it.
 *
 * The obvious shape for a document builder is a template per document type, and
 * it rots: five templates become five slightly different letterheads, and a
 * change to the footer is made four times out of five. So there is a single
 * sheet, and everything that varies is either identity (from the Organisation)
 * or a block that is drawn or not (from `features`).
 *
 * ── On what the furniture is allowed to say ───────────────────────────────
 *
 * The seal, the guilloché, the watermark, the frame and the microtext are
 * conventions. Nobody reads them as factual assertions and they can be as
 * elaborate as the design wants. A sentence is different: "digitally
 * authorized", "cryptographically verified", "this document has not been
 * altered" all name operations, and if the operation does not happen the
 * sentence is the one thing a recipient could later hold against the
 * organisation.
 *
 * So the wording says what actually happened — issued under a reference,
 * recorded on a register, carrying a control mark and a fingerprint the reader
 * can compare themselves — and it is set at exactly the weight a grander claim
 * would have had.
 */

type Identity = PortalOrganisation & { watermark?: string | null };

interface Props {
  organisation: Identity;
  draft: DocumentDraft;
  reference: string;
  /** Stable id derived from the reference. Quoted in the footer and by the QR. */
  documentId: string;
  fingerprint: string;
  authorizationId: string;
  generatedAt?: string;
  signatureImage?: string | null;
}

const KIND_LABEL: Record<string, string> = {
  LETTER: 'Official correspondence',
  CERTIFICATE: 'Certificate',
  NOTICE: 'Formal notice',
  STATEMENT: 'Statement',
};

export default function DocumentSheet({
  organisation: org, draft, reference, documentId, fingerprint,
  authorizationId, generatedAt, signatureImage,
}: Props) {
  const accent = org.accentColor || '#0F5F5C';
  const ink = org.inkColor || '#1B2733';
  const f = draft.features;
  const foilSpec = foilFor(draft.foil);
  const face = typefaceFor(draft.typeface);

  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!f.qr || !reference) { setQr(null); return; }
    let live = true;
    qrDataUrl(verifyUrl(org.slug, reference))
      .then((url) => { if (live) setQr(url); })
      /* A missing code leaves a labelled gap rather than an exception. The rest
         of the document is still worth printing. */
      .catch(() => { if (live) setQr(null); });
    return () => { live = false; };
  }, [f.qr, org.slug, reference]);

  const address = [org.addressLine1, org.addressLine2, org.country].filter(Boolean);
  const office = [draft.department, org.addressLine2 || org.addressLine1].filter(Boolean).join(', ');
  const stamp = generatedAt || new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  return (
    <article
      className="sheet font-serif shadow-xl"
      /* The chosen families are handed down as custom properties and picked up
         by two rules in index.css. Setting them here rather than on every
         element means the typeface is one decision in one place, which is the
         same reason there is one sheet rather than one per document type. */
      style={{
        color: ink,
        ['--doc-body' as string]: face.body,
        ['--doc-chrome' as string]: face.chrome,
      } as React.CSSProperties}
      aria-label={`${org.name} — ${draft.documentTitle || KIND_LABEL[draft.kind]}`}
    >
      {/* ── Behind everything ──────────────────────────────────────────────
          The uploaded watermark if there is one, otherwise the guilloché drawn
          from this document's own reference. Something is always back there:
          a plain white field behind the body is the one thing that reads as a
          word processor rather than as stationery. */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
        aria-hidden="true"
      >
        {f.watermark && org.watermark ? (
          <img
            src={org.watermark}
            alt=""
            className="select-none"
            style={{
              width: '150mm',
              /* Visible, and no more. Heavy enough to survive a photocopier and
                 to be obviously missing from a flat reproduction; light enough
                 that nine-point body copy still reads cleanly over it. */
              opacity: 0.13,
            }}
          />
        ) : f.guilloche ? (
          <Guilloche seed={reference} size={560} color={accent} opacity={0.1} rings={6} />
        ) : null}
      </div>

      {/* ── Frame ───────────────────────────────────────────────────────────
          A hairline outside, a heavier rule inside. Two weights read as
          deliberate; one reads as a border somebody forgot to remove. */}
      {f.frame && (
        <>
          <div className="pointer-events-none absolute" style={{ inset: '6mm', border: `0.5mm solid ${accent}`, opacity: 0.9 }} />
          <div className="pointer-events-none absolute" style={{ inset: '7.6mm', border: `0.15mm solid ${accent}`, opacity: 0.45 }} />
        </>
      )}

      {/* ── Microtext ───────────────────────────────────────────────────────
          Along the head and foot of the frame. It says nothing, and is legible
          only under magnification, which is the whole of its purpose. */}
      {f.microtext && ['4.6mm', 'bottom'].map((pos) => (
        <div
          key={pos}
          className="microtext pointer-events-none absolute"
          style={{
            ...(pos === 'bottom' ? { bottom: '4.6mm' } : { top: '4.6mm' }),
            left: '7mm', right: '7mm', color: accent, opacity: 0.7,
          }}
          aria-hidden="true"
        >
          {`${org.legalName || org.name} · ${reference} · ${documentId} · `.repeat(20)}
        </div>
      ))}

      {/*
        The left margin widens when the classification strip is drawn.

        The strip used to sit at 10.5mm against text starting at 15mm — about
        two millimetres of clearance once the vertical line box was accounted
        for, which is inside the margin of error for font metrics and letter
        spacing, and it collided with the body copy. Space is now reserved for
        it rather than assumed. An asymmetric left margin is what a document
        with a margin marking has always had.
      */}
      <div
        className="relative flex flex-col"
        style={{
          padding: f.marginRule && draft.classification ? '13mm 15mm 9mm 21mm' : '13mm 15mm 9mm',
          minHeight: '297mm',
        }}
      >
        {/* ── Letterhead ────────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            {/* No logo is not a gap. The organisation's name set in display
                type is a real letterhead, and a great many are exactly that. */}
            {org.logo
              ? <img src={org.logo} alt={org.name} style={{ maxHeight: '15mm', maxWidth: '78mm' }} />
              : <div className="font-serif leading-none" style={{ fontSize: '19pt', color: accent }}>{org.name}</div>}
          </div>

          <h1
            className="shrink-0 text-right font-sans font-bold uppercase"
            style={{ fontSize: '12.5pt', letterSpacing: '0.02em', lineHeight: 1.1 }}
          >
            {draft.headerLabel || KIND_LABEL[draft.kind] || 'Official correspondence'}
          </h1>
        </header>

        {/* Address on the left, the document's identifiers on the right. Both
            are things a recipient reads back down a phone, so both are set to
            be found quickly rather than to balance the page. */}
        <div className="flex items-start justify-between gap-8" style={{ marginTop: '4mm' }}>
          <address className="text-[7.5pt] not-italic leading-[1.5] opacity-85">
            <div className="font-semibold">{org.legalName || org.name}</div>
            {address.map((line) => <div key={line}>{line}</div>)}
            {org.supportEmail && <div>{org.supportEmail}</div>}
          </address>

          <dl className="shrink-0 text-right text-[7.5pt] leading-[1.6]">
            <MetaRow label="Date of issue">{longDate(draft.issuedOn)}</MetaRow>
            <MetaRow label="Reference" mono>{reference}</MetaRow>
            {draft.department && <MetaRow label="Department">{draft.department}</MetaRow>}
          </dl>
        </div>

        {/* ── Foil strip ───────────────────────────────────────────────────
            Where a plain double rule used to be. The issuer's name and the
            document's own reference are struck into the band, so the strip on
            a page belongs to that page rather than being stationery anyone
            could reuse. */}
        <div style={{ marginTop: '4mm' }}>
          {f.holoStrip ? (
            <HoloStrip
              stops={foilSpec.stops}
              text={`${(org.legalName || org.name).toUpperCase()} · ${reference}`}
              textColor={foilSpec.text}
              edge={foilSpec.edge}
            />
          ) : (
            <>
              <div style={{ height: '0.7mm', background: ink }} />
              <div style={{ height: '0.2mm', background: ink, marginTop: '0.7mm', opacity: 0.7 }} />
            </>
          )}
        </div>

        {/* ── Margin strip ──────────────────────────────────────────────────
            The classification, set vertically down the left edge. It is what
            survives a document being read in a stack — the only thing legible
            when the page is half under another one. */}
        {f.marginRule && draft.classification && (
          <div
            className="pointer-events-none absolute flex flex-col items-center"
            style={{ left: '9mm', width: '5mm', top: '95mm', bottom: '70mm' }}
            aria-hidden="true"
          >
            <div style={{ width: '0.2mm', flex: 1, background: ink, opacity: 0.3 }} />
            <span
              className="font-sans uppercase"
              style={{
                writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                fontSize: '5.5pt', letterSpacing: '0.3em', padding: '3mm 0', opacity: 0.55,
              }}
            >
              {draft.classification}
            </span>
            <div style={{ width: '0.2mm', flex: 1, background: ink, opacity: 0.3 }} />
          </div>
        )}

        {/* ── Addressee ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-8" style={{ marginTop: '7mm' }}>
          <div className="min-w-0">
            <div className="font-sans text-[6.5pt] uppercase tracking-[0.2em] opacity-55">
              Addressed to
            </div>
            <div className="font-serif font-bold" style={{ fontSize: '14pt', marginTop: '1.5mm' }}>
              {draft.recipientName || '—'}
            </div>
            <div className="text-[8.5pt] leading-[1.5] opacity-80" style={{ marginTop: '1mm' }}>
              {draft.recipientAddress.split('\n').map((l) => l.trim()).filter(Boolean)
                .map((line, i) => <div key={`${line}-${i}`}>{line}</div>)}
            </div>
          </div>

          {draft.classification && (
            <div className="shrink-0 text-right" style={{ maxWidth: '62mm' }}>
              <div style={{ height: '0.2mm', background: ink, opacity: 0.5, marginBottom: '1.5mm' }} />
              <div className="font-sans text-[7.5pt] font-bold uppercase tracking-[0.14em]">
                {draft.classification}
              </div>
              {draft.addresseeNote && (
                <div className="text-[6.5pt] leading-snug opacity-70" style={{ marginTop: '0.8mm' }}>
                  {draft.addresseeNote}
                </div>
              )}
            </div>
          )}
        </div>

        {draft.subject && (
          <p className="text-[9.5pt] font-semibold" style={{ marginTop: '7mm' }}>
            Subject: <span className="font-normal">{draft.subject}</span>
          </p>
        )}

        {/* ── Body. The one part of a document this system never stores. ── */}
        <div className="text-[9.5pt] leading-[1.75]" style={{ marginTop: '5mm', textAlign: 'justify', hyphens: 'auto' }}>
          {paragraphs(draft.body).map((p, i) => (
            <p key={i} style={{ marginBottom: '3.5mm', whiteSpace: 'pre-line' }}>{p}</p>
          ))}
        </div>

        {/* ── Signature and seal ────────────────────────────────────────── */}
        <div className="flex items-end justify-between gap-6" style={{ marginTop: 'auto', paddingTop: '7mm' }}>
          <div>
            <div className="text-[9pt]" style={{ marginBottom: '1mm' }}>Yours sincerely,</div>

            <Signature
              name={draft.signerName}
              image={signatureImage}
              authorizationId={authorizationId}
            />

            <div className="text-[9pt] font-bold" style={{ marginTop: '1.5mm' }}>{draft.signerName}</div>
            <div className="text-[7.5pt] leading-[1.5] opacity-75">
              {draft.signerTitle && <div>{draft.signerTitle}</div>}
              {draft.department && <div>{draft.department} Department</div>}
              <div>{org.legalName || org.name}</div>
            </div>

            {/* Authority box. The legend sits on the rule, as it does on a
                printed form — the shape itself says "this was countersigned"
                before anybody reads a word of it. */}
            <div
              className="relative"
              style={{ marginTop: '3mm', border: `0.2mm solid ${ink}`, opacity: 0.95, padding: '3mm 3mm 2.5mm', maxWidth: '62mm' }}
            >
              <span
                className="absolute bg-white px-1 font-sans text-[5.5pt] uppercase tracking-[0.16em]"
                style={{ top: '-1.6mm', left: '2mm', color: accent }}
              >
                Authorised for issue by
              </span>
              <div className="text-[7.5pt] font-bold">{draft.signerName || '—'}</div>
              {draft.department && <div className="text-[7pt] opacity-75">{draft.department} Department</div>}
              <div className="text-[7pt] opacity-75">
                Authorisation ID: <span className="font-mono font-semibold">{authorizationId}</span>
              </div>
            </div>
          </div>

          {f.seal && (
            <div className="shrink-0 self-end" style={{ paddingBottom: '4mm' }}>
              {org.seal ? (
                <img src={org.seal} alt="" aria-hidden="true" style={{ width: '32mm', height: '32mm', objectFit: 'contain' }} />
              ) : (
                /* No seal uploaded: a struck rosette in its place, drawn from
                   this reference. Better than a gap, and it is the same
                   convention rather than a substitute for one. */
                <div className="relative flex items-center justify-center" style={{ width: '32mm', height: '32mm' }}>
                  <Guilloche seed={`${reference}:seal`} size={121} color={accent} opacity={0.75} rings={4} strokeWidth={0.4} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="font-sans text-[4.5pt] uppercase tracking-[0.14em]" style={{ color: accent }}>
                      {org.name.slice(0, 22)}
                    </span>
                    <span className="font-mono text-[4pt] opacity-70" style={{ marginTop: '0.5mm' }}>{documentId.slice(0, 8)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Secure document panel ─────────────────────────────────────── */}
        <div style={{ marginTop: '5mm', borderTop: `0.2mm dashed ${ink}`, opacity: 0.35 }} />

        <footer style={{ marginTop: '4mm' }}>
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="font-sans text-[7.5pt] font-bold uppercase tracking-[0.16em]" style={{ color: accent }}>
                Secure document
              </div>

              {/* Every clause here is a thing that happened. Issued under a
                  reference; carries a control mark; recorded on a register.
                  What it pointedly does not say is that the page in the
                  reader's hand has been checked, because nothing checked it. */}
              <p className="text-[6.5pt] leading-[1.55] opacity-80" style={{ marginTop: '1.5mm', maxWidth: '105mm' }}>
                Issued by {org.legalName || org.name} under reference {reference}. This document
                carries a control mark and a verification identifier derived from that reference,
                and the details below are recorded on the issuer&rsquo;s register. The register does
                not hold the text of this letter, so the comparison is one you make.
                {org.supportEmail
                  ? ` If you did not expect this letter, or any detail appears altered, contact ${org.supportEmail} before acting on it.`
                  : ' If you did not expect this letter, or any detail appears altered, contact the issuer before acting on it.'}
              </p>

              <dl className="grid grid-cols-2 gap-x-6 text-[6.5pt]" style={{ marginTop: '2.5mm' }}>
                <FootRow label="Document ID" mono>{documentId}</FootRow>
                <FootRow label="Reference" mono>{reference}</FootRow>
                <FootRow label="Issuing office">{office || org.name}</FootRow>
                <FootRow label="Classification">{draft.classification || '—'}</FootRow>
                <FootRow label="Version">{draft.version || '1.0'}</FootRow>
                <FootRow label="Revision">{draft.revision || 'A'}</FootRow>
                <FootRow label="Generated" mono>{stamp}</FootRow>
                <FootRow label="Authorisation" mono>{authorizationId}</FootRow>
                {/* Half the digest. 64 hex characters do not fit at a size
                    anybody would compare, and 128 bits is already far past what
                    a person checking by eye can distinguish. The portal prints
                    the same leading run so the two read against each other. */}
                <FootRow label="Fingerprint" mono>{groupHex(fingerprint.slice(0, 20))}</FootRow>
              </dl>
            </div>

            {f.qr && (
              <div className="shrink-0 text-center" style={{ border: `0.2mm solid ${ink}`, padding: '2mm', width: '34mm' }}>
                <div className="font-sans text-[5.5pt] font-bold uppercase tracking-[0.12em]">
                  Verify this document
                </div>
                {qr
                  ? <img src={qr} alt={`Verification code for ${reference}`} style={{ width: '24mm', height: '24mm', margin: '1.5mm auto' }} />
                  : <div style={{ width: '24mm', height: '24mm', margin: '1.5mm auto', border: `0.2mm dashed ${accent}` }} />}
                <div style={{ height: '0.15mm', background: ink, opacity: 0.4 }} />
                <div className="font-sans text-[4.5pt] uppercase tracking-[0.1em] opacity-70" style={{ marginTop: '1mm' }}>
                  Scan to verify
                </div>
                <div className="font-mono text-[5pt] font-semibold" style={{ marginTop: '0.5mm' }}>{documentId}</div>
              </div>
            )}
          </div>

          {/* Bottom bar. What the document is NOT is the line that stops it
              being waved at a counter as though it were something else. */}
          {/* No rule above this. There is already a dashed separator opening
              the panel and a solid one under the letterhead; a third line four
              millimetres from the paper's edge reads as a mistake, and it was
              the one that stopped short of the verification panel. */}
          <div
            className="flex items-center justify-between font-sans text-[5.5pt] uppercase tracking-[0.14em] opacity-60"
            style={{ marginTop: '3.5mm' }}
          >
            <span>{draft.footerNote}</span>
            <span className="font-mono tracking-[0.08em]">{documentId}</span>
            <span>Page 1 of 1</span>
          </div>
        </footer>
      </div>
    </article>
  );
}

function MetaRow({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-end gap-3">
      <dt className="font-sans text-[6pt] uppercase tracking-[0.16em] opacity-50">{label}</dt>
      <dd className={`font-semibold ${mono ? 'font-mono tracking-[0.06em]' : ''}`}>{children}</dd>
    </div>
  );
}

function FootRow({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-2" style={{ paddingBottom: '0.8mm' }}>
      <dt className="w-[19mm] shrink-0 font-sans uppercase tracking-[0.1em] opacity-50">{label}</dt>
      <dd className={`min-w-0 flex-1 font-semibold ${mono ? 'font-mono' : ''}`}>{children}</dd>
    </div>
  );
}
