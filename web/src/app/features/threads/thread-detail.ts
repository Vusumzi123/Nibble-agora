import { Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { BusyService } from '../../core/busy.service';
import { ForumStore } from '../../core/forum.store';
import { StatusService } from '../../core/status.service';
import { CategoryBadge } from '../../shared/category-badge';
import { CharCounter } from '../../shared/char-counter';
import { LoadingDots } from '../../shared/loading-dots';
import { parseMentions } from '../../shared/text';
import { PostCard } from './post-card';

@Component({
  selector: 'app-thread-detail',
  imports: [FormsModule, RouterLink, CategoryBadge, CharCounter, LoadingDots, PostCard],
  templateUrl: './thread-detail.html',
  styleUrl: './thread-detail.css',
})
export class ThreadDetailPage {
  readonly id = input.required<string>();

  protected readonly store = inject(ForumStore);
  private readonly status = inject(StatusService);
  protected readonly busy = inject(BusyService);

  protected body = '';
  protected mentions = '';
  /** The reply box wears its controls only while the composer has focus. */
  protected controlsOpen = false;

  /** The thread entry — rendered once, outside the reply stream, in its own
      pinned band above it. */
  protected readonly op = computed(() => this.store.thread()?.posts[0] ?? null);
  /** Chronological: replies build on what sits above them, so the feed reads
      downward to the freshest answer. The store hands over only the loaded
      window, not the whole conversation. */
  protected readonly replies = computed(() => this.store.thread()?.posts.slice(1) ?? []);
  /** One-shot request: drop the feed to the newest reply once the thread is
      rendered (set after the open-load resolves). Also gates the older-replies
      sentinel — while the feed is still parked at the top, observing it would
      fire a page before the reader ever scrolls. */
  protected readonly pendingBottom = signal(false);
  /** Drives the enter animation on the reply we just posted. */
  protected readonly justPostedId = signal<number | null>(null);
  /** One-shot request: scroll this reply into view once it has rendered. */
  private readonly scrollToId = signal<number | null>(null);
  /** Older-replies paging only arms after the reader actually scrolls — the
      open glide passes through the top and would otherwise fire a page. */
  protected readonly armed = signal(false);

  private readonly feedEl = viewChild<ElementRef<HTMLElement>>('feed');
  private readonly sentinelEl = viewChild<ElementRef<HTMLElement>>('sentinel');
  private readonly composerEl = viewChild<ElementRef<HTMLElement>>('composer');
  private readonly inputEl = viewChild<ElementRef<HTMLTextAreaElement>>('input');

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.store.setView('threads');
      if (Number.isInteger(id) && id > 0) {
        this.pendingBottom.set(false);
        this.armed.set(false);
        // A reused component (thread → thread) keeps the feed element; start
        // the new read from the top so the glide to its newest reply shows.
        // untracked: the probe must not re-trigger this effect on mount.
        const feed = untracked(() => this.feedEl())?.nativeElement;
        if (feed) feed.scrollTop = 0;
        void this.store.openThread(id).then(() => {
          // The thread on screen is ours — land at the newest reply (the
          // classic forum entry point).
          if (Number(this.id()) === id) this.pendingBottom.set(true);
        });
      }
    });

    // Re-arm the sentinel watcher whenever a new sentinel mounts or unmounts.
    const observer = new IntersectionObserver((entries) => {
      if (!this.armed()) return;
      if (entries.some((e) => e.isIntersecting)) this.loadOlder();
    });
    effect((onCleanup) => {
      const sentinel = this.sentinelEl()?.nativeElement;
      if (!sentinel) return;
      observer.observe(sentinel);
      onCleanup(() => observer.unobserve(sentinel));
    });

    // Land at the newest reply on open: wait for the rendered height to settle
    // (an effect can outrun the render, and a missing feed must be retried),
    // then glide down to the bottom in one smooth motion.
    effect((onCleanup) => {
      if (!this.pendingBottom()) return;
      if (this.store.thread() === null) return;
      let frames = 0;
      let lastHeight = -1;
      let raf = 0;
      const step = (): void => {
        frames += 1;
        const feed = this.feedEl()?.nativeElement;
        if (feed) {
          const grew = feed.scrollHeight !== lastHeight;
          lastHeight = feed.scrollHeight;
          if (!grew && frames > 1) {
            feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
            this.pendingBottom.set(false);
            return;
          }
        }
        if (frames > 60) {
          this.pendingBottom.set(false);
          return;
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      onCleanup(() => cancelAnimationFrame(raf));
    });

    // After our own reply lands: poll the rendered stream for the row (the
    // effect can outrun change detection after an async write), scroll it into
    // view, and only then retire the request.
    effect((onCleanup) => {
      const target = this.scrollToId();
      if (target === null) return;
      if (!this.replies().some((post) => post.id === target)) return;
      let frames = 0;
      let raf = 0;
      const step = (): void => {
        frames += 1;
        const node = this.feedEl()?.nativeElement.querySelector(`[data-post-id="${target}"]`);
        if (node) {
          node.scrollIntoView({ behavior: 'smooth', block: 'center' });
          this.scrollToId.set(null);
          return;
        }
        if (frames > 60) {
          this.scrollToId.set(null);
          return;
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      onCleanup(() => cancelAnimationFrame(raf));
    });
  }

  /** First real scroll gesture on the feed — arms older-replies paging. */
  protected arm(): void {
    this.armed.set(true);
  }

  /** Sentinel at the top of the replies: pull the previous page and re-anchor
      the scroll offset once the prepend lands, so the reader stays put. */
  protected loadOlder(): void {
    if (
      this.pendingBottom() ||
      !this.store.hasOlderReplies() ||
      this.store.repliesLoading() ||
      this.store.repliesLoadingMore()
    ) {
      return;
    }
    const feed = this.feedEl()?.nativeElement;
    if (!feed) return;
    const before = feed.scrollHeight;
    void this.store.loadOlderReplies().then(() => {
      let frames = 0;
      const step = (): void => {
        frames += 1;
        const el = this.feedEl()?.nativeElement;
        if (!el) return;
        if (el.scrollHeight !== before || frames > 30) {
          el.scrollTop += el.scrollHeight - before;
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  protected vote(): void {
    const detail = this.store.thread();
    if (!detail) return;
    void this.store.voteThread(detail.thread.id, detail.voted);
  }

  /** Collapse the controls when focus leaves the composer — but never while a
      draft is in flight (some browsers report no relatedTarget on the way to
      the mentions field or the reply button, and the controls must not
      unmount mid-click). */
  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && this.composerEl()?.nativeElement.contains(next)) return;
    if (this.body.trim() || this.mentions.trim()) return;
    this.controlsOpen = false;
  }

  /** The bridge prompt's job: open the controls and put the caret in the box. */
  protected focusComposer(): void {
    this.controlsOpen = true;
    this.inputEl()?.nativeElement.focus();
  }

  /** Enter posts (from the box or the mentions field); Shift+Enter stays a
      newline so multi-line replies are still possible. */
  protected onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void this.reply();
  }

  protected async reply(): Promise<void> {
    const detail = this.store.thread();
    if (!detail || this.busy.active()) return;
    if (!this.body.trim()) {
      this.status.flash('reply is empty', true);
      return;
    }
    const ok = await this.store.reply(detail.thread.id, this.body, parseMentions(this.mentions));
    if (!ok) return;
    this.body = '';
    this.mentions = '';
    // mutate() refreshed the thread — the fresh reply is the last post.
    const posts = this.store.thread()?.posts ?? [];
    const posted = posts[posts.length - 1];
    if (!posted) return;
    // Mark the fresh reply for the enter animation, and ask the effect to
    // scroll it into view (the poll window runs to the newest reply).
    this.justPostedId.set(posted.id);
    this.scrollToId.set(posted.id);
  }
}
