import { useEffect, useRef } from 'react';

/**
 * LetterGlitch — from React Bits, ported to TypeScript.
 *
 * A canvas of scrambling characters. Used behind the sign-in screens, where it
 * is the one place in this application that gets to have a personality: the
 * workspace chrome is deliberately colourless so that the only thing wearing an
 * identity is the tenant's document.
 *
 * Two departures from the published source, both noted where they occur: the
 * colour interpolation is fixed, and the animation stops when nobody is looking
 * at it.
 */

interface Rgb { r: number; g: number; b: number }

interface Letter {
  char: string;
  /** Current colour, carried as components rather than as a CSS string. */
  color: Rgb;
  /** Where this letter's current fade began. */
  start: Rgb;
  target: Rgb;
  progress: number;
}

interface Props {
  glitchColors?: string[];
  className?: string;
  glitchSpeed?: number;
  centerVignette?: boolean;
  outerVignette?: boolean;
  smooth?: boolean;
  characters?: string;
}

const FONT_SIZE = 16;
const CHAR_W = 10;
const CHAR_H = 20;

const FALLBACK: Rgb = { r: 97, g: 220, b: 163 };

function hexToRgb(hex: string): Rgb {
  const expanded = hex.replace(/^#?([a-f\d])([a-f\d])([a-f\d])$/i, (_m, r, g, b) => `${r}${r}${g}${g}${b}${b}`);
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded);
  return m
    ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
    : FALLBACK;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => ({
  r: Math.round(a.r + (b.r - a.r) * t),
  g: Math.round(a.g + (b.g - a.g) * t),
  b: Math.round(a.b + (b.b - a.b) * t),
});

const css = (c: Rgb) => `rgb(${c.r}, ${c.g}, ${c.b})`;

export default function LetterGlitch({
  glitchColors = ['#2b4539', '#61dca3', '#61b3dc'],
  className = '',
  glitchSpeed = 50,
  centerVignette = false,
  outerVignette = true,
  smooth = true,
  characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/[]{};:<>.,0123456789',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /*
   * Props are mirrored into a ref and read from inside the loop.
   *
   * The published version lists [glitchSpeed, smooth] as effect dependencies,
   * which tears down the canvas and reseeds every letter whenever either
   * changes, and silently ignores a change to the colours or the character set.
   * Reading from a ref means the loop is started once and always sees current
   * values.
   */
  const props = useRef({ glitchColors, glitchSpeed, smooth, characters });
  props.current = { glitchColors, glitchSpeed, smooth, characters };

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let letters: Letter[] = [];
    let columns = 0;
    let frame = 0;
    let lastGlitch = performance.now();

    const palette = () => props.current.glitchColors.map(hexToRgb);
    const charset = () => Array.from(props.current.characters);

    const randomChar = () => {
      const set = charset();
      return set[Math.floor(Math.random() * set.length)] || 'A';
    };
    const randomColor = () => {
      const p = palette();
      return p[Math.floor(Math.random() * p.length)] || FALLBACK;
    };

    /* One shared instruction: honour the user's own setting rather than
       animating a full-screen field of moving text at somebody who has asked
       the operating system for less of exactly that. */
    const stillness = window.matchMedia('(prefers-reduced-motion: reduce)');

    function seed(width: number, height: number) {
      columns = Math.ceil(width / CHAR_W);
      const rows = Math.ceil(height / CHAR_H);
      letters = Array.from({ length: columns * rows }, () => {
        const c = randomColor();
        return { char: randomChar(), color: c, start: c, target: c, progress: 1 };
      });
    }

    function draw() {
      if (!ctx || !canvas || letters.length === 0) return;
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      ctx.font = `${FONT_SIZE}px monospace`;
      ctx.textBaseline = 'top';

      for (let i = 0; i < letters.length; i++) {
        const l = letters[i];
        ctx.fillStyle = css(l.color);
        ctx.fillText(l.char, (i % columns) * CHAR_W, Math.floor(i / columns) * CHAR_H);
      }
    }

    function resize() {
      if (!canvas || !parent || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = parent.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      seed(rect.width, rect.height);
      draw();
    }

    function scramble() {
      const count = Math.max(1, Math.floor(letters.length * 0.05));
      for (let i = 0; i < count; i++) {
        const l = letters[Math.floor(Math.random() * letters.length)];
        if (!l) continue;
        l.char = randomChar();
        l.target = randomColor();
        if (props.current.smooth) {
          /*
           * The fade's origin is captured here, as components.
           *
           * The published version re-parses `letter.color` as hex on every
           * frame of the fade — but after the first frame that field holds
           * "rgb(…)", which the hex regex cannot match, so it returns null and
           * the interpolation silently stops. The letter jumps five percent
           * towards its new colour and then sticks there until the next
           * scramble. `smooth` therefore does almost nothing upstream.
           */
          l.start = l.color;
          l.progress = 0;
        } else {
          l.color = l.target;
          l.start = l.target;
          l.progress = 1;
        }
      }
    }

    function fade() {
      let moved = false;
      for (const l of letters) {
        if (l.progress >= 1) continue;
        l.progress = Math.min(1, l.progress + 0.05);
        l.color = mix(l.start, l.target, l.progress);
        moved = true;
      }
      return moved;
    }

    function tick() {
      const now = performance.now();
      let dirty = false;

      if (now - lastGlitch >= props.current.glitchSpeed) {
        scramble();
        lastGlitch = now;
        dirty = true;
      }
      if (props.current.smooth && fade()) dirty = true;
      if (dirty) draw();

      frame = requestAnimationFrame(tick);
    }

    function start() {
      cancelAnimationFrame(frame);
      /* A static field still reads as a backdrop; it simply does not move. */
      if (stillness.matches) { draw(); return; }
      frame = requestAnimationFrame(tick);
    }

    resize();
    start();

    /* Observing the parent rather than the window: the shell can change size
       without the viewport doing so, and a canvas sized to a stale box leaves
       a band of blank black down one edge. */
    let debounce: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => { resize(); start(); }, 100);
    });
    observer.observe(parent);

    /* Nothing is gained by scrambling letters in a background tab, and a
       pinned sign-in page would otherwise hold a core busy indefinitely. */
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(frame);
      else { lastGlitch = performance.now(); start(); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    stillness.addEventListener('change', start);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(debounce);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      stillness.removeEventListener('change', start);
    };
  }, []);

  const cover: React.CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none',
  };

  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#000', overflow: 'hidden' }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {outerVignette && (
        <div style={{ ...cover, background: 'radial-gradient(circle, rgba(0,0,0,0) 60%, rgba(0,0,0,1) 100%)' }} />
      )}
      {centerVignette && (
        <div style={{ ...cover, background: 'radial-gradient(circle, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 60%)' }} />
      )}
    </div>
  );
}
