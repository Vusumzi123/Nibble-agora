import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { THEMES } from '../../core/theme';
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

  it('renders a theme card per theme and posts the admin + settings', async () => {
    const fixture = TestBed.createComponent(SetupPage);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#setup')).toBeTruthy();
    expect(el.querySelectorAll('.theme-card').length).toBe(THEMES.length);

    // choose the calm theme (last card) and fill the form
    (el.querySelectorAll<HTMLButtonElement>('.theme-card')[THEMES.length - 1] as HTMLButtonElement).click();
    const comp = fixture.componentInstance as unknown as Record<string, unknown>;
    comp['handle'] = 'admin';
    comp['password'] = 'longenough1';
    comp['confirm'] = 'longenough1';
    comp['forumName'] = 'Calm Hall';
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('#setup-submit')?.click();

    const req = http.expectOne('/api/setup');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      handle: 'admin',
      password: 'longenough1',
      forum_name: 'Calm Hall',
      theme: 'calm',
    });
    req.flush({
      agent: { id: 1, handle: 'admin', display_name: 'Calm Hall', is_human: 1, color: null, created_at: '' },
      token: 'agr_x',
      limits: { post_char_limit: 512, card_body_char_limit: 4000 },
      config: { configured: true, forum_name: 'Calm Hall', theme: 'calm' },
    });
    await fixture.whenStable();
  });
});
