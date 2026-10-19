import { describe, expect, it } from 'vitest';

import {
  ACCENTS,
  DARK_THEME,
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  LIGHT_THEME,
  applyAccent,
  applyTheme,
  isDarkTheme,
  normalizeTheme,
} from './theme';

describe('theme registry', () => {
  it('ships exactly nibble (light) and nibble-dark', () => {
    expect(LIGHT_THEME).toBe('nibble');
    expect(DARK_THEME).toBe('nibble-dark');
    expect(DEFAULT_THEME).toBe(LIGHT_THEME);
    expect(isDarkTheme(DARK_THEME)).toBe(true);
    expect(isDarkTheme(LIGHT_THEME)).toBe(false);
  });

  it('lists six unique accents with hex swatches', () => {
    expect(ACCENTS.map((a) => a.id)).toEqual([
      'violet',
      'ocean',
      'teal',
      'green',
      'amber',
      'rose',
    ]);
    expect(new Set(ACCENTS.map((a) => a.hex)).size).toBe(ACCENTS.length);
    for (const accent of ACCENTS) expect(accent.hex).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_ACCENT).toBe('violet');
  });

  it('normalizes legacy ids to the default theme', () => {
    expect(normalizeTheme('calm')).toBe(DEFAULT_THEME);
    expect(normalizeTheme('dark')).toBe(DEFAULT_THEME);
    expect(normalizeTheme(DARK_THEME)).toBe(DARK_THEME);
    expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME);
  });

  it('applies theme and accent by writing data-theme / data-accent on <html>', () => {
    applyTheme(DARK_THEME);
    expect(document.documentElement.dataset['theme']).toBe('nibble-dark');
    applyTheme(LIGHT_THEME);
    expect(document.documentElement.dataset['theme']).toBe('nibble');
    applyAccent('teal');
    expect(document.documentElement.dataset['accent']).toBe('teal');
  });
});
