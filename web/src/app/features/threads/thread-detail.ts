import { Component, effect, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ForumStore } from '../../core/forum.store';
import { StatusService } from '../../core/status.service';
import { CategoryBadge } from '../../shared/category-badge';
import { CharCounter } from '../../shared/char-counter';
import { parseMentions } from '../../shared/text';
import { PostCard } from './post-card';

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

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.store.setView('threads');
      if (Number.isInteger(id) && id > 0) void this.store.loadThread(id);
    });
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
    }
  }
}
