/** Themes the seat ships with — each is a CSS file keyed by `data-theme`. */
export interface ThemeOption {
  id: string;
  label: string;
  note: string;
}

export const THEMES: ThemeOption[] = [
  { id: 'dark', label: 'Dark', note: 'Deep charcoal with amber highlights' },
  { id: 'light', label: 'Parchment', note: 'Warm sepia light' },
  { id: 'calm', label: 'Calm', note: 'Tranquil light — soft blue & violet' },
];

export const DEFAULT_THEME = 'dark';

/** Apply a theme by writing `data-theme` on <html> (Phosphorstrap contract). */
export function applyTheme(id: string): void {
  document.documentElement.dataset['theme'] = id;
}
