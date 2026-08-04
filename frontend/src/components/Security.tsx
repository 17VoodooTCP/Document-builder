/**
 * Printing conventions.
 *
 * A guilloché, a struck seal, microprinting and a facsimile signature are the
 * furniture of an official document. None of them is a factual assertion and no
 * reader takes them as one, which is exactly why they are allowed to be as
 * elaborate as the design wants — the honesty rule in this codebase binds
 * sentences, not ornament.
 *
 * What they do earn is difficulty. A rosette whose parameters come from the
 * document's own reference is not something you can lift off one letter and
 * paste onto another without it disagreeing with the reference printed beside
 * it, and that is a real property rather than a claimed one.
 */

/** FNV-1a. Small, stable, and identical every time for the same reference. */
function seedFrom(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic sequence from that seed. No Math.random anywhere near print. */
function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

/**
 * A guilloché rosette.
 *
 * Hypotrochoids — the curve a spirograph draws — layered a few deep at slightly
 * different radii and frequencies. The ratios come from the reference, so two
 * documents from the same organisation carry visibly different rosettes and the
 * one on a given page belongs to the reference printed next to it.
 *
 * Drawn as strokes rather than fills: fine line work is what survives a
 * photocopier badly, which is the entire point of the convention.
 */
export function Guilloche({
  seed, size = 520, color = '#0F5F5C', opacity = 0.5, rings = 5, strokeWidth = 0.55,
}: {
  seed: string; size?: number; color?: string; opacity?: number; rings?: number; strokeWidth?: number;
}) {
  const next = rng(seedFrom(seed || 'document'));
  const c = size / 2;

  const paths: string[] = [];
  for (let ring = 0; ring < rings; ring++) {
    const R = c * (0.94 - ring * 0.135);
    /* Petal counts kept coprime-ish and away from small integers, which
       degenerate into circles and stars rather than lace. */
    const k = 7 + Math.floor(next() * 12);
    const d = 0.42 + next() * 0.36;
    const r = R / k;

    let path = '';
    const steps = 720;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2 * k;
      const x = c + (R - r) * Math.cos(t) + r * d * R * 0.045 * Math.cos(((R - r) / r) * t);
      const y = c + (R - r) * Math.sin(t) - r * d * R * 0.045 * Math.sin(((R - r) / r) * t);
      path += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    paths.push(path);
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      aria-hidden="true"
      style={{ opacity }}
      /* Not focusable, not read out. It is decoration and announcing it to a
         screen reader would be noise in place of the letter's actual content. */
      role="presentation"
    >
      <g fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round">
        {paths.map((d, i) => (
          <path key={i} d={d} opacity={1 - i * 0.11} />
        ))}
        <circle cx={c} cy={c} r={c * 0.2} strokeWidth={strokeWidth * 1.4} />
        <circle cx={c} cy={c} r={c * 0.17} strokeWidth={strokeWidth * 0.7} />
      </g>
    </svg>
  );
}

/**
 * A facsimile signature.
 *
 * Either a scan the organisation uploaded, or the name set in a script face.
 * Both are facsimiles and neither is a signature — nothing on the page says
 * otherwise, and the wording under it says who the document is attributable to
 * rather than claiming somebody signed it in person.
 *
 * Dark ink, not the accent colour. A signature struck in a brand teal reads as
 * a logo; ink on a letter is ink, and near-black with a trace of blue is what
 * a fountain pen actually leaves on paper.
 *
 * Under it runs a line of microprinting carrying the authorisation id. That
 * ties this signature block to this document — lifting the image alone leaves
 * the wrong id under it, legible to anyone who puts a glass on it.
 */
export function Signature({
  name, image, authorizationId, ink = '#101B2D',
}: {
  name: string; image?: string | null; authorizationId: string; ink?: string;
}) {
  const next = rng(seedFrom(name || 'signature'));
  /* A degree or two off the horizontal, always the same for the same name. A
     signature laid dead flat on the baseline is the giveaway that it was set
     rather than written. */
  const tilt = (next() * 2.4 - 1.2).toFixed(2);

  return (
    <div style={{ width: '58mm' }}>
      <div style={{ height: '9mm' }} className="flex items-end overflow-hidden">
        {image ? (
          <img
            src={image}
            alt=""
            aria-hidden="true"
            style={{
              maxHeight: '9mm', maxWidth: '52mm',
              /* Scans arrive as dark-on-white JPEGs. Multiply drops the white
                 so the stroke sits on the paper rather than in a grey box. */
              mixBlendMode: 'multiply',
            }}
          />
        ) : name ? (
          <span
            aria-hidden="true"
            style={{
              fontFamily: '"Edwardian Script ITC", "Palace Script MT", "Snell Roundhand", "Apple Chancery", Gabriola, "Segoe Script", "Brush Script MT", cursive',
              /*
               * Small, and deliberately so.
               *
               * A name set large enough to fill the space reads as a logotype.
               * A pen signature on a letter is modest — it sits inside the
               * space above the rule with room to spare, because the person
               * signing was writing, not laying out a page.
               */
              fontSize: '14pt',
              lineHeight: 1,
              color: ink,
              display: 'inline-block',
              transform: `rotate(${tilt}deg)`,
              paddingBottom: '0.6mm',
              /* A hairline of the same ink, offset a fraction. Reads as the
                 weight variation of a nib rather than as a drop shadow. Scaled
                 down with the type — at 14pt anything heavier looks bold. */
              textShadow: `0.06mm 0.03mm 0 ${ink}`,
            }}
          >
            {name}
          </span>
        ) : null}
      </div>

      <div style={{ height: '0.25mm', background: ink, opacity: 0.65 }} />

      {/* Microprinting. Legible only under magnification, which is its job. */}
      <div
        className="microtext"
        style={{ color: ink, opacity: 0.75, marginTop: '0.5mm' }}
        aria-hidden="true"
      >
        {`AUTHORISED FOR ISSUE · ${authorizationId} · `.repeat(14)}
      </div>
    </div>
  );
}
