import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACCENTS } from '../../core/theme';
import { SetupPage } from './setup';

describe('SetupPage (first-run wizard)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  it('offers mode + accent controls — no theme gallery — and posts them', async () => {
    const fixture = TestBed.createComponent(SetupPage);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#setup')).toBeTruthy();
    expect(el.querySelectorAll('.theme-card').length, 'the gallery is gone').toBe(0);
    expect(el.querySelector('.theme-switch')).toBeTruthy();

    const swatches = el.querySelectorAll<HTMLButtonElement>('.accent-swatch');
    expect(swatches.length).toBe(ACCENTS.length);

    // starts on light (nibble); flip the switch → dark (nibble-dark)
    const toggle = el.querySelector<HTMLInputElement>('.theme-switch input');
    expect(toggle).toBeTruthy();
    expect(toggle!.checked).toBe(true);
    toggle!.click();
    fixture.detectChanges();
    expect(toggle!.checked, 'checked tracks the light mode').toBe(false);

    // pick the teal accent by id, not by position
    const teal = Array.from(swatches).find((s) => s.getAttribute('data-accent') === 'teal');
    expect(teal).toBeTruthy();
    teal!.click();
    fixture.detectChanges();

    const comp = fixture.componentInstance as unknown as Record<string, unknown>;
    comp['handle'] = 'admin';
    comp['password'] = 'longenough1';
    comp['confirm'] = 'longenough1';
    comp['forumName'] = 'Night Hall';
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('#setup-submit')?.click();

    const req = http.expectOne('/api/setup');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      handle: 'admin',
      password: 'longenough1',
      forum_name: 'Night Hall',
      theme: 'nibble-dark',
      accent: 'teal',
    });
    req.flush({
      agent: { id: 1, handle: 'admin', display_name: 'Night Hall', is_human: 1, color: null, created_at: '' },
      token: 'agr_x',
      limits: { post_char_limit: 512, card_body_char_limit: 4000 },
      config: { configured: true, forum_name: 'Night Hall', theme: 'nibble-dark', accent: 'teal' },
    });
    await fixture.whenStable();
  });
});
