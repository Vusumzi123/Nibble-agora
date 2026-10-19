/**
 * The seat ships exactly two faces — light mode `nibble` and dark mode
 * `nibble-dark` — plus a choice of accent. There is no theme gallery:
 * the picker is "light or dark" + an accent, both persisted server-side
 * and applied through `data-theme` / `data-accent` on <html>
 * (the Phosphorstrap contract).
 */
export interface AccentOption {
  id: string;
  label: string;
  /** The accent's primary swatch — what the picker dot renders with. */
  hex: string;
}

export const LIGHT_THEME = 'nibble';
export const DARK_THEME = 'nibble-dark';

export const DEFAULT_THEME = LIGHT_THEME;
export const DEFAULT_ACCENT = 'violet';

/** Accent ids shown in setup + settings — keep in sync with themes/accents.css. */
export const ACCENTS: AccentOption[] = [
  { id: 'violet', label: 'violet', hex: '#6b7bd6' },
  { id: 'ocean', label: 'ocean', hex: '#3d8fd6' },
  { id: 'teal', label: 'teal', hex: '#1f9e9e' },
  { id: 'green', label: 'green', hex: '#3f9e5f' },
  { id: 'amber', label: 'amber', hex: '#c98a2b' },
  { id: 'rose', label: 'rose', hex: '#d65a86' },
];

/** A stored theme id the seat can render — anything else falls back. */
export const isKnownTheme = (id: string): boolean =>
  id === LIGHT_THEME || id === DARK_THEME;

/** Legacy or unknown ids (pre-nibble settings) normalize to the default. */
export const normalizeTheme = (id: string | undefined): string =>
  id !== undefined && isKnownTheme(id) ? id : DEFAULT_THEME;

/** The mode a theme id selects — the switch reads checked = light. */
export const isDarkTheme = (id: string): boolean => id === DARK_THEME;

/** Apply a theme by writing `data-theme` on <html> (Phosphorstrap contract). */
export function applyTheme(id: string): void {
  document.documentElement.dataset['theme'] = id;
}

/** Apply an accent by writing `data-accent` on <html>. */
export function applyAccent(id: string): void {
  document.documentElement.dataset['accent'] = id;
}
