import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ForumStore } from '../core/forum.store';
import { TranslateService } from '../core/i18n';
import type { Agent, Board, Card, Column, Post, Thread, ThreadDetail, ThreadSummary } from '../core/models';
import { SessionService } from '../core/session.service';
import { BoardPage } from './board/board';
import { ThreadDetailPage } from './threads/thread-detail';
import { ThreadsPage } from './threads/threads';

const AGENT: Agent = {
  id: 1,
  handle: 'root',
  display_name: 'Root',
  is_human: 1,
  color: '#e0a458',
  created_at: '2026-10-15T00:00:00.000Z',
};

const THREAD: Thread = {
  id: 123,
  forum_id: 1,
  category: 'discussion',
  title: 'user thread title',
  status: 'open',
  created_by: 1,
  created_at: '2026-10-17T00:00:00.000Z',
  updated_at: '2026-10-17T00:00:00.000Z',
  views: 3,
  votes: 1,
};

const SUMMARY: ThreadSummary = {
  ...THREAD,
  reply_count: 2,
  body: 'user opening body',
  last_body: 'user last reply',
  last_author: 'root',
  last_at: '2026-10-17T00:00:00.000Z',
};

const POST: Post = {
  id: 1,
  thread_id: 123,
  author_id: 1,
  body: 'user opening body',
  created_at: '2026-10-17T00:00:00.000Z',
  edited_at: null,
  author_handle: 'root',
  author_is_human: 1,
  reactions: [],
  mentions: [],
};

const DETAIL: ThreadDetail = {
  thread: THREAD,
  posts: [POST],
  voted: false,
  replies_total: 1,
};

const COLUMN: Column = {
  id: 19,
  board_id: 4,
  name: 'TODO',
  position: 0,
  wip_limit: null,
};

const BOARD: Board = {
  id: 4,
  name: 'Agora Board',
  slug: 'agora-board',
  description: null,
  created_by: 3,
  created_at: '2026-10-18T00:00:00.000Z',
  archived_at: null,
  project_id: 4,
  columns: [COLUMN],
};

const CARD: Card = {
  id: 10,
  board_id: 4,
  column_id: 19,
  position: 0,
  title: 'user card title',
  body: 'user card body',
  assignee_id: 6,
  created_by: 3,
  created_at: '2026-10-18T23:49:27.211Z',
  updated_at: '2026-10-19T00:05:06.888Z',
  done_at: null,
  blocked_at: null,
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The two primary work surfaces in Spanish — chrome translates, user content does not. */
describe('Spanish threads and board chrome', () => {
  let ioStub: typeof IntersectionObserver | undefined;

  beforeAll(() => {
    ioStub = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): [] {
        return [];
      }
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];
    } as unknown as typeof IntersectionObserver;
  });

  afterAll(() => {
    if (ioStub) globalThis.IntersectionObserver = ioStub;
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: '4' })),
            queryParamMap: of(convertToParamMap({})),
          },
        },
      ],
    });
    const session = TestBed.inject(SessionService);
    session.token.set('agr_test');
    session.me.set(AGENT);
    TestBed.inject(TranslateService).setLocale('es');
  });

  it('renders the threads list with Spanish chrome and untouched user content', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    store.forumId.set(1);

    const fixture = TestBed.createComponent(ThreadsPage);
    fixture.detectChanges();
    http
      .expectOne((req) => req.url.startsWith('/api/forums/1/threads'))
      .flush({ threads: [SUMMARY], total: 1 });
    await tick();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const text = root.textContent ?? '';
    expect(text).toContain('ordenar por');
    expect(text).toContain('debate');
    expect(text).toContain('3 vistas');
    expect(text).toContain('1 respuestas');
    expect(text).not.toContain('threads.');
    expect(root.querySelector('.list__title')?.textContent?.trim()).toBe('user thread title');
  });

  it('renders the thread detail with Spanish chrome and untouched post bodies', async () => {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ThreadDetailPage);
    fixture.componentRef.setInput('id', '123');
    fixture.detectChanges();
    http.expectOne('/api/threads/123/view').flush({ thread: THREAD });
    await tick();
    http.expectOne('/api/threads/123?replies_limit=0&replies_offset=0').flush(DETAIL);
    await tick();
    http
      .expectOne((req) => req.url.startsWith('/api/threads/123?'))
      .flush({ ...DETAIL, replies_total: 0 });
    await tick();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const text = root.textContent ?? '';
    expect(root.querySelector('[aria-label="volver a hilos"]')).not.toBeNull();
    expect(text).toContain('debate');
    expect(text).toContain('votar');
    expect(text).not.toContain('threads.');
    expect(root.textContent).toContain('user opening body');
  });

  it('renders the board with Spanish chrome and untouched card content', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    store.boards.set([BOARD]);
    store.boardId.set(4);

    const fixture = TestBed.createComponent(BoardPage);
    fixture.detectChanges();
    http.expectOne('/api/boards/4/cards').flush({ cards: [CARD] });
    await tick();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const text = root.textContent ?? '';
    expect(root.querySelector('[aria-label="volver a tableros"]')).not.toBeNull();
    expect(root.querySelector('[title="añadir tarjeta"]')).not.toBeNull();
    expect(text).toContain('tablero');
    expect(text).not.toContain('board.');
    expect(root.querySelector('.kanban-card__title')?.textContent?.trim()).toBe('user card title');
  });
});
