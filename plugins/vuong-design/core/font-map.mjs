// Which families Figma can render, and what to use instead for the rest (spec §7: the proxy renders with the font
// Figma will actually use, and every substitution is reported).
const FALLBACK = 'Inter';

const AVAILABLE = [
  'Be Vietnam Pro', 'Roboto', 'Inter', 'Material Symbols Rounded', 'Material Symbols Outlined', 'Material Icons',
  'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Nunito', 'Noto Sans', 'Source Sans 3', 'Work Sans', 'DM Sans',
  'Manrope', 'Raleway', 'Playfair Display', 'Merriweather', 'Roboto Mono', 'JetBrains Mono', 'Fira Code',
  'IBM Plex Sans', 'Space Grotesk', 'Plus Jakarta Sans', 'Quicksand', 'Rubik', 'Ubuntu', 'Oswald',
];

const clean = (f) => String(f).trim().replace(/^["']|["']$/g, '').trim();

export function defaultFontMap(extra = []) {
  const available = [...AVAILABLE, ...extra];
  const set = new Set(available.map((f) => f.toLowerCase()));
  return {
    available,
    // System fonts (Segoe UI, system-ui, -apple-system, ...) and anything unknown map to Inter.
    substitute(family) {
      const f = clean(family);
      const hit = available.find((a) => a.toLowerCase() === f.toLowerCase());
      return set.has(f.toLowerCase()) ? hit : FALLBACK;
    },
  };
}

// First family of a CSS font-family list (what Chrome renders when installed).
export const firstFamily = (list) => clean(String(list).split(',')[0]);

const SYSTEM = /^(segoe ui|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|cursive|fantasy|helvetica|helvetica neue|arial|sf pro[a-z ]*|san francisco)$/i;
export const isSystemFont = (family) => SYSTEM.test(clean(family));
export const isAvailable = (fontMap, family) => fontMap.available.some((a) => a.toLowerCase() === clean(family).toLowerCase());
