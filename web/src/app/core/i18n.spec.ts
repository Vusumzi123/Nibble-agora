import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  EN,
  LOCALES,
  TranslateService,
  normalizeLocale,
} from './i18n';

function service(): TranslateService {
  TestBed.configureTestingModule({});
  return TestBed.inject(TranslateService);
}

describe('i18n translate service', () => {
  it('starts on English with the catalog exposed', () => {
    const i18n = service();
    expect(i18n.locale()).toBe(DEFAULT_LOCALE);
    expect(i18n.t('shell.save')).toBe('save');
    expect(i18n.t('board.inProgress')).toBe(EN['board.inProgress']);
  });

  it('interpolates params and leaves unknown placeholders intact', () => {
    const i18n = service();
    expect(i18n.t('common.pageOf', { page: 2, total: 5 })).toBe('page 2 of 5');
    expect(i18n.t('common.pageOf', { page: 1 })).toBe('page 1 of {total}');
  });

  it('falls back to English for unknown keys and unknown locales', () => {
    const i18n = service();
    expect(i18n.t('threads.missing')).toBe('threads.missing');
    i18n.setLocale('zz');
    expect(i18n.locale()).toBe(DEFAULT_LOCALE);
    expect(i18n.t('shell.save')).toBe('save');
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  it('ships only catalogued locales', () => {
    expect(LOCALES.map((l) => l.id)).toEqual(['en']);
    for (const locale of LOCALES) expect(EN).toBeDefined();
  });
});
