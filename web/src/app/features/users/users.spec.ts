import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { routes } from '../../app.routes';
import { ApiError, ApiService } from '../../core/api.service';
import { ForumStore } from '../../core/forum.store';
import { EN } from '../../core/i18n';
import type { Agent } from '../../core/models';
import { StatusService } from '../../core/status.service';
import { UsersPage } from './users';

function seat(id: number, handle: string, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    handle,
    display_name: `${handle} display`,
    is_human: 1,
    color: '#336699',
    created_at: '2026-10-30T00:00:00.000Z',
    disabled_at: null,
    ...extra,
  };
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(): void {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('UsersPage directory list', () => {
  let ioStub: typeof IntersectionObserver | undefined;

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    ioStub = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver =
      FakeIntersectionObserver as unknown as typeof IntersectionObserver;

    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    if (ioStub) globalThis.IntersectionObserver = ioStub;
    vi.useRealTimers();
  });

  function render() {
    const store = TestBed.inject(ForumStore);
    vi.spyOn(store, 'loadUsers').mockResolvedValue(undefined);
    const fixture = TestBed.createComponent(UsersPage);
    fixture.detectChanges();
    return { fixture, store, component: fixture.componentInstance };
  }

  it('renders rows with handle, name and badges, and emits the selected seat', () => {
    const { fixture, store, component } = render();
    store.users.set([
      seat(1, 'ana'),
      seat(2, 'bo', { is_human: 0, disabled_at: '2026-10-31T00:00:00.000Z' }),
    ]);
    store.usersTotal.set(2);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll<HTMLButtonElement>('.users__row');
    expect(rows.length).toBe(2);
    expect(rows[0]?.textContent).toContain('@ana');
    expect(rows[0]?.textContent).toContain('ana display');
    expect(rows[0]?.textContent).toContain(EN['users.human']);
    expect(rows[1]?.textContent).toContain(EN['users.agent']);
    expect(rows[1]?.textContent).toContain(EN['users.disabled']);

    let selected: Agent | undefined;
    component.agentSelected.subscribe((agent) => (selected = agent));
    rows[0]?.click();
    expect(selected?.handle).toBe('ana');
  });

  it('debounces typing into one store query, including the clear', () => {
    vi.useFakeTimers();
    const { fixture, store } = render();
    const setQuery = vi.spyOn(store, 'setUsersQuery').mockImplementation(() => {});

    const input = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'ka';
    input.dispatchEvent(new Event('input'));
    input.value = 'kae';
    input.dispatchEvent(new Event('input'));
    input.value = 'kael';
    input.dispatchEvent(new Event('input'));

    vi.advanceTimersByTime(299);
    expect(setQuery).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setQuery).toHaveBeenCalledTimes(1);
    expect(setQuery).toHaveBeenCalledWith('kael');

    input.value = '';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(setQuery).toHaveBeenLastCalledWith('');
  });

  it('loads page two when the sentinel intersects and stops at the total', async () => {
    const { fixture, store } = render();
    store.users.set([seat(1, 'ana'), seat(2, 'bo')]);
    store.usersTotal.set(3);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.users__row')).toBeTruthy();

    const loadUsers = vi.spyOn(store, 'loadUsers').mockImplementation(async () => {
      store.users.set([seat(1, 'ana'), seat(2, 'bo'), seat(3, 'cy')]);
      store.usersTotal.set(3);
    });

    FakeIntersectionObserver.instances[0]?.trigger();
    await settle();

    expect(loadUsers).toHaveBeenCalled();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.users__row').length).toBe(3);
    expect(store.hasMoreUsers()).toBe(false);
  });

  it('distinguishes an empty directory from an empty search', () => {
    const { fixture, store } = render();
    store.users.set([]);
    store.usersTotal.set(0);
    fixture.detectChanges();
    let el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain(EN['users.empty']);

    store.setUsersQuery('zzz');
    store.users.set([]);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain(EN['users.noMatch']);
  });

  it('is mounted as an ungated shell child route at /users', () => {
    const shell = routes.find((route) => route.path === '' && route.children);
    const users = shell?.children?.find((route) => route.path === 'users');

    expect(users?.component).toBe(UsersPage);
    expect(users?.canActivate).toBeUndefined();
  });
});

describe('UsersPage create-user modal', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function render() {
    const store = TestBed.inject(ForumStore);
    const api = TestBed.inject(ApiService);
    vi.spyOn(store, 'loadUsers').mockResolvedValue(undefined);
    const fixture = TestBed.createComponent(UsersPage);
    fixture.detectChanges();
    return { fixture, store, api, el: fixture.nativeElement as HTMLElement };
  }

  function openForm(el: HTMLElement, fixture: { detectChanges(): void }): HTMLFormElement {
    el.querySelector<HTMLButtonElement>('.users__new')!.click();
    fixture.detectChanges();
    return el.querySelector<HTMLFormElement>('.users__modal-form')!;
  }

  function type(el: HTMLElement, name: string, value: string): HTMLInputElement {
    const input = el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    return input;
  }

  function submit(el: HTMLElement, fixture: { detectChanges(): void }): void {
    fixture.detectChanges();
    el.querySelector<HTMLFormElement>('.users__modal-form')!.dispatchEvent(new Event('submit'));
  }

  it('creates a seat and reveals the token and password exactly once', async () => {
    const { fixture, api, el } = render();
    const created = { ...seat(3, 'cy'), token: 'tok_once_123' };
    const create = vi.spyOn(api, 'createAgent').mockResolvedValue(created);

    openForm(el, fixture);
    await settle();
    fixture.detectChanges();
    type(el, 'handle', 'cy');
    type(el, 'displayName', 'Cy Seat');
    type(el, 'password', 'secret-pass');
    submit(el, fixture);
    await settle();
    fixture.detectChanges();

    expect(create).toHaveBeenCalledWith({
      handle: 'cy',
      display_name: 'Cy Seat',
      is_human: true,
      password: 'secret-pass',
    });
    expect(el.textContent).toContain('tok_once_123');
    expect(el.textContent).toContain('secret-pass');
    expect(el.querySelector('.users__modal-form')).toBeNull();
  });

  it('copies the token through the clipboard stub', async () => {
    const { fixture, api, el } = render();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(api, 'createAgent').mockResolvedValue({
      ...seat(3, 'cy'),
      token: 'tok_once_123',
    });

    openForm(el, fixture);
    await settle();
    fixture.detectChanges();
    type(el, 'handle', 'cy');
    type(el, 'displayName', 'Cy Seat');
    submit(el, fixture);
    await settle();
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('.users__secret-row button')!.click();
    await settle();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledWith('tok_once_123');
    expect(el.textContent).toContain(EN['users.copied']);
  });

  it('shows a 409 as an inline handle error and keeps the form data', async () => {
    const { fixture, api, el } = render();
    vi.spyOn(api, 'createAgent').mockRejectedValue(new ApiError('handle taken', 409));

    openForm(el, fixture);
    await settle();
    fixture.detectChanges();
    const handle = type(el, 'handle', 'cy');
    type(el, 'displayName', 'Cy Seat');
    submit(el, fixture);
    await settle();
    fixture.detectChanges();

    expect(el.textContent).toContain(EN['users.handleTaken']);
    expect(handle.value).toBe('cy');
    expect(el.querySelector('.users__credential')).toBeNull();
  });

  it('blocks an empty handle before calling the API', async () => {
    const { fixture, api, el } = render();
    const create = vi.spyOn(api, 'createAgent');

    openForm(el, fixture);
    await settle();
    fixture.detectChanges();
    type(el, 'displayName', 'Nobody');
    submit(el, fixture);
    fixture.detectChanges();

    expect(create).not.toHaveBeenCalled();
    expect(el.textContent).toContain(EN['users.handleRequired']);
  });

  it('discards the credential when the modal closes', async () => {
    const { fixture, api, el } = render();
    vi.spyOn(api, 'createAgent').mockResolvedValue({
      ...seat(3, 'cy'),
      token: 'tok_once_123',
    });

    openForm(el, fixture);
    await settle();
    fixture.detectChanges();
    type(el, 'handle', 'cy');
    type(el, 'displayName', 'Cy Seat');
    submit(el, fixture);
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('tok_once_123');

    el.querySelector<HTMLButtonElement>('.users__modal-actions .btn-primary')!.click();
    fixture.detectChanges();

    expect(el.querySelector('.users__credential')).toBeNull();
    el.querySelector<HTMLButtonElement>('.users__new')!.click();
    fixture.detectChanges();
    expect(el.textContent).not.toContain('tok_once_123');
    expect(el.querySelector('.users__modal-form')).toBeTruthy();
  });
});

describe('UsersPage detail modal', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function openDetail(agent: Agent = seat(7, 'ana')) {
    const store = TestBed.inject(ForumStore);
    const api = TestBed.inject(ApiService);
    const status = TestBed.inject(StatusService);
    vi.spyOn(store, 'loadUsers').mockResolvedValue(undefined);
    const fixture = TestBed.createComponent(UsersPage);
    fixture.detectChanges();
    store.users.set([agent]);
    store.usersTotal.set(1);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('.users__row')!.click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    return { fixture, store, api, status, el };
  }

  function setInput(el: HTMLElement, name: string, value: string): HTMLInputElement {
    const input = el.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    return input;
  }

  function submit(fixture: { detectChanges(): void }, el: HTMLElement, selector: string): void {
    fixture.detectChanges();
    el.querySelector<HTMLFormElement>(selector)!.dispatchEvent(new Event('submit'));
  }

  it('opens prefilled and saves edits through PATCH', async () => {
    const { fixture, api, el } = await openDetail();
    expect(el.querySelector<HTMLInputElement>('input[name="detailHandle"]')!.value).toBe('ana');
    expect(el.querySelector<HTMLInputElement>('input[name="detailColor"]')!.value).toBe('#336699');

    const update = vi
      .spyOn(api, 'updateAgent')
      .mockResolvedValue(seat(7, 'ana2', { display_name: 'Ana Two' }));
    setInput(el, 'detailHandle', 'ana2');
    setInput(el, 'detailDisplayName', 'Ana Two');
    submit(fixture, el, '.user-detail__form');
    await settle();
    fixture.detectChanges();

    expect(update).toHaveBeenCalledWith(7, {
      handle: 'ana2',
      display_name: 'Ana Two',
      color: '#336699',
    });
    expect(el.querySelector<HTMLInputElement>('input[name="detailHandle"]')!.value).toBe('ana2');
  });

  it('keeps the dialog open with an inline handle error on 409', async () => {
    const { fixture, api, el } = await openDetail();
    vi.spyOn(api, 'updateAgent').mockRejectedValue(new ApiError('handle taken', 409));

    setInput(el, 'detailHandle', 'taken');
    submit(fixture, el, '.user-detail__form');
    await settle();
    fixture.detectChanges();

    expect(el.querySelector('.user-detail__handle-error')?.textContent).toContain(
      EN['users.handleTaken'],
    );
    expect(el.querySelector('.user-detail')).toBeTruthy();
  });

  it('resets the password and reveals it once', async () => {
    const { fixture, api, el } = await openDetail();
    const reset = vi.spyOn(api, 'resetAgentPassword').mockResolvedValue(seat(7, 'ana'));

    el.querySelector<HTMLButtonElement>('.user-detail__reset')!.click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    setInput(el, 'newPassword', 'secret-pass');
    submit(fixture, el, '.user-detail__reset-form');
    await settle();
    fixture.detectChanges();

    expect(reset).toHaveBeenCalledWith(7, 'secret-pass');
    expect(el.querySelector('.user-detail__revealed')?.textContent).toContain('secret-pass');

    el.querySelector<HTMLButtonElement>('.overlay__card .btn-icon')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.user-detail')).toBeNull();
  });

  it('disables through the confirm dialog and offers restore', async () => {
    const { fixture, api, el } = await openDetail();
    const disable = vi
      .spyOn(api, 'disableAgent')
      .mockResolvedValue(seat(7, 'ana', { disabled_at: '2026-11-03T00:00:00.000Z' }));

    el.querySelector<HTMLButtonElement>('.user-detail__disable')!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain(EN['users.disableConfirm'].replace('{handle}', 'ana'));

    el.querySelector<HTMLButtonElement>('.confirm .btn-danger')!.click();
    await settle();
    fixture.detectChanges();

    expect(disable).toHaveBeenCalledWith(7);
    expect(el.querySelector('.user-detail__restore')).toBeTruthy();
  });

  it('restores a disabled seat and explains the follow-up', async () => {
    const { fixture, api, el } = await openDetail(
      seat(7, 'ana', { disabled_at: '2026-11-03T00:00:00.000Z' }),
    );
    const restore = vi.spyOn(api, 'restoreAgent').mockResolvedValue(seat(7, 'ana'));

    el.querySelector<HTMLButtonElement>('.user-detail__restore')!.click();
    await settle();
    fixture.detectChanges();

    expect(restore).toHaveBeenCalledWith(7);
    expect(el.textContent).toContain(EN['users.restoreHint']);
    expect(el.querySelector('.user-detail__disable')).toBeTruthy();
  });

  it('surfaces a failed save as a toast and keeps the dialog open', async () => {
    const { fixture, api, status, el } = await openDetail();
    const flash = vi.spyOn(status, 'flash');
    vi.spyOn(api, 'updateAgent').mockRejectedValue(new ApiError('boom', 500));

    submit(fixture, el, '.user-detail__form');
    await settle();
    fixture.detectChanges();

    expect(flash).toHaveBeenCalled();
    expect(el.querySelector('.user-detail')).toBeTruthy();
  });
});
