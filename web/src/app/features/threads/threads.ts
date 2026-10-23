import { Component, ElementRef, OnInit, effect, inject, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { BusyService } from '../../core/busy.service';
import { ForumStore, type ThreadSort } from '../../core/forum.store';
import { CATEGORIES, type Category } from '../../core/models';
import { TranslateService } from '../../core/i18n';
import { WhenPipe } from '../../core/time';
import { CharCounter } from '../../shared/char-counter';
import { LoadingDots } from '../../shared/loading-dots';
import { MentionInput } from '../../shared/mention-input';
import { Modal } from '../../shared/modal';
import { parseMentions } from '../../shared/text';
import { StatusService } from '../../core/status.service';

@Component({
  selector: 'app-threads',
  imports: [FormsModule, RouterLink, WhenPipe, CharCounter, LoadingDots, MentionInput, Modal],
  templateUrl: './threads.html',
  styleUrl: './threads.css',
})
export class ThreadsPage implements OnInit {
  protected readonly store = inject(ForumStore);
  private readonly status = inject(StatusService);
  protected readonly busy = inject(BusyService);
  protected readonly i18n = inject(TranslateService);

  protected readonly categories = CATEGORIES;
  protected readonly sortOptions: { value: ThreadSort; labelKey: string }[] = [
    { value: 'updated', labelKey: 'threads.sortRecent' },
    { value: 'created', labelKey: 'threads.sortPosted' },
    { value: 'votes', labelKey: 'threads.sortVotes' },
    { value: 'views', labelKey: 'threads.sortViews' },
  ];

  protected composerOpen = false;
  protected sortOpen = false;
  protected title = '';
  protected category: Category = 'discussion';
  protected body = '';
  protected mentions = '';

  private readonly sentinelEl = viewChild<ElementRef<HTMLElement>>('sentinel');

  constructor() {
    // Re-arm the sentinel watcher whenever a new sentinel mounts or unmounts.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void this.loadMore();
    });
    effect((onCleanup) => {
      const sentinel = this.sentinelEl()?.nativeElement;
      if (!sentinel) return;
      observer.observe(sentinel);
      onCleanup(() => observer.unobserve(sentinel));
    });
  }

  /** Load the next batch; if the sentinel is still on screen after it (tall
   *  viewports never fire a fresh intersection), keep filling. */
  private async loadMore(): Promise<void> {
    if (this.store.loadingMore() || !this.store.hasMoreThreads()) return;
    await this.store.loadMoreThreads();
    const sentinel = this.sentinelEl()?.nativeElement;
    if (!sentinel || !this.store.hasMoreThreads()) return;
    const rect = sentinel.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) void this.loadMore();
  }

  ngOnInit(): void {
    // closing any open thread also returns the store to the list view.
    this.store.closeThread();
    // re-entering always starts a fresh first batch — a stale window from a
    // previous visit is never shown as-is.
    void this.store.reloadThreads();
  }

  protected openComposer(): void {
    this.closeSort();
    this.composerOpen = true;
  }

  protected openSort(): void {
    this.closeComposer();
    this.sortOpen = true;
  }

  protected closeComposer(): void {
    this.composerOpen = false;
  }

  protected closeSort(): void {
    this.sortOpen = false;
  }

  protected sortLabel(): string {
    return this.i18n.t(this.sortOptions.find((o) => o.value === this.store.sort())?.labelKey ?? '');
  }

  protected async applySort(value: ThreadSort): Promise<void> {
    this.closeSort();
    await this.store.setSort(value);
  }

  protected async post(): Promise<void> {
    if (!this.title.trim()) {
      this.status.flash(this.i18n.t('threads.titleRequired'), true);
      return;
    }
    if (!this.body.trim()) {
      this.status.flash(this.i18n.t('threads.messageRequired'), true);
      return;
    }
    const ok = await this.store.postThread({
      title: this.title.trim(),
      category: this.category,
      body: this.body,
      mentions: parseMentions(this.mentions),
    });
    if (ok) {
      this.title = '';
      this.body = '';
      this.mentions = '';
      this.closeComposer();
    }
  }
}
