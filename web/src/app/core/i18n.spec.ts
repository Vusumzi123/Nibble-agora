import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import {
  CATALOGS,
  DEFAULT_LOCALE,
  EN,
  ES,
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
    expect(LOCALES.map((l) => l.id)).toEqual(['en', 'es']);
    for (const locale of LOCALES) expect(EN).toBeDefined();
  });

  it('lists Spanish and selects it through setLocale', () => {
    const i18n = service();
    expect(LOCALES.find((l) => l.id === 'es')?.label).toBe('Español');
    i18n.setLocale('es');
    expect(i18n.locale()).toBe('es');
    expect(i18n.t('shell.save')).toBe('guardar');
    expect(i18n.t('threads.title')).toBe('hilos');
    expect(i18n.t('threads.viewsCount', { count: 12345 })).toBe('12.345 vistas');
  });

  it('falls back to English for keys missing from the es catalog', () => {
    const i18n = service();
    i18n.setLocale('es');
    expect(i18n.t('threads.missing')).toBe('threads.missing');
    expect(i18n.t('shell.empty')).not.toBe(EN['shell.empty']);
  });

  it('seeds every EN key with a Spanish value', () => {
    const missing = Object.keys(EN).filter((key) => !(key in CATALOGS['es']));
    expect(missing).toEqual([]);
    expect(CATALOGS['es']['shell.cancel']).toBe('cancelar');
    expect(CATALOGS['es']['common.pageOf']).toBe('página {page} de {total}');
  });
});

describe('number formatting', () => {
  it('formats through Intl and guards missing values', () => {
    const i18n = service();
    expect(i18n.number(1234)).toBe('1,234');
    expect(i18n.number(0)).toBe('0');
    expect(i18n.number(null)).toBe('');
    expect(i18n.number(Number.NaN)).toBe('');
  });

  it('formats numeric t() params, not just counts in prose', () => {
    const i18n = service();
    expect(i18n.t('threads.viewsCount', { count: 1234 })).toBe('1,234 views');
    expect(i18n.t('common.pageOf', { page: 2, total: 1000 })).toBe('page 2 of 1,000');
  });
});

describe('catalog key coverage', () => {
  it('ships exactly one catalog per selectable locale', () => {
    expect(Object.keys(CATALOGS).sort()).toEqual(LOCALES.map((l) => l.id).sort());
  });

  it('every EN key is translated in every locale', () => {
    expect(ES).toBeDefined();
    for (const locale of LOCALES) {
      const catalog = CATALOGS[locale.id];
      expect(catalog, `no catalog for ${locale.id}`).toBeDefined();
      const missing = Object.keys(EN).filter((key) => !(key in catalog));
      expect(missing, `missing ${locale.id} keys: ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('every locale key exists in EN, so nothing is silently orphaned', () => {
    for (const locale of LOCALES) {
      const extras = Object.keys(CATALOGS[locale.id]).filter((key) => !(key in EN));
      expect(extras, `stray ${locale.id} keys: ${extras.join(', ')}`).toEqual([]);
    }
  });

  it('has no blank translations', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim(), `${locale}.${key}`).not.toBe('');
      }
    }
  });
});
