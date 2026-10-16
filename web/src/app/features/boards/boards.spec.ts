import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForumStore } from '../../core/forum.store';
import type { Board, Forum, Project } from '../../core/models';
import { SessionService } from '../../core/session.service';
import { BoardsListPage } from './boards';

const FORUM: Forum = {
  id: 1,
  name: 'Agora',
  slug: 'forum',
  description: null,
  created_by: 1,
  created_at: '2026-10-15T00:00:00.000Z',
  archived_at: null,
};

const PROJECTS: Project[] = [
  {
    id: 1,
    name: 'Agora',
    slug: 'agora',
    description: 'Forum for the agents',
    created_by: 1,
    created_at: '2026-10-15T00:00:00.000Z',
    archived_at: null,
    forum_id: 1,
    board_id: 7,
  },
  {
    id: 2,
    name: 'Old Thing',
    slug: 'old-thing',
    description: null,
    created_by: 1,
    created_at: '2026-10-14T00:00:00.000Z',
    archived_at: '2026-10-15T01:00:00.000Z',
    forum_id: 1,
    board_id: 8,
  },
];

const BOARDS: Board[] = [
  {
    id: 7,
    name: 'Agora',
    slug: 'agora',
    description: null,
    created_by: 1,
    created_at: '2026-10-15T00:00:00.000Z',
    archived_at: null,
    project_id: 1,
    columns: [],
  },
  {
    id: 8,
    name: 'Old Thing',
    slug: 'old-thing',
    description: null,
    created_by: 1,
    created_at: '2026-10-14T00:00:00.000Z',
    archived_at: null,
    project_id: 2,
    columns: [],
  },
];

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('BoardsListPage (project list)', () => {
  let http: HttpTestingController;
  let store: ForumStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(ForumStore);
    store.forumId.set(1);
    const session = TestBed.inject(SessionService);
    session.token.set('agr_test');
    session.me.set({
      id: 1,
      handle: 'root',
      display_name: 'Root',
      is_human: 1,
      color: null,
      created_at: '2026-10-15T00:00:00.000Z',
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  /** Flush the ngOnInit initial loads (boards + projects, scoped to the forum). */
  async function loadInitial(): Promise<void> {
    http.expectOne('/api/boards?forum=1').flush({ boards: BOARDS });
    http.expectOne('/api/projects?forum=1').flush({ projects: PROJECTS });
    await tick();
  }

  it('lists live projects (archived filtered out) and links each to its board', async () => {
    const fixture = TestBed.createComponent(BoardsListPage);
    fixture.detectChanges();
    await loadInitial();
    fixture.detectChanges();

    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      '.project-card',
    );
    expect(cards.length).toBe(1);
    expect(cards[0]?.textContent).toContain('Agora');
    expect(cards[0]?.getAttribute('href')).toBe('/boards/7');
    expect(store.view()).toBe('boards');
  });

  it('posts a new project (scoped to the forum) and navigates to its board', async () => {
    // no inbox polling in this test — keep mutate()'s refreshAll at forums+boards+projects+agents
    TestBed.inject(SessionService).me.set(null);
    const fixture = TestBed.createComponent(BoardsListPage);
    fixture.detectChanges();
    await loadInitial();

    const comp = fixture.componentInstance as unknown as {
      openCreate: () => void;
      create: () => Promise<void>;
      name: string;
      description: string;
    };

    comp.openCreate();
    comp.name = 'Nemu';
    comp.description = 'Agent home';
    fixture.detectChanges();

    const created = comp.create();
    const req = http.expectOne('/api/projects');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Nemu', description: 'Agent home', forum_id: 1 });
    req.flush({
      project: {
        id: 9,
        name: 'Nemu',
        slug: 'nemu',
        description: 'Agent home',
        created_by: 1,
        created_at: '',
        archived_at: null,
        forum_id: 1,
        board_id: 9,
      },
      board: {
        id: 9,
        name: 'Nemu',
        slug: 'nemu',
        description: 'Agent home',
        created_by: 1,
        created_at: '',
        archived_at: null,
        project_id: 9,
        columns: [],
      },
      columns: [],
    });

    // mutate() → refreshAll(): forums, boards, projects, agents
    await tick();
    http.expectOne('/api/forums').flush({ forums: [FORUM] });
    await tick();
    http.expectOne('/api/boards?forum=1').flush({ boards: BOARDS });
    await tick();
    http.expectOne('/api/projects?forum=1').flush({ projects: PROJECTS });
    await tick();
    http.expectOne('/api/agents').flush({ agents: [] });

    await created;
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/boards', 9]);
  });
});
