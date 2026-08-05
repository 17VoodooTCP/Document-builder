/**
 * A spinning coin, for Bitcoin and for Tether.
 *
 * Built as a real 3D object rather than a sprite sheet or a video: two faces in
 * `preserve-3d`, a stack of thin slices standing in for the milled edge, and a
 * specular sweep across the face. It costs nothing to download, scales to any
 * size without softening, and recolours from two hex values — which is what a
 * looping MP4 of a coin would not do.
 *
 * The marks are the assets' own: ₿ in Bitcoin orange, ₮ in Tether green. Drawn
 * as glyphs on a disc, which is what both projects' own marks are.
 *
 * `prefers-reduced-motion` stops the rotation and presents the face square-on.
 * A coin tumbling forever beside a payment form is exactly the kind of movement
 * that setting exists to switch off.
 */

interface Spec {
  symbol: string;
  face: string;
  faceLow: string;
  rim: string;
  glyph: string;
  label: string;
}

const SPECS: Record<string, Spec> = {
  BTC: {
    symbol: '₿',
    face: '#F7C77A',
    faceLow: '#F7931A',
    rim: '#B96A06',
    glyph: '#FFFFFF',
    label: 'Bitcoin',
  },
  USDT: {
    symbol: '₮',
    face: '#4FCFA6',
    faceLow: '#26A17B',
    rim: '#14795A',
    glyph: '#FFFFFF',
    label: 'Tether',
  },
};

/** Slices standing in for thickness. Enough to read as milled metal, few
    enough that a phone is not compositing forty layers at sixty frames. */
const EDGE_SLICES = 14;

export default function Coin({
  asset, size = 108, spin = true,
}: { asset: 'BTC' | 'USDT'; size?: number; spin?: boolean }) {
  const s = SPECS[asset] || SPECS.BTC;
  const depth = Math.max(4, Math.round(size * 0.075));

  return (
    <div
      className="coin-stage"
      style={{ width: size, height: size, perspective: size * 4 }}
      role="img"
      aria-label={`${s.label} (${asset})`}
    >
      <div
        className={spin ? 'coin coin-spin' : 'coin'}
        style={{ width: size, height: size }}
      >
        {/* The milled edge: slices spaced through Z, so the coin has a side
            when it turns rather than vanishing to a line. */}
        {Array.from({ length: EDGE_SLICES }).map((_, i) => (
          <span
            key={i}
            className="coin-slice"
            style={{
              background: i % 2 ? s.rim : s.faceLow,
              transform: `translateZ(${(i / (EDGE_SLICES - 1) - 0.5) * depth}px)`,
            }}
          />
        ))}

        {[1, -1].map((dir) => (
          <span
            key={dir}
            className="coin-face"
            style={{
              transform: `rotateY(${dir > 0 ? 0 : 180}deg) translateZ(${depth / 2}px)`,
              background: `radial-gradient(circle at 32% 26%, ${s.face} 0%, ${s.faceLow} 58%, ${s.rim} 100%)`,
              boxShadow: `inset 0 0 ${size * 0.06}px rgba(0,0,0,0.35)`,
            }}
          >
            <span
              className="coin-ring"
              style={{ border: `${Math.max(1, size * 0.022)}px solid rgba(255,255,255,0.34)` }}
            />
            <span
              className="coin-glyph"
              style={{
                color: s.glyph,
                fontSize: size * 0.5,
                textShadow: `0 ${size * 0.012}px ${size * 0.02}px rgba(0,0,0,0.32)`,
              }}
            >
              {s.symbol}
            </span>
            {/* The catch of light travelling across the face. */}
            <span className="coin-sheen" />
          </span>
        ))}
      </div>
    </div>
  );
}
