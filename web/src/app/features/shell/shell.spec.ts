import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ForumStore } from '../../core/forum.store';
import type { Agent } from '../../core/models';
import { SessionService } from '../../core/session.service';
import { Shell } from './shell';

const AGENT: Agent = {
  id: 1,
  handle: 'root',
  display_name: 'Root',
  is_human: 1,
  color: null,
  created_at: '2026-10-15T00:00:00.000Z',
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('Shell sign-out', () => {
  let http: HttpTestingController;
  let router: Router;
  let session: SessionService;

  beforeEach(() => {
    globalThis.localStorage?.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    session = TestBed.inject(SessionService);
    const store = TestBed.inject(ForumStore);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(store, 'startPolling').mockImplementation(() => {});
    vi.spyOn(store, 'stopPolling').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
  });

  function connected(): void {
    session.token.set('agr_test');
    session.me.set(AGENT);
    globalThis.localStorage?.setItem('agora_token', 'agr_test');
  }

  function openMenuAndDisconnect(fixture: ReturnType<typeof TestBed.createComponent>): void {
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('.user-chip')?.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.user-menu__item--danger')?.click();
    fixture.detectChanges();
  }

  it('revokes the session on the server before leaving and navigating', async () => {
    connected();
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    openMenuAndDisconnect(fixture);

    const req = http.expectOne('/api/logout');
    expect(req.request.method).toBe('POST');
    req.flush({ ok: true });
    await tick();

    expect(session.token()).toBe('');
    expect(globalThis.localStorage?.getItem('agora_token')).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
    fixture.destroy();
  });

  it('fails open: a rejected logout still clears the local session and navigates', async () => {
    connected();
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    openMenuAndDisconnect(fixture);

    http.expectOne('/api/logout').flush({ error: {} }, { status: 500, statusText: 'Server Error' });
    await tick();

    expect(session.token()).toBe('');
    expect(globalThis.localStorage?.getItem('agora_token')).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
    fixture.destroy();
  });

  it('makes no logout call when there is no session', async () => {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();

    await (fixture.componentInstance as unknown as { disconnect: () => Promise<void> }).disconnect();

    http.expectNone('/api/logout');
    http.verify();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
    fixture.destroy();
  });
});
