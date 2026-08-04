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

/**
 * The foil strip under the letterhead.
 *
 * Replaces what used to be two plain rules. On real stationery this band is
 * hot-stamped diffraction foil with the issuer's name knocked into it; it
 * shifts colour as the page turns, which is precisely the thing a photocopier
 * cannot reproduce and a scan cannot fake.
 *
 * Paper and PDF are both fixed-angle media, so what is drawn is the appearance
 * of that band seen from one angle: a gradient set to `spreadMethod="repeat"`,
 * sweeping the hues a foil actually travels through, with the lettering struck
 * into it and a diffraction rule pattern over the top.
 *
 * ── Why SVG rather than CSS gradients ─────────────────────────────────────
 *
 * The PDF export rasterises the page through html2canvas, whose support for
 * repeating-linear-gradient is partial and version-dependent. An inline SVG is
 * serialised and drawn as an image, so the strip in the download is the strip
 * in the preview. It also stays sharp when printed, where a CSS gradient is at
 * the mercy of the print pipeline.
 *
 * It is furniture, and it claims nothing. Nothing on the document says the
 * strip was checked, because nothing checks it.
 */
export function HoloStrip({
  stops, text, textColor, edge, height = '1.9mm', repeats = 14,
}: {
  stops: string[];
  text: string;
  textColor: string;
  edge: string;
  height?: string;
  repeats?: number;
}) {
  /*
   * ~94:1, matching 180mm × 1.9mm on the page, so preserveAspectRatio="none"
   * distorts the lettering by a percent or two at most.
   */
  const W = 1080;
  const H = 11.5;
  const FS = 9.5;
  /* All caps, so there are no descenders to allow for and the band can close
     right up to the type. */
  const baseline = H / 2 + FS * 0.36;

  const id = `foil-${Math.abs(seedFrom(stops.join('') + text))}`;
  const band = ` ${text} ·`.repeat(repeats);
  const face = "'Segoe UI', Arial, Helvetica, sans-serif";

  /*
   * Diffraction does not spread its spectrum evenly.
   *
   * A grating compresses the blue end and stretches the yellow-red end, so an
   * evenly-stepped gradient — which is what the first version had — reads as a
   * printed rainbow rather than as an optical effect. These offsets bunch the
   * violets and open out through gold, which is the distribution an eye is
   * used to seeing on a real hot-stamped thread.
   */
  const SPREAD = [0, 0.075, 0.185, 0.3, 0.425, 0.565, 0.745, 1];
  const offsetAt = (i: number) =>
    stops.length === SPREAD.length ? SPREAD[i] : i / (stops.length - 1);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
      role="presentation"
      style={{ display: 'block' }}
    >
      <defs>
        {/* The spectrum itself. A tight x2 means many narrow repeats across the
            page — foil bands are fine, and a wide sweep looks like a sunset. */}
        <linearGradient id={id} x1="0" y1="0" x2="0.07" y2="1" spreadMethod="repeat">
          {stops.map((c, i) => (
            <stop key={i} offset={`${offsetAt(i) * 100}%`} stopColor={c} />
          ))}
        </linearGradient>

        {/* Specular sheen. Foil is a mirror on a slightly curved substrate, so
            it is bright along one edge and falls into shadow before the far
            edge catches the light again. Without this the strip is flat and
            reads as printed ink. */}
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="30%" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="52%" stopColor="#000000" stopOpacity="0.07" />
          <stop offset="80%" stopColor="#000000" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.18" />
        </linearGradient>

        {/* The grating itself, ruled fine and raked over. */}
        <pattern id={`${id}-lines`} width="3.2" height={H} patternUnits="userSpaceOnUse" patternTransform="skewX(-20)">
          <rect width="1.05" height={H} fill="#ffffff" opacity="0.15" />
          <rect x="1.9" width="0.45" height={H} fill="#000000" opacity="0.13" />
        </pattern>

        {/* Kinegram arcs. The concentric figure that catches the light in a
            band as the page tilts — the detail that separates a security foil
            from a strip of holographic gift wrap. */}
        <pattern id={`${id}-arcs`} width={H * 1.55} height={H} patternUnits="userSpaceOnUse">
          <g fill="none" stroke="#ffffff" strokeWidth="0.26" opacity="0.24">
            <circle cx={H * 0.78} cy={H / 2} r={H * 0.30} />
            <circle cx={H * 0.78} cy={H / 2} r={H * 0.52} />
            <circle cx={H * 0.78} cy={H / 2} r={H * 0.74} />
          </g>
        </pattern>

        {/*
         * Demetallisation.
         *
         * This is the change that matters. On a real foil the lettering is not
         * printed onto the strip — the metal is etched away and the paper shows
         * through, so the words are holes in the foil rather than ink on top of
         * it. Setting type over the gradient, which is what the first version
         * did, is exactly how a counterfeit looks under a glass.
         *
         * A luminance mask does it properly: white keeps the foil, black in the
         * shape of the letters removes it.
         */}
        <mask id={`${id}-knock`}>
          <rect width={W} height={H} fill="#ffffff" />
          <text
            x="5" y={baseline}
            fontSize={FS} fontWeight="700" letterSpacing="2"
            fill="#000000" fontFamily={face}
          >
            {band}
          </text>
        </mask>
      </defs>

      <g mask={`url(#${id}-knock)`}>
        <rect width={W} height={H} fill={`url(#${id})`} />
        <rect width={W} height={H} fill={`url(#${id}-arcs)`} />
        <rect width={W} height={H} fill={`url(#${id}-lines)`} />
        <rect width={W} height={H} fill={`url(#${id}-sheen)`} />
      </g>

      {/* A hairline around the etched letters, in the foil's own dark relative.
          Demetallised edges are never perfectly clean — the metal tears very
          slightly — and without this the knockout looks die-cut. */}
      <text
        x="5" y={baseline}
        fontSize={FS} fontWeight="700" letterSpacing="2"
        fill="none" stroke={textColor} strokeWidth="0.2" opacity="0.45"
        fontFamily={face}
      >
        {band}
      </text>

      {/* Containing hairlines, where the foil meets the paper. */}
      <rect width={W} height="0.3" fill={edge} opacity="0.9" />
      <rect y={H - 0.3} width={W} height="0.3" fill={edge} opacity="0.9" />
    </svg>
  );
}
