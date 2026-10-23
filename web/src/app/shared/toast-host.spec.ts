import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { EN } from '../core/i18n';
import { StatusService } from '../core/status.service';
import { ToastHost } from './toast-host';

describe('ToastHost', () => {
  it('labels the dismiss control from the catalog', () => {
    TestBed.configureTestingModule({ imports: [ToastHost] });
    const status = TestBed.inject(StatusService);
    status.flash('saved');
    try {
      const fixture = TestBed.createComponent(ToastHost);
      fixture.detectChanges();
      const button = fixture.nativeElement.querySelector('.toast-stack__dismiss') as HTMLElement;
      expect(button.getAttribute('aria-label')).toBe(EN['shell.dismiss']);
    } finally {
      status.clear();
    }
  });
});
