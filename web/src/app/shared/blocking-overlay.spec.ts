import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { BusyService } from '../core/busy.service';
import { BlockingOverlay } from './blocking-overlay';

describe('BlockingOverlay', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BlockingOverlay] });
  });

  it('renders nothing while idle', () => {
    const fixture = TestBed.createComponent(BlockingOverlay);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.overlay--busy')).toBeNull();
  });

  it('covers the app with the busy label for the duration of a run', async () => {
    const busy = TestBed.inject(BusyService);
    let release!: () => void;
    const running = busy.run('posting reply', () => new Promise<void>((r) => (release = r)));
    const fixture = TestBed.createComponent(BlockingOverlay);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.overlay--busy')).toBeTruthy();
    expect(el.textContent).toContain('posting reply');

    release();
    await running;
    fixture.detectChanges();
    expect(el.querySelector('.overlay--busy')).toBeNull();
  });
});
