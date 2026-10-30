import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForumStore } from '../core/forum.store';
import { EN, ES, TranslateService } from '../core/i18n';
import type { Inbox } from '../core/models';
import { StatusService } from '../core/status.service';
import { InboxPage } from './inbox/inbox';
import { LoginPage } from './login/login';
import { SettingsPage } from './settings/settings';
import { SetupPage } from './setup/setup';

const INBOX: Inbox = {
  handle: 'kael',
  is_human: false,
  mentions: [
    {
      mention_id: 1,
      post_id: 10,
      body: 'unread one',
      created_at: '2026-10-17T00:00:00.000Z',
      read_at: null,
      thread_id: 5,
      thread_title: 'unread thread',
      thread_status: 'open',
      author: 'root',
    },
    {
      mention_id: 2,
      post_id: 9,
      body: 'read one',
      created_at: '2026-10-16T00:00:00.000Z',
      read_at: '2026-10-16T12:00:00.000Z',
      thread_id: 4,
      thread_title: 'read thread',
      thread_status: 'open',
      author: 'root',
    },
  ],
  cards: [],
  counts: { mentions: 1, mentions_total: 2, cards: 0 },
};

/** Inbox, settings, login and setup speak Spanish; validation/flash strings come from t(). */
describe('Spanish inbox, settings and auth views', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(TranslateService).setLocale('es');
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  it('renders settings with Spanish copy and no raw keys', () => {
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain(ES['settings.title']);
    expect(text).toContain(ES['settings.appearance']);
    expect(text).toContain(ES['settings.password']);
    expect(text).toContain('Español');
    expect(text).not.toMatch(/settings\.[a-zA-Z]/);
    expect(ES['settings.password']).not.toBe(EN['settings.password']);
  });

  it('resolves settings validation flashes through t() in es', async () => {
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    const flash = vi.spyOn(TestBed.inject(StatusService), 'flash');
    const page = fixture.componentInstance as unknown as Record<string, unknown>;
    const savePassword = page['savePassword'] as () => Promise<void>;

    page['next'] = 'short';
    await savePassword.call(page);
    expect(flash).toHaveBeenLastCalledWith(ES['settings.passwordTooShort'], true);

    page['next'] = 'longenough1';
    page['confirm'] = 'different1';
    await savePassword.call(page);
    expect(flash).toHaveBeenLastCalledWith(ES['settings.passwordMismatch'], true);
  });

  it('renders the login gate in Spanish', () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain(ES['login.submit']);
    expect(text).toContain(ES['login.note']);
    const labels = [...el.querySelectorAll('label.field .ph-label')].map((n) => n.textContent!.trim());
    expect(labels).toEqual([ES['login.handle'], ES['login.password']]);
    expect(text).not.toMatch(/login\.[a-zA-Z]/);
  });

  it('renders setup in Spanish and keys its validation flashes', async () => {
    const fixture = TestBed.createComponent(SetupPage);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent ?? '').toContain(ES['setup.title']);
    expect(el.querySelector('#setup-submit')?.textContent).toContain(ES['setup.submit']);
    expect(el.textContent ?? '').not.toMatch(/setup\.[a-zA-Z]/);

    const flash = vi.spyOn(TestBed.inject(StatusService), 'flash');
    const page = fixture.componentInstance as unknown as Record<string, unknown>;
    const submit = page['submit'] as () => Promise<void>;

    page['handle'] = '   ';
    await submit.call(page);
    expect(flash).toHaveBeenLastCalledWith(ES['setup.handleRequired'], true);

    page['handle'] = 'admin';
    page['password'] = 'short';
    await submit.call(page);
    expect(flash).toHaveBeenLastCalledWith(ES['setup.passwordTooShort'], true);
  });

  it('renders the inbox counts and actions in Spanish', () => {
    const store = TestBed.inject(ForumStore);
    store.inbox.set(INBOX);

    const fixture = TestBed.createComponent(InboxPage);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain(ES['inbox.unreadCount'].replace('{count}', '1'));
    expect(text).toContain(ES['inbox.mentionsCount'].replace('{count}', '2'));
    expect(el.querySelector('.inbox__readall')?.textContent).toContain(ES['inbox.markAllRead']);
    expect(text).not.toMatch(/inbox\.[a-zA-Z]/);
  });
});
