/**
 * EvilCat v1 — the mark, engraved into the sign-in panel.
 *
 * Inline SVG rather than a background image or an <img>, because every part of
 * it has to move independently: the crown lifts, the eyes close, the head
 * tilts. A file loaded through `background-image` is one flat picture and none
 * of that is reachable.
 *
 * ── What it is doing there ────────────────────────────────────────────────
 *
 * Not a mascot, and not decoration that happens to wiggle. It is a status
 * light: the eyes close when the password field takes focus and stay closed
 * while it is being typed, which says one thing — nothing is looking at this —
 * without a line of copy asking to be believed. That is the same rule the
 * documents follow. The animation only ever reports something that is true.
 *
 * ── Why the shapes are split the way they are ─────────────────────────────
 *
 * The crown is a separate path from the body so the ears can lift without
 * dragging the whole silhouette. The seam that leaves at each shoulder is two
 * pixels of a twenty-pixel round-capped stroke at six percent opacity, which is
 * invisible in practice and buys a moving part that would otherwise need the
 * outline redrawn.
 *
 * Everything animates on `transform` and `opacity` only — no width, height, top
 * or left — so the compositor does the work and the panel never reflows. The
 * card holding this is `overflow: hidden`, so nothing can escape it.
 */

export type CatMood =
  /** At rest. Eyes open, breathing. */
  | 'idle'
  /** Email focused: looking down at the field, ears up, head raised. */
  | 'email'
  /** Password focused and masked: eyes closed. */
  | 'password'
  /** Password focused but revealed: eyes open again, looking forward. */
  | 'reveal'
  /** Authenticated: golden sweep, one soft swell. */
  | 'success'
  /** Refused: one slow blink and a two-degree tilt. */
  | 'error';

export default function EvilCatV1({ mood = 'idle' }: { mood?: CatMood }) {
  return (
    <div className={`ec ec--${mood}`} aria-hidden="true">
      <svg
        /*
         * Cropped to the artwork, not to the 512 square it was drawn on.
         *
         * The mark is a tall shield inside a square canvas, so a 0 0 512 512
         * viewBox carries wide empty margins — and `meet` scales to fit the
         * *box*, margins included. In a short, wide login card that left the
         * cat filling 62% of the panel instead of the 86% it was sized for,
         * while the bottom of the shield still overran the card and was clipped
         * away. These bounds are the art's own, stroke width included:
         * x 128−10 → 384+10, y 76−18 (antenna tip) → 424+10 (chin).
         */
        viewBox="118 58 276 376"
        preserveAspectRatio="xMidYMid meet"
        className="ec-svg"
        role="presentation"
        focusable="false"
      >
        <defs>
          {/*
            The sweep for a successful sign-in. A narrow gold band used as a
            mask, travelling left to right across a gold copy of the mark, so
            the highlight appears to run through the engraving rather than
            sliding over the top of it.
          */}
          <linearGradient id="ec-sheen-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#000" />
            <stop offset="42%" stopColor="#fff" />
            <stop offset="58%" stopColor="#fff" />
            <stop offset="100%" stopColor="#000" />
          </linearGradient>

          <mask id="ec-sheen-mask" maskUnits="userSpaceOnUse" x="118" y="58" width="276" height="376">
            {/* Parked just off the leading edge; the keyframe carries it the
                width of the art plus its own width, so it clears completely. */}
            <rect
              className="ec-sheen-band"
              x="-182" y="38" width="300" height="416"
              fill="url(#ec-sheen-grad)"
            />
          </mask>

          {/*
            Drawn once and referenced twice — the visible engraving and the gold
            copy under the sweep. Duplicating the path data instead would mean
            two things to keep in step, and they would not stay in step.
          */}
          <g id="ec-shapes">
            {/* Body: left flank, the point at the chin, right flank. */}
            <path
              className="ec-body"
              d="M128 148 L128 330 C128 378 182 404 256 424 C330 404 384 378 384 330 L384 148"
            />
            {/* Crown: the two ears and the notch the antenna rises from. */}
            <path className="ec-ears" d="M128 148 L196 214 L256 160 L316 214 L384 148" />
            {/* Antenna. */}
            <g className="ec-antenna">
              <path className="ec-antenna-stem" d="M256 160 L256 98" />
              <circle className="ec-antenna-tip" cx="256" cy="76" r="18" />
            </g>
            {/* Eyes. Each in its own group so it can be scaled shut about its
                own centre without moving anything else. */}
            <g className="ec-eye ec-eye--l">
              <circle cx="206" cy="212" r="13" />
            </g>
            <g className="ec-eye ec-eye--r">
              <circle cx="306" cy="212" r="13" />
            </g>
            {/* Mouth. */}
            <path className="ec-smile" d="M181 236 C205 288 307 288 331 236" />
          </g>
        </defs>

        <g className="ec-breath">
          <g className="ec-head">
            <use href="#ec-shapes" className="ec-ink" />
            {/* The gold twin, revealed only by the travelling mask. */}
            <use href="#ec-shapes" className="ec-gold" mask="url(#ec-sheen-mask)" />
          </g>
        </g>
      </svg>
    </div>
  );
}
