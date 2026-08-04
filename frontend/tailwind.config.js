/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        /* The application chrome. Deliberately a system stack: the platform
           should not have a typographic personality that competes with the
           tenant identity rendered inside the sheet. */
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        /* Document copy. Serif on paper, as letters are. */
        serif: ['ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
        /* References, fingerprints, authorisation ids — anything meant to be
           compared character by character or read aloud over a phone. */
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
