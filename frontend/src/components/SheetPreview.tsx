import { useEffect, useRef, useState } from 'react';

/**
 * The preview frame, with zoom.
 *
 * ── Why zoom had to exist ─────────────────────────────────────────────────
 *
 * The sheet is laid out in millimetres and must stay that way, so it is fitted
 * to its column with a transform rather than by reflowing. In a narrow editor
 * column that fit lands around half scale — and nine-point type at half scale
 * is four and a half point, which is genuinely unreadable. The document was
 * correct the whole time; the only way to read what you had written was to
 * zoom the whole browser, which then made the form unusable.
 *
 * So the fit is now the *default*, not the only option. Picking a zoom pins the
 * scale and lets the frame scroll, which is what every other document editor
 * does and what this one should have done from the start.
 */

const A4_W = 793.7;
const STEPS = [0.5, 0.75, 1, 1.5, 2];

export default function SheetPreview({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [height, setHeight] = useState(1122.5);
  /** null means "fit to the column" and follows the window; a number pins it. */
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    const outer = box.current;
    if (!outer) return;
    const measure = () => {
      setFit(Math.min(1, outer.clientWidth / A4_W));
      /* The stack when there is one, the single sheet otherwise, so a
         four-page agreement reserves the room for four pages. */
      const target = outer.querySelector<HTMLElement>('.sheet-stack')
        || outer.querySelector<HTMLElement>('.sheet');
      if (target) setHeight(target.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    const target = outer.querySelector('.sheet-stack') || outer.querySelector('.sheet');
    if (target) ro.observe(target);
    return () => ro.disconnect();
  }, []);

  const scale = zoom ?? fit;

  return (
    <div>
      <div className="no-print mb-2 flex items-center gap-1">
        <span className="ops-legend mr-1">Zoom</span>
        <button
          type="button"
          onClick={() => setZoom(null)}
          className={`rounded px-2 py-1 text-xs ${zoom === null ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800/60'}`}
        >
          Fit
        </button>
        {STEPS.map((z) => (
          <button
            key={z}
            type="button"
            onClick={() => setZoom(z)}
            className={`rounded px-2 py-1 text-xs tabular-nums ${zoom === z ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800/60'}`}
          >
            {z * 100}%
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] text-slate-500">
          {Math.round(scale * 100)}%
        </span>
      </div>

      {/* Scrolls once zoomed past the column. `overflow-x-auto` only — the page
          itself scrolls vertically, so a tall document does not end up inside a
          second scrollbar. */}
      <div ref={box} className="overflow-x-auto">
        <div style={{ height: `${height * scale}px`, width: `${A4_W * scale}px` }} className="sheet-fit">
          <div
            className="sheet-scale"
            style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: `${A4_W}px` }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
