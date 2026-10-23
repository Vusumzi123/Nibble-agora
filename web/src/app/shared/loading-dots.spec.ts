import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { EN } from '../core/i18n';
import { LoadingDots } from './loading-dots';

describe('LoadingDots', () => {
  it('falls back to the translated loading label', () => {
    TestBed.configureTestingModule({ imports: [LoadingDots] });
    const fixture = TestBed.createComponent(LoadingDots);
    fixture.detectChanges();
    const dots = fixture.nativeElement.querySelector('.dots') as HTMLElement;
    expect(dots.getAttribute('aria-label')).toBe(EN['shell.loading']);
  });

  it('keeps an explicit label when one is passed', () => {
    TestBed.configureTestingModule({ imports: [LoadingDots] });
    const fixture = TestBed.createComponent(LoadingDots);
    fixture.componentRef.setInput('label', 'loading threads');
    fixture.detectChanges();
    const dots = fixture.nativeElement.querySelector('.dots') as HTMLElement;
    expect(dots.getAttribute('aria-label')).toBe('loading threads');
  });
});
