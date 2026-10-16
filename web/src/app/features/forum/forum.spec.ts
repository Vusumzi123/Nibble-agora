import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { ForumStore } from '../../core/forum.store';
import type { Board, Project } from '../../core/models';
import { SessionService } from '../../core/session.service';
import { ForumOverviewPage } from './forum';

const PROJECT: Project = {
  id: 1,
  name: 'Agora',
  slug: 'agora',
  description: null,
  created_by: 1,
  created_at: '2026-10-15T00:00:00.000Z',
  archived_at: null,
  forum_id: 1,
  board_id: 7,
};

const BOARD: Board = {
  id: 7,
  name: 'Agora',
  slug: 'agora',
  description: null,
  created_by: 1,
  created_at: '2026-10-15T00:00:00.000Z',
  archived_at: null,
  project_id: 1,
  columns: [],
};

describe('ForumOverviewPage (forum home)', () => {
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
  });

  it('shows counts, its projects and recent threads from the overview', async () => {
    const fixture = TestBed.createComponent(ForumOverviewPage);
    fixture.detectChanges();

    http.expectOne('/api/boards?forum=1').flush({ boards: [BOARD] });
    http.expectOne('/api/projects?forum=1').flush({ projects: [PROJECT] });
    http.expectOne('/api/forums/1/overview').flush({
      forum: { id: 1, name: 'Agora', slug: 'forum' },
      counts: { projects: 1, threads: 2 },
      recent_threads: [
        {
          id: 5,
          title: 'hello forum',
          category: 'discussion',
          status: 'open',
          votes: 0,
          views: 1,
          updated_at: '2026-10-15T00:00:00.000Z',
          forum_id: 1,
          project_name: 'Agora',
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();

    expect(store.view()).toBe('forum');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.forum__counts')?.textContent).toContain('2 threads');
    expect(el.querySelectorAll('.project-card').length).toBe(1);
    const row = el.querySelector<HTMLAnchorElement>('.list__row');
    expect(row?.textContent).toContain('hello forum');
    expect(row?.getAttribute('href')).toBe('/threads/5');
  });
});
