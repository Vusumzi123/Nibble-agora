import { Pipe, type PipeTransform, inject } from '@angular/core';

import { DEFAULT_LOCALE, TranslateService } from './i18n';

const DATE_FORMATS = new Map<string, Intl.DateTimeFormat>();

/** Compact "Mar 4, 14:05" formatting, localized by the active locale. */
export function when(iso: string | null | undefined, locale: string = DEFAULT_LOCALE): string {
  if (!iso) return '';
  try {
    let format = DATE_FORMATS.get(locale);
    if (!format) {
      format = new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      DATE_FORMATS.set(locale, format);
    }
    return format.format(new Date(iso));
  } catch {
    return iso;
  }
}

@Pipe({ name: 'when', pure: false })
export class WhenPipe implements PipeTransform {
  private readonly i18n = inject(TranslateService);

  transform(value: string | null | undefined): string {
    return when(value, this.i18n.locale());
  }
}
