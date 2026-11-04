import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent, Board, Card, ChangeEvent, Column, Inbox, Project } from './models';
import { BusyService } from './busy.service';
import { ForumStore } from './forum.store';

const COLUMNS: Column[] = [
  { id: 1, board_id: 7, name: 'todo', position: 0, wip_limit: null },
  { id: 2, board_id: 7, name: 'doing', position: 1, wip_limit: null },
];

const BOARD: Board = {
  id: 7,
  name: 'agora',
  slug: 'agora',
  description: null,
  created_by: 1,
  created_at: '2026-10-18T00:00:00.000Z',
  archived_at: null,
  project_id: null,
  columns: COLUMNS,
};

const CARD: Card = {
  id: 3,
  board_id: 7,
  column_id: 1,
  position: 0,
  title: 'ship it',
  body: '',
  assignee_id: null,
  created_by: 1,
  created_at: '2026-10-18T00:00:00.000Z',
  updated_at: '2026-10-18T00:00:00.000Z',
  done_at: null,
  blocked_at: null,
};

const project = (id: number, name: string, position: number): Project => ({
  id,
  name,
  slug: name.toLowerCase(),
  description: null,
  created_by: 1,
  created_at: '2026-10-18T00:00:00.000Z',
  archived_at: null,
  forum_id: 1,
  position,
  board_id: 7,
});

describe('ForumStore move/create curtains', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  async function settle(http: HttpTestingController): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
    http.expectOne('/api/forums').flush({ forums: [] });
  }

  it('blocks the curtain while creating a column', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    const busy = TestBed.inject(BusyService);
    store.view.set('settings');
    store.boardId.set(7);

    const creating = store.addColumn('doing');
    expect(busy.active()).toBe(true);
    expect(busy.label()).toBe('creating column');

    const req = http.expectOne('/api/boards/7/columns');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'doing' });
    req.flush({ column: COLUMNS[1] });

    await settle(http);
    await creating;
    expect(busy.active()).toBe(false);
  });

  it('blocks the curtain while reordering columns', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    const busy = TestBed.inject(BusyService);
    store.view.set('settings');
    store.boardId.set(7);
    store.boards.set([BOARD]);

    const moving = store.reorderColumn(1, 0, 1);
    expect(busy.active()).toBe(true);
    expect(busy.label()).toBe('moving column');

    const first = http.expectOne('/api/boards/7/columns');
    expect(first.request.body).toEqual({ id: 2, position: 0 });
    first.flush({ column: COLUMNS[1] });

    await new Promise((r) => setTimeout(r, 0));
    const second = http.expectOne('/api/boards/7/columns');
    expect(second.request.body).toEqual({ id: 1, position: 1 });
    second.flush({ column: COLUMNS[0] });

    await settle(http);
    await moving;
    expect(busy.active()).toBe(false);
  });

  it('blocks the curtain while saving project settings', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    const busy = TestBed.inject(BusyService);
    store.view.set('settings');
    store.boardId.set(7);

    const saving = store.updateBoardDetails('renamed', 'new description');
    expect(busy.active()).toBe(true);
    expect(busy.label()).toBe('saving project');

    const req = http.expectOne('/api/boards/7');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'renamed', description: 'new description' });
    req.flush({ board: BOARD, project: {} });

    await settle(http);
    await saving;
    expect(busy.active()).toBe(false);
  });

  it('blocks the curtain while deleting a project', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    const busy = TestBed.inject(BusyService);
    store.view.set('settings');

    const deleting = store.deleteBoard(7);
    expect(busy.active()).toBe(true);
    expect(busy.label()).toBe('deleting project');

    const req = http.expectOne('/api/boards/7');
    expect(req.request.method).toBe('DELETE');
    req.flush({ ok: true, id: 7 });

    await settle(http);
    await deleting;
    expect(busy.active()).toBe(false);
  });

  it('blocks the curtain while moving a card', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    const busy = TestBed.inject(BusyService);
    store.view.set('settings');

    const moving = store.moveCard(CARD, 2, 0);
    expect(busy.active()).toBe(true);
    expect(busy.label()).toBe('moving card');

    const req = http.expectOne('/api/cards/3');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ column_id: 2, position: 0 });
    req.flush({ card: { ...CARD, column_id: 2 } });

    await settle(http);
    await moving;
    expect(busy.active()).toBe(false);
  });

  it('reorders cards within a column by dense priority', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    const busy = TestBed.inject(BusyService);
    store.view.set('settings');
    const middle = { ...CARD, id: 4, position: 1, title: 'middle' };
    const last = { ...CARD, id: 5, position: 2, title: 'last' };
    store.cards.set([CARD, middle, last]);

    // drop the top card below the last one: [middle, last, CARD]
    const moving = store.moveCard(CARD, 1, 2);
    expect(busy.label()).toBe('moving card');

    const moved = http.expectOne('/api/cards/3');
    expect(moved.request.body).toEqual({ column_id: 1, position: 2 });
    moved.flush({ card: { ...CARD, position: 2 } });

    await new Promise((r) => setTimeout(r, 0));
    const first = http.expectOne('/api/cards/4');
    expect(first.request.body).toEqual({ position: 0 });
    first.flush({ card: { ...middle, position: 0 } });

    await new Promise((r) => setTimeout(r, 0));
    const second = http.expectOne('/api/cards/5');
    expect(second.request.body).toEqual({ position: 1 });
    second.flush({ card: { ...last, position: 1 } });

    await settle(http);
    await moving;
    expect(busy.active()).toBe(false);
    expect(store.focusedCardId()).toBe(CARD.id);
  });

  it('closes the priority gap left in the source column', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    store.view.set('settings');
    const gap = { ...CARD, id: 7, position: 2, title: 'gap' };
    const target = { ...CARD, id: 8, column_id: 2, position: 0, title: 'target' };
    store.cards.set([CARD, gap, target]);

    const moving = store.moveCard(CARD, 2, 1);

    const moved = http.expectOne('/api/cards/3');
    expect(moved.request.body).toEqual({ column_id: 2, position: 1 });
    moved.flush({ card: { ...CARD, column_id: 2, position: 1 } });

    await new Promise((r) => setTimeout(r, 0));
    const source = http.expectOne('/api/cards/7');
    expect(source.request.body).toEqual({ position: 0 });
    source.flush({ card: { ...gap, position: 0 } });

    await settle(http);
    await moving;
  });

  it('blocks the curtain while reordering projects', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    const busy = TestBed.inject(BusyService);
    store.view.set('settings');
    store.projects.set([project(1, 'one', 0), project(2, 'two', 1), project(3, 'three', 2)]);

    // move project 1 to the end
    const moving = store.reorderProject(1, 0, 2);
    expect(busy.active()).toBe(true);
    expect(busy.label()).toBe('moving project');

    const first = http.expectOne('/api/projects/2');
    expect(first.request.method).toBe('PATCH');
    expect(first.request.body).toEqual({ position: 0 });
    first.flush({ project: project(2, 'two', 0) });

    await new Promise((r) => setTimeout(r, 0));
    const second = http.expectOne('/api/projects/3');
    expect(second.request.body).toEqual({ position: 1 });
    second.flush({ project: project(3, 'three', 1) });

    await new Promise((r) => setTimeout(r, 0));
    const third = http.expectOne('/api/projects/1');
    expect(third.request.body).toEqual({ position: 2 });
    third.flush({ project: project(1, 'one', 2) });

    await settle(http);
    await moving;
    expect(busy.active()).toBe(false);
  });
});

describe('ForumStore live mention changes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('mention.delete marks the inbox dirty and refreshes it', async () => {
    vi.useFakeTimers();
    try {
      const store = TestBed.inject(ForumStore);
      store.session.me.set({ id: 6, handle: 'kael' } as Agent);
      const refresh = vi.spyOn(store, 'refreshInbox').mockResolvedValue(undefined);

      (store as unknown as { onChange: (event: ChangeEvent) => void }).onChange({
        id: 1,
        ts: '2026-10-30T00:00:00.000Z',
        actor_id: 6,
        action: 'mention.delete',
        target: null,
        payload: null,
      });
      await vi.advanceTimersByTimeAsync(200);

      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

const seat = (id: number, handle: string): Agent => ({
  id,
  handle,
  display_name: handle,
  is_human: 0,
  color: null,
  created_at: '2026-10-30T00:00:00.000Z',
  disabled_at: null,
});

describe('ForumStore users directory', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function page(agents: Agent[], total: number) {
    return { agents, total };
  }

  it('loads page one with the default window and disabled seats included', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);

    const loading = store.loadUsers({ reset: true });
    const req = http.expectOne('/api/agents?limit=20&offset=0&include_disabled=1');
    expect(req.request.method).toBe('GET');
    expect(req.request.urlWithParams).toBe(
      '/api/agents?limit=20&offset=0&include_disabled=1',
    );
    req.flush(page([seat(1, 'ana'), seat(2, 'bo')], 3));
    await loading;

    expect(store.users().map((a) => a.handle)).toEqual(['ana', 'bo']);
    expect(store.usersTotal()).toBe(3);
    expect(store.hasMoreUsers()).toBe(true);
    expect(store.usersLoadingMore()).toBe(false);
  });

  it('appends the next batch after the loading beat and stops at total', async () => {
    vi.useFakeTimers();
    try {
      const store = TestBed.inject(ForumStore);
      const http = TestBed.inject(HttpTestingController);
      store.users.set([seat(1, 'ana'), seat(2, 'bo')]);
      store.usersTotal.set(3);

      const loading = store.loadUsers();
      const req = http.expectOne('/api/agents?limit=40&offset=0&include_disabled=1');
      expect(store.usersLoadingMore()).toBe(true);
      req.flush(page([seat(1, 'ana'), seat(2, 'bo'), seat(3, 'cy')], 3));

      await vi.advanceTimersByTimeAsync(1100);
      await loading;

      expect(store.users()).toHaveLength(3);
      expect(store.hasMoreUsers()).toBe(false);
      expect(store.usersLoadingMore()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a query reset drops the stale in-flight window', async () => {
    vi.useFakeTimers();
    try {
      const store = TestBed.inject(ForumStore);
      const http = TestBed.inject(HttpTestingController);
      store.users.set([seat(1, 'ana'), seat(2, 'bo')]);
      store.usersTotal.set(5);

      const stale = store.loadUsers();
      const staleReq = http.expectOne('/api/agents?limit=40&offset=0&include_disabled=1');

      store.setUsersQuery('kael');
      expect(store.usersQuery()).toBe('kael');
      expect(store.usersLimit()).toBe(20);
      const freshReq = http.expectOne(
        '/api/agents?q=kael&limit=20&offset=0&include_disabled=1',
      );

      staleReq.flush(page([seat(9, 'old')], 40));
      freshReq.flush(page([seat(7, 'kael')], 1));
      await vi.advanceTimersByTimeAsync(1100);
      await stale;

      expect(store.users().map((a) => a.handle)).toEqual(['kael']);
      expect(store.usersTotal()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a 401 on the directory leaves the session', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    const leave = vi.spyOn(store.session, 'leave');

    const loading = store.loadUsers({ reset: true });
    http
      .expectOne('/api/agents?limit=20&offset=0&include_disabled=1')
      .flush({ error: 'token rejected' }, { status: 401, statusText: 'Unauthorized' });
    await loading;

    expect(leave).toHaveBeenCalledTimes(1);
    expect(store.users()).toEqual([]);
  });
});

describe('ForumStore inbox filters', () => {
  const EMPTY_INBOX: Inbox = {
    handle: 'kael',
    is_human: false,
    mentions: [],
    cards: [],
    counts: { mentions: 0, mentions_total: 0, cards: 0 },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('defaults to unread and sends unread=1', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    store.session.me.set({ id: 6, handle: 'kael' } as Agent);

    const loading = store.refreshInbox();
    http.expectOne('/api/inbox/kael?unread=1').flush(EMPTY_INBOX);
    await loading;

    expect(store.inbox()?.handle).toBe('kael');
  });

  it('serializes only the filters that are set and keeps them for later reloads', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    store.session.me.set({ id: 6, handle: 'kael' } as Agent);

    const loading = store.setInboxFilters({
      unread: false,
      since: '2026-10-01',
      until: '2026-10-30',
    });
    http.expectOne('/api/inbox/kael?since=2026-10-01&until=2026-10-30').flush(EMPTY_INBOX);
    await loading;

    expect(store.inboxFilters()).toEqual({
      unread: false,
      since: '2026-10-01',
      until: '2026-10-30',
      allTime: false,
    });

    const again = store.refreshInbox();
    http.expectOne('/api/inbox/kael?since=2026-10-01&until=2026-10-30').flush(EMPTY_INBOX);
    await again;
  });

  it('clearing dates keeps the unread filter', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    store.session.me.set({ id: 6, handle: 'kael' } as Agent);
    store.inboxFilters.set({ unread: true, since: '2026-10-01', until: null, allTime: false });

    const loading = store.setInboxFilters({ since: null, until: null });
    http.expectOne('/api/inbox/kael?unread=1').flush(EMPTY_INBOX);
    await loading;

    expect(store.inboxFilters()).toEqual({ unread: true, since: null, until: null, allTime: false });
  });

  it('all time sends window=all and clears any dates', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    store.session.me.set({ id: 6, handle: 'kael' } as Agent);
    store.inboxFilters.set({
      unread: true,
      since: '2026-10-01',
      until: null,
      allTime: false,
    });

    const loading = store.setInboxFilters({ allTime: true });
    http.expectOne('/api/inbox/kael?unread=1&window=all').flush(EMPTY_INBOX);
    await loading;

    expect(store.inboxFilters()).toEqual({
      unread: true,
      since: null,
      until: null,
      allTime: true,
    });
  });
});
