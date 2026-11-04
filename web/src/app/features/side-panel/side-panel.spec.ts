import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { ForumStore } from '../../core/forum.store';
import { EN } from '../../core/i18n';
import type { Agent } from '../../core/models';
import { SessionService } from '../../core/session.service';
import { SidePanel } from './side-panel';

@Component({ template: '' })
class BlankPage {}

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
      providers: [
        provideRouter([{ path: 'threads', component: BlankPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
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

  it('renders the shell chrome through the translation catalog', () => {
    const fixture = TestBed.createComponent(SidePanel);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('aside')!.getAttribute('aria-label')).toBe(EN['shell.navigation']);
    expect(root.querySelector('.side-panel__close')!.textContent).toContain(EN['shell.close']);
    expect(root.querySelector('a[href="/threads"]')!.textContent).toContain(EN['shell.threads']);
    expect(root.querySelector('a[href="/boards"]')!.textContent).toContain(EN['shell.boards']);
    expect(root.querySelector('a[href="/inbox"]')!.textContent).toContain(EN['shell.inbox']);
    expect(root.querySelector('a[href="/users"]')!.textContent).toContain(EN['shell.users']);
  });

  it('marks the active route link with aria-current and leaves the others bare', async () => {
    const fixture = TestBed.createComponent(SidePanel);
    await TestBed.inject(Router).navigateByUrl('/threads');
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    const active = root.querySelector('a[href="/threads"]')!;
    expect(active.classList.contains('panel-item--active')).toBe(true);
    expect(active.getAttribute('aria-current')).toBe('page');
    expect(root.querySelector('a[href="/boards"]')!.getAttribute('aria-current')).toBeNull();
    expect(root.querySelector('a[href="/inbox"]')!.getAttribute('aria-current')).toBeNull();
  });

  it('gives every view tab a decorative leading icon', () => {
    const fixture = TestBed.createComponent(SidePanel);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    for (const href of ['/threads', '/boards', '/inbox', '/users']) {
      const icon = root.querySelector(`a[href="${href}"] .panel-item__icon`);
      expect(icon, href).not.toBeNull();
      expect(icon!.getAttribute('aria-hidden')).toBe('true');
      expect(icon!.classList.contains('fa-solid')).toBe(true);
    }
  });

  it('re-renders labels from the catalog instead of hardcoded copy', () => {
    const catalog = EN as Record<string, string>;
    const previous = catalog['shell.threads'];
    catalog['shell.threads'] = 'THREADS_X';
    try {
      const fixture = TestBed.createComponent(SidePanel);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('THREADS_X');
    } finally {
      catalog['shell.threads'] = previous;
    }
  });
});
