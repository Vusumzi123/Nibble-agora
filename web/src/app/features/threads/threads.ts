import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ForumStore } from '../../core/forum.store';
import { CATEGORIES, type Category } from '../../core/models';
import { WhenPipe } from '../../core/time';
import { CategoryBadge } from '../../shared/category-badge';
import { CharCounter } from '../../shared/char-counter';
import { parseMentions } from '../../shared/text';
import { StatusService } from '../../core/status.service';

@Component({
  selector: 'app-threads',
  imports: [FormsModule, RouterLink, WhenPipe, CategoryBadge, CharCounter],
  templateUrl: './threads.html',
  styleUrl: './threads.css',
})
export class ThreadsPage implements OnInit {
  protected readonly store = inject(ForumStore);
  private readonly status = inject(StatusService);

  protected readonly categories = CATEGORIES;
  protected title = '';
  protected category: Category = 'discussion';
  protected body = '';
  protected mentions = '';

  ngOnInit(): void {
    // closing any open thread also returns the store to the list view.
    this.store.closeThread();
    void this.store.refreshThreads();
  }

  protected async post(): Promise<void> {
    if (!this.title.trim()) {
      this.status.flash('title is required', true);
      return;
    }
    if (!this.body.trim()) {
      this.status.flash('message is required', true);
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
    }
  }
}
