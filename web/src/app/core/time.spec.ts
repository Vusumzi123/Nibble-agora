import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { TranslateService } from './i18n';
import { WhenPipe, when } from './time';

describe('when formatting', () => {
  const iso = '2026-03-04T14:05:00.000Z';

  it('formats through Intl using the requested locale', () => {
    const en = when(iso, 'en');
    const de = when(iso, 'de');
    expect(en).toContain('Mar');
    expect(de).not.toBe(en);
    expect(de).not.toContain('Mar');
  });

  it('renders Spanish differently from English', () => {
    const en = when(iso, 'en');
    const es = when(iso, 'es');
    expect(es).not.toBe(en);
    expect(es).toContain('mar');
    expect(es).not.toContain('AM');
  });

  it('drives the WhenPipe from the active locale', () => {
    TestBed.configureTestingModule({});
    const i18n = TestBed.inject(TranslateService);
    const pipe = TestBed.runInInjectionContext(() => new WhenPipe());

    expect(pipe.transform(iso)).toBe(when(iso, 'en'));
    i18n.setLocale('es');
    expect(pipe.transform(iso)).toBe(when(iso, 'es'));
    expect(pipe.transform(iso)).not.toBe(when(iso, 'en'));
  });

  it('keeps empty and invalid input intact', () => {
    expect(when(null)).toBe('');
    expect(when('not-a-date', 'en')).toBe('not-a-date');
    expect(when('not-a-date', 'zz')).toBe('not-a-date');
  });
});
