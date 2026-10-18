import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { BusyService } from '../../core/busy.service';
import { ForumStore } from '../../core/forum.store';
import type { Post, Thread, ThreadDetail } from '../../core/models';
import { ThreadDetailPage } from './thread-detail';

const THREAD: Thread = {
  id: 123,
  forum_id: 1,
  category: 'discussion',
  title: 'scroll behavior',
  status: 'open',
  created_by: 1,
  created_at: '2026-10-17T00:00:00.000Z',
  updated_at: '2026-10-17T00:00:00.000Z',
  views: 3,
  votes: 1,
};

const post = (id: number): Post => ({
  id,
  thread_id: 123,
  author_id: 1,
  body: `post ${id}`,
  created_at: '2026-10-17T00:00:00.000Z',
  edited_at: null,
  author_handle: 'root',
  author_is_human: 1,
  reactions: [],
  mentions: [],
});

/** OP + 25 replies — three pages of ten, so the newest page starts at offset 15. */
const PAGE = (from: number, count: number): Post[] => [
  post(1),
  ...Array.from({ length: count }, (_, i) => post(from + i)),
];

const OP_ONLY: ThreadDetail = {
  thread: THREAD,
  posts: [post(1)],
  voted: false,
  replies_total: 25,
};

const NEWEST_PAGE: ThreadDetail = {
  ...OP_ONLY,
  posts: PAGE(17, 10),
};

describe('ThreadDetailPage (windowed replies, open lands at newest, reply scrolls to itself)', () => {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const scrollIntoView = vi.fn();
  const scrollTo = vi.fn();
  let rafPolyfilled = false;
  let ioPolyfilled = false;

  beforeAll(() => {
    // jsdom has no layout and no rAF guarantee — give the effects a geometry
    // (feed 2000px tall content in a 500px viewport) and a frame clock.
    descriptors.set('scrollHeight', Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'));
    descriptors.set('clientHeight', Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'));
    descriptors.set('scrollTop', Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop'));
    descriptors.set('scrollIntoView', Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView'));
    descriptors.set('scrollTo', Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo'));
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement & { __sh?: number }) {
        return this.__sh ?? 2000;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 500 });
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get(this: HTMLElement & { __st?: number }) {
        return this.__st ?? 0;
      },
      set(this: HTMLElement & { __st?: number }, value: number) {
        this.__st = value;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: function (this: HTMLElement & { __st?: number }, options?: ScrollToOptions) {
        scrollTo.call(this, options);
        if (typeof options?.top === 'number') this.__st = options.top;
      },
    });
    if (typeof globalThis.requestAnimationFrame !== 'function') {
      rafPolyfilled = true;
      globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
        setTimeout(() => cb(performance.now()), 0)) as unknown as typeof requestAnimationFrame;
      globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as unknown as typeof cancelAnimationFrame;
    }
    if (typeof globalThis.IntersectionObserver !== 'function') {
      ioPolyfilled = true;
      globalThis.IntersectionObserver = class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
        takeRecords(): IntersectionObserverEntry[] {
          return [];
        }
      } as unknown as typeof IntersectionObserver;
    }
  });

  afterAll(() => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, name);
    }
    if (rafPolyfilled) {
      delete (globalThis as unknown as Record<string, unknown>)['requestAnimationFrame'];
      delete (globalThis as unknown as Record<string, unknown>)['cancelAnimationFrame'];
    }
    if (ioPolyfilled) {
      delete (globalThis as unknown as Record<string, unknown>)['IntersectionObserver'];
    }
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    scrollIntoView.mockClear();
    scrollTo.mockClear();
    // Don't sit out the older-replies beat in every test; the one that cares
    // sets its own minimum below.
    TestBed.inject(ForumStore).minOlderLoadMs = 0;
  });

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** Open the page on /123 and flush the two independent sections: the head
      (entry + meta) first, then the newest reply page. */
  async function open() {
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ThreadDetailPage);
    fixture.componentRef.setInput('id', '123');
    fixture.detectChanges();
    http.expectOne('/api/threads/123/view').flush({ thread: THREAD });
    await tick();
    http.expectOne('/api/threads/123?replies_limit=0&replies_offset=0').flush(OP_ONLY);
    await tick();
    http.expectOne('/api/threads/123?replies_limit=10&replies_offset=15').flush(NEWEST_PAGE);
    return { fixture, http };
  }

  const frames = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  };

  const feedScrollTop = (fixture: { nativeElement: HTMLElement }): number | undefined =>
    (fixture.nativeElement.querySelector('.feed') as HTMLElement & { __st?: number } | null)?.__st;

  it('lands the feed at the bottom once the newest page has settled', async () => {
    const { fixture, http } = await open();
    await fixture.whenStable();
    await frames(5);
    expect(feedScrollTop(fixture)).toBe(2000);
    expect(scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: 'smooth' });
    http.verify();
  });

  it('resets and re-animates when the open thread changes on a reused component', async () => {
    const { fixture, http } = await open();
    await fixture.whenStable();
    await frames(5);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    const feed = fixture.nativeElement.querySelector('.feed') as HTMLElement & { __st?: number };
    expect(feed.__st).toBe(2000);

    // Thread → thread: same component instance, same feed element.
    fixture.componentRef.setInput('id', '124');
    fixture.detectChanges();
    await tick();
    http.expectOne('/api/threads/124/view').flush({ thread: { ...THREAD, id: 124 } });
    await tick();
    http.expectOne('/api/threads/124?replies_limit=0&replies_offset=0').flush(OP_ONLY);
    await tick();
    http.expectOne('/api/threads/124?replies_limit=10&replies_offset=15').flush(NEWEST_PAGE);
    await fixture.whenStable();
    await frames(5);

    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(feed.__st).toBe(2000);
    http.verify();
  });

  it('prepends an older reply page and keeps the reader anchored', async () => {
    const { fixture, http } = await open();
    await fixture.whenStable();
    await frames(5);
    const feed = fixture.nativeElement.querySelector('.feed') as HTMLElement & {
      __st?: number;
      __sh?: number;
    };
    const page = fixture.componentInstance as unknown as { loadOlder: () => void };

    // The prepend adds ten rows: capture the height while the request is out.
    page.loadOlder();
    feed.__sh = 2600;
    http.expectOne('/api/threads/123?replies_limit=10&replies_offset=5').flush({
      thread: THREAD,
      posts: PAGE(7, 10),
      voted: false,
      replies_total: 25,
    });
    await fixture.whenStable();
    await frames(35);

    expect(fixture.nativeElement.querySelectorAll('[data-post-id]').length).toBe(20);
    expect(feed.__st).toBe(2600);
    http.verify();
  });

  it('holds the older reply page behind the dots for the minimum beat', async () => {
    const { fixture, http } = await open();
    await fixture.whenStable();
    await frames(5);
    const store = TestBed.inject(ForumStore);
    store.minOlderLoadMs = 150;
    const page = fixture.componentInstance as unknown as { loadOlder: () => void };
    const rows = () => fixture.nativeElement.querySelectorAll('[data-post-id]').length;

    page.loadOlder();
    http.expectOne('/api/threads/123?replies_limit=10&replies_offset=5').flush({
      thread: THREAD,
      posts: PAGE(7, 10),
      voted: false,
      replies_total: 25,
    });
    await tick();
    // The fetch is settled, but the batch is still behind the dots.
    expect(rows()).toBe(10);

    await new Promise((resolve) => setTimeout(resolve, 200));
    await fixture.whenStable();
    expect(rows()).toBe(20);
    http.verify();
  });

  it('scrolls the freshly posted reply into view', async () => {
    const { fixture, http } = await open();
    await fixture.whenStable();
    await frames(5);

    const page = fixture.componentInstance as unknown as {
      body: string;
      reply: () => Promise<void>;
    };
    page.body = 'fresh reply';
    const done = page.reply();
    http.expectOne('/api/threads/123/replies').flush({ post: post(99) });
    await tick();
    // mutate() → refreshAll(): forums are awaited first, then the poll refresh
    // (head + the loaded window, which now runs to the new reply).
    http.expectOne('/api/forums').flush({ forums: [] });
    await tick();
    http.expectOne('/api/threads/123?replies_limit=0&replies_offset=0').flush({
      ...OP_ONLY,
      replies_total: 26,
    });
    await tick();
    http.expectOne('/api/threads/123?replies_limit=11&replies_offset=15').flush({
      ...OP_ONLY,
      posts: [...NEWEST_PAGE.posts, post(99)],
      replies_total: 26,
    });
    await done;
    await fixture.whenStable();
    await frames(5);

    const targets = scrollIntoView.mock.instances.filter(
      (node) => (node as HTMLElement).getAttribute?.('data-post-id') === '99',
    );
    expect(targets).toHaveLength(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    http.verify();
  });

  it('locks the upvote button under the busy curtain while the vote is in flight', async () => {
    const { fixture, http } = await open();
    await fixture.whenStable();
    await frames(5);
    const busy = TestBed.inject(BusyService);
    const btn = [...fixture.nativeElement.querySelectorAll('button')].find(
      (b: HTMLButtonElement) => b.textContent?.trim() === 'upvote',
    ) as HTMLButtonElement;
    expect(btn).toBeTruthy();

    btn.click();
    await tick();
    expect(busy.active()).toBe(true);
    expect(busy.label()).toBe('upvoting thread');
    expect(btn.disabled).toBe(true);

    http.expectOne('/api/threads/123/vote').flush({ votes: 2, voted: true });
    await tick();
    http.expectOne('/api/forums').flush({ forums: [] });
    await tick();
    const voted = { ...THREAD, votes: 2 };
    http.expectOne('/api/threads/123?replies_limit=0&replies_offset=0').flush({
      ...OP_ONLY,
      thread: voted,
      voted: true,
    });
    await tick();
    http.expectOne('/api/threads/123?replies_limit=10&replies_offset=15').flush({
      ...NEWEST_PAGE,
      thread: voted,
      voted: true,
    });
    await fixture.whenStable();
    await tick();
    await tick();

    expect(busy.active()).toBe(false);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent?.trim()).toBe('upvoted');
    http.verify();
  });

  it('submits on Enter from the reply box and the mentions field, Shift+Enter stays a newline', async () => {
    const { fixture, http } = await open();
    await fixture.whenStable();
    await frames(5);

    const page = fixture.componentInstance as unknown as {
      body: string;
      reply: () => Promise<void>;
    };
    const submit = vi.fn(async () => {});
    page.reply = submit;
    page.body = 'enter reply';
    const box = fixture.nativeElement.querySelector('textarea.composer__input') as HTMLTextAreaElement;
    // Focusing the box is what opens the controls in the real UI (zoneless
    // change detection ignores a bare field write + detectChanges here).
    box.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    await fixture.whenStable();

    const mentions = fixture.nativeElement.querySelector('input.composer__mentions') as HTMLInputElement;
    expect(box).toBeTruthy();
    expect(mentions).toBeTruthy();

    const enter = (el: HTMLElement, opts: KeyboardEventInit = {}) =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...opts }));

    // Shift+Enter keeps the default (newline), so nothing is posted.
    expect(enter(box, { shiftKey: true })).toBe(true);
    expect(submit).not.toHaveBeenCalled();

    // Plain Enter is handled and posts, from either field.
    expect(enter(box)).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(enter(mentions)).toBe(false);
    expect(submit).toHaveBeenCalledTimes(2);
    http.verify();
  });
});
