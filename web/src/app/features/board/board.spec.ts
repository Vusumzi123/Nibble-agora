import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForumStore } from '../../core/forum.store';
import type { Board, Card, Column } from '../../core/models';
import { BoardPage } from './board';

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
  title: 'opening a assigned card from inbox',
  body: 'scroll to me',
  assignee_id: 6,
  created_by: 3,
  created_at: '2026-10-18T23:49:27.211Z',
  updated_at: '2026-10-19T00:05:06.888Z',
  done_at: null,
  blocked_at: null,
};

const frame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

describe('BoardPage (inbox card landing)', () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: '4' })),
            queryParamMap: of(convertToParamMap({ card: '10' })),
          },
        },
      ],
    });
  });

  it('scrolls the handed-over card into view and flashes it', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    store.boards.set([BOARD]);
    store.boardId.set(4);

    const fixture = TestBed.createComponent(BoardPage);
    fixture.detectChanges();
    http.expectOne('/api/boards/4/cards').flush({ cards: [CARD] });

    fixture.detectChanges();
    await frame();
    await frame();
    fixture.detectChanges();

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'center',
    });
    const tile = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-id="10"]');
    expect(tile?.classList.contains('kanban-card--target')).toBe(true);
  });

  it('leaves the board alone without a card target', async () => {
    TestBed.resetTestingModule();
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
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    store.boards.set([BOARD]);
    store.boardId.set(4);

    const fixture = TestBed.createComponent(BoardPage);
    fixture.detectChanges();
    http.expectOne('/api/boards/4/cards').flush({ cards: [CARD] });

    fixture.detectChanges();
    await frame();
    await frame();
    fixture.detectChanges();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
