import { Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ForumStore } from '../../core/forum.store';
import { StatusService } from '../../core/status.service';
import { CategoryBadge } from '../../shared/category-badge';
import { CharCounter } from '../../shared/char-counter';
import { parseMentions } from '../../shared/text';
import { PostCard } from './post-card';

const BATCH = 20;

@Component({
  selector: 'app-thread-detail',
  imports: [FormsModule, RouterLink, CategoryBadge, CharCounter, PostCard],
  templateUrl: './thread-detail.html',
  styleUrl: './thread-detail.css',
})
export class ThreadDetailPage {
  readonly id = input.required<string>();

  protected readonly store = inject(ForumStore);
  private readonly status = inject(StatusService);

  protected body = '';
  protected mentions = '';
  /** The reply box wears its controls only while the composer has focus. */
  protected controlsOpen = false;

  /** How many posts of the loaded thread are rendered; the rest stream in on scroll. */
  private readonly visiblePosts = signal(BATCH);
  protected readonly visible = computed(() =>
    (this.store.thread()?.posts ?? []).slice(0, this.visiblePosts()),
  );
  protected readonly hasMore = computed(
    () => (this.store.thread()?.posts.length ?? 0) > this.visiblePosts(),
  );

  private readonly feedEl = viewChild<ElementRef<HTMLElement>>('feed');
  private readonly sentinelEl = viewChild<ElementRef<HTMLElement>>('sentinel');
  private readonly composerEl = viewChild<ElementRef<HTMLElement>>('composer');
  private readonly inputEl = viewChild<ElementRef<HTMLTextAreaElement>>('input');

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.store.setView('threads');
      if (Number.isInteger(id) && id > 0) {
        this.visiblePosts.set(BATCH);
        void this.store.loadThread(id);
      }
    });

    // Re-arm the sentinel watcher whenever a new sentinel mounts or unmounts.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) this.loadMore();
    });
    effect((onCleanup) => {
      const sentinel = this.sentinelEl()?.nativeElement;
      if (!sentinel) return;
      observer.observe(sentinel);
      onCleanup(() => observer.unobserve(sentinel));
    });
  }

  protected loadMore(): void {
    const total = this.store.thread()?.posts.length ?? 0;
    this.visiblePosts.update((n) => Math.min(n + BATCH, total));
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

  protected async reply(): Promise<void> {
    const detail = this.store.thread();
    if (!detail) return;
    if (!this.body.trim()) {
      this.status.flash('reply is empty', true);
      return;
    }
    const ok = await this.store.reply(detail.thread.id, this.body, parseMentions(this.mentions));
    if (ok) {
      this.body = '';
      this.mentions = '';
      // reveal the whole thread and jump to the fresh reply
      this.visiblePosts.set(this.store.thread()?.posts.length ?? 0);
      queueMicrotask(() => {
        const feed = this.feedEl()?.nativeElement;
        feed?.scrollTo({ top: feed.scrollHeight });
      });
    }
  }
}
