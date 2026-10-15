// Tailwind is compiled at build time (it used to run from cdn.tailwindcss.com,
// building the CSS inside every browser on every load: slower start, a flash
// of unstyled page, constant work on wall TVs, and an unstyled app whenever
// that CDN couldn't be reached). Same version (3.4.17) and theme as the CDN.
//
// Only real source folders are scanned — there is an old nested copy of the
// repo in SC-PROJECT-TRACKER-main/ that must not be picked up. Class names must
// be written out in full in the source (no `bg-${color}-500`), or they won't
// be generated.
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './*.tsx',
    './components/**/*.{ts,tsx}',
    './views/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './backend/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: { zinc: { 950: '#09090b' } },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
