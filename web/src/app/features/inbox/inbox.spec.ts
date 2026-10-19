import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForumStore } from '../../core/forum.store';
import type { Inbox } from '../../core/models';
import { InboxPage } from './inbox';

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

describe('InboxPage (unread mentions + mark all read)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function render() {
    const store = TestBed.inject(ForumStore);
    store.inbox.set(INBOX);
    const fixture = TestBed.createComponent(InboxPage);
    fixture.detectChanges();
    return { fixture, store };
  }

  it('tints unread mention rows and reports the unread/total counts', () => {
    const { fixture } = render();
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('.list__row');
    expect(rows.length).toBe(2);
    expect(rows[0]?.classList.contains('list__row--unread')).toBe(true);
    expect(rows[1]?.classList.contains('list__row--unread')).toBe(false);
    const head = el.querySelector('.view__head')?.textContent ?? '';
    expect(head).toContain('1 unread');
    expect(head).toContain('2 mentions');
  });

  it('mark all read calls the store; the button is disabled at zero unread', () => {
    const { fixture, store } = render();
    const el = fixture.nativeElement as HTMLElement;
    const spy = vi.spyOn(store, 'markInboxRead').mockResolvedValue(true);

    const button = el.querySelector<HTMLButtonElement>('.inbox__readall');
    expect(button?.disabled).toBe(false);
    button?.click();
    expect(spy).toHaveBeenCalledTimes(1);

    store.inbox.set({ ...INBOX, counts: { mentions: 0, mentions_total: 2, cards: 0 } });
    fixture.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('.inbox__readall')?.disabled).toBe(true);
  });

  it('opens an assigned card on its project with the card target in the URL', () => {
    const { fixture, store } = render();
    const el = fixture.nativeElement as HTMLElement;
    store.inbox.set({
      ...INBOX,
      cards: [
        {
          id: 10,
          board_id: 4,
          column_id: 19,
          position: 0,
          title: 'opening an assigned card from inbox',
          body: 'scroll to me',
          assignee_id: 6,
          created_by: 3,
          created_at: '2026-10-18T23:49:27.211Z',
          updated_at: '2026-10-19T00:05:06.888Z',
          done_at: null,
          blocked_at: null,
          column_name: 'TODO',
          board_name: 'Agora Board',
        },
      ],
      counts: { mentions: 1, mentions_total: 2, cards: 1 },
    });
    fixture.detectChanges();

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    el.querySelectorAll<HTMLButtonElement>('.list__row')[2]?.click();

    expect(navigate).toHaveBeenCalledWith(['/boards', 4], {
      queryParams: { card: 10 },
    });
  });
});
