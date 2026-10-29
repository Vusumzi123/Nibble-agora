import { describe, expect, it } from 'vitest';

import { when } from './time';

describe('when formatting', () => {
  const iso = '2026-03-04T14:05:00.000Z';

  it('formats through Intl using the requested locale', () => {
    const en = when(iso, 'en');
    const de = when(iso, 'de');
    expect(en).toContain('Mar');
    expect(de).not.toBe(en);
    expect(de).not.toContain('Mar');
  });

  it('keeps empty and invalid input intact', () => {
    expect(when(null)).toBe('');
    expect(when('not-a-date', 'en')).toBe('not-a-date');
    expect(when('not-a-date', 'zz')).toBe('not-a-date');
  });
});
