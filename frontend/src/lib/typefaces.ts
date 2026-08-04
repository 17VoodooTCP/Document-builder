/**
 * Typefaces, and the foils.
 *
 * ── Why every stack is fonts already on the machine ───────────────────────
 *
 * Nothing here is fetched. A webfont is one network request between a document
 * and its own letterhead: it fails on a locked-down corporate network, it fails
 * offline, and — the one that matters — html2canvas captures whatever is loaded
 * at the moment the PDF is generated, so a font that arrives late produces an
 * export set in Times that the preview never showed. Local families render the
 * same in the preview, in the PDF and on paper.
 *
 * The trade is that a stack falls back per platform. Each is ordered so the
 * substitute is a near relative rather than a genre change.
 */

export interface Typeface {
  label: string;
  /** Where it is actually used. Not decoration — it is how somebody chooses. */
  note: string;
  /** Body copy, headings, the recipient's name. */
  body: string;
  /** Small caps labels, the header rule, the footer grid. */
  chrome: string;
}

/* A neutral grotesque for labels, shared by the serif choices. Labels are read
   as furniture rather than as text, and a second display face fighting the body
   is what makes a document look assembled rather than printed. */
const LABEL_SANS = '"Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif';

export const TYPEFACES: Record<string, Typeface> = {
  times: {
    label: 'Times New Roman',
    note: 'US federal filings and court documents. The default nobody is surprised by.',
    body: '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif',
    chrome: LABEL_SANS,
  },
  century: {
    label: 'Century Schoolbook',
    note: 'Required by the US Supreme Court for briefs. Wide, and unusually legible at small sizes.',
    body: '"Century Schoolbook", "New Century Schoolbook", Century, "Century Schoolbook L", Georgia, serif',
    chrome: LABEL_SANS,
  },
  garamond: {
    label: 'Garamond',
    note: 'European institutions and formal correspondence. Lighter on the page than Times.',
    body: 'Garamond, "EB Garamond", "Adobe Garamond Pro", "Apple Garamond", "Times New Roman", serif',
    chrome: LABEL_SANS,
  },
  cambria: {
    label: 'Cambria',
    note: 'Widely used across government departments running Microsoft Office. Sturdy when printed.',
    body: 'Cambria, "Hoefler Text", Constantia, Georgia, serif',
    chrome: LABEL_SANS,
  },
  palatino: {
    label: 'Palatino',
    note: 'Academic and diplomatic documents. Calligraphic, and reads as considered.',
    body: '"Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", Georgia, serif',
    chrome: LABEL_SANS,
  },
  georgia: {
    label: 'Georgia',
    note: 'Corporate reporting. Drawn for screens, which is where most documents are now read.',
    body: 'Georgia, Cambria, "Times New Roman", serif',
    chrome: LABEL_SANS,
  },
  helvetica: {
    label: 'Helvetica / Arial',
    note: 'The Swiss corporate standard. Neutral to the point of having no opinion at all.',
    body: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif',
    chrome: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  segoe: {
    label: 'Segoe UI',
    note: 'Microsoft house face, and by inheritance a great many corporate templates.',
    body: '"Segoe UI", Frutiger, "Frutiger Linotype", Tahoma, sans-serif',
    chrome: '"Segoe UI", Tahoma, sans-serif',
  },
};

export const DEFAULT_TYPEFACE = 'times';

export const typeface = (key: string): Typeface => TYPEFACES[key] || TYPEFACES[DEFAULT_TYPEFACE];

/* ── Foils ────────────────────────────────────────────────────────────────
 *
 * The band under the letterhead, printed as a diffraction foil.
 *
 * On real stationery this is a hot-stamped strip that shifts colour with the
 * viewing angle. Paper cannot do that and neither can a PDF, so what is drawn
 * is the *appearance* of one from a fixed angle: a banded gradient through the
 * hues a foil sweeps, with lettering knocked into it.
 *
 * That is a printing convention and not a claim. It is worth being exact about
 * the difference: the strip is as elaborate as the design wants, and no
 * sentence anywhere on the document says the strip was verified, because
 * nothing verifies it.
 */

export interface Foil {
  label: string;
  note: string;
  /** Ordered hues the band sweeps through. */
  stops: string[];
  /** Lettering struck into the band. */
  text: string;
  /** A darker relative of the band, for the hairlines above and below it. */
  edge: string;
}

export const FOILS: Record<string, Foil> = {
  'purple-gold': {
    label: 'Purple & gold',
    note: 'The combination most often stamped on passports, degrees and share certificates.',
    stops: ['#3B0764', '#6D28D9', '#A855F7', '#E9D5FF', '#F5D061', '#B8860B', '#7C3AED', '#4C1D95'],
    text: '#1E1035',
    edge: '#4C1D95',
  },
  gold: {
    label: 'Gold',
    note: 'A single hot-stamped gold. Quieter, and the most common on official letterheads.',
    stops: ['#7A5C00', '#B8860B', '#E3BC4E', '#FFF3B0', '#E3BC4E', '#B8860B', '#8C6A0A', '#C9A227'],
    text: '#3D2E00',
    edge: '#8C6A0A',
  },
  silver: {
    label: 'Silver',
    note: 'Holographic silver, as used on identity cards and banknote threads.',
    stops: ['#4B5563', '#9CA3AF', '#E5E7EB', '#FFFFFF', '#CBD5E1', '#94A3B8', '#64748B', '#334155'],
    text: '#1F2937',
    edge: '#64748B',
  },
  'emerald-gold': {
    label: 'Emerald & gold',
    note: 'Banknote green shot through with gold. Reads as treasury rather than corporate.',
    stops: ['#064E3B', '#047857', '#34D399', '#D1FAE5', '#F5D061', '#B8860B', '#065F46', '#022C22'],
    text: '#052E22',
    edge: '#065F46',
  },
  copper: {
    label: 'Copper & rose',
    note: 'Warmer, and less common — which is its own argument for using it.',
    stops: ['#7C2D12', '#C2410C', '#FB923C', '#FFE4D6', '#F5D061', '#B45309', '#9A3412', '#7C2D12'],
    text: '#431407',
    edge: '#9A3412',
  },
};

export const DEFAULT_FOIL = 'purple-gold';

export const foil = (key: string): Foil => FOILS[key] || FOILS[DEFAULT_FOIL];
