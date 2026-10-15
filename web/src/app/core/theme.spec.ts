import { describe, expect, it } from 'vitest';

import { THEMES, applyTheme } from './theme';

describe('theme registry', () => {
  it('ships dark, light and the calm theme', () => {
    const ids = THEMES.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['dark', 'light', 'calm']));
  });

  it('applies a theme by writing data-theme on <html>', () => {
    applyTheme('calm');
    expect(document.documentElement.dataset['theme']).toBe('calm');
    applyTheme('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });
});
