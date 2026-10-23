import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { EN } from '../core/i18n';
import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog', () => {
  it('renders translated default labels from the catalog', () => {
    TestBed.configureTestingModule({ imports: [ConfirmDialog] });
    const catalog = EN as Record<string, string>;
    const previous = catalog['shell.keep'];
    catalog['shell.keep'] = 'KEEP_X';
    try {
      const fixture = TestBed.createComponent(ConfirmDialog);
      fixture.componentRef.setInput('message', 'delete this card?');
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('.ph-panel__header')!.textContent).toContain(EN['shell.confirm']);
      expect(root.querySelector('.btn-outline-secondary')!.textContent).toContain('KEEP_X');
      expect(root.querySelector('.btn-danger')!.textContent).toContain(EN['shell.delete']);
    } finally {
      catalog['shell.keep'] = previous;
    }
  });

  it('honours explicit labels when the caller passes them', () => {
    TestBed.configureTestingModule({ imports: [ConfirmDialog] });
    const fixture = TestBed.createComponent(ConfirmDialog);
    fixture.componentRef.setInput('title', 'delete card');
    fixture.componentRef.setInput('message', 'delete this card?');
    fixture.componentRef.setInput('confirmLabel', 'remove');
    fixture.componentRef.setInput('cancelLabel', 'keep it');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.ph-panel__header')!.textContent).toContain('delete card');
    expect(root.querySelector('.btn-danger')!.textContent).toContain('remove');
    expect(root.querySelector('.btn-outline-secondary')!.textContent).toContain('keep it');
  });
});
