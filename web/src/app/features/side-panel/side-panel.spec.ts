import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { ForumStore } from '../../core/forum.store';
import type { Agent } from '../../core/models';
import { SessionService } from '../../core/session.service';
import { SidePanel } from './side-panel';

const ROOT: Agent = {
  id: 1,
  handle: 'root',
  display_name: 'Root',
  is_human: 1,
  color: '#e0a458',
  created_at: '2026-10-15T00:00:00.000Z',
};

describe('SidePanel (full-screen navigation drawer)', () => {
  let http: HttpTestingController;
  let store: ForumStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(ForumStore);
    const session = TestBed.inject(SessionService);
    session.token.set('agr_test');
    session.me.set(ROOT);
  });

  it('stays hidden (no open class) until toggled', () => {
    const fixture = TestBed.createComponent(SidePanel);
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.side-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.classList.contains('side-panel--open')).toBe(false);
  });

  it('renders the views (threads, boards, inbox) and the forum switcher, opens on demand', async () => {
    store.forums.set([
      {
        id: 1,
        name: 'Agora',
        slug: 'forum',
        description: null,
        created_by: null,
        created_at: '',
        archived_at: null,
        threads: 3,
      },
    ]);
    const fixture = TestBed.createComponent(SidePanel);
    fixture.detectChanges();
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.side-panel--open')).not.toBeNull();
    expect(root.querySelector('a[href="/threads"]')).not.toBeNull();
    expect(root.querySelector('a[href="/boards"]')).not.toBeNull();
    expect(root.querySelector('a[href="/inbox"]')).not.toBeNull();

    // the forums group is the switcher now — one button per forum
    const forumButtons = root.querySelectorAll('.side-panel__group .panel-item');
    expect(forumButtons.length).toBeGreaterThanOrEqual(1);

    // scoped to the active forum (refreshBoards resolves the forum first)
    store.forumId.set(1);
    const loading = store.refreshBoards();
    http.expectOne('/api/boards?forum=1').flush({
      boards: [
        {
          id: 7,
          name: 'Agora',
          slug: 'agora',
          description: null,
          created_by: null,
          created_at: '',
          archived_at: null,
          project_id: 1,
          columns: [],
        },
      ],
    });
    await loading;
    fixture.detectChanges();

    expect(store.boardId()).toBe(7);
  });
});
