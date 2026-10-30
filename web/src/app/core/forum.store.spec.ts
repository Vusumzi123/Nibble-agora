import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent, Board, Card, ChangeEvent, Column, Project } from './models';
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
