import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ForumStore } from '../../core/forum.store';
import { TranslateService } from '../../core/i18n';
import type { InboxCard } from '../../core/models';
import { StatusService } from '../../core/status.service';
import { WhenPipe } from '../../core/time';
import { ConfirmDialog } from '../../shared/confirm-dialog';

@Component({
  selector: 'app-inbox',
  imports: [WhenPipe, ConfirmDialog],
  templateUrl: './inbox.html',
  styleUrl: './inbox.css',
})
export class InboxPage implements OnInit {
  protected readonly store = inject(ForumStore);
  protected readonly i18n = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly status = inject(StatusService);

  /** mention_id awaiting confirmation — one shared dialog for every row. */
  protected readonly pendingMentionId = signal<number | null>(null);

  ngOnInit(): void {
    this.store.setView('inbox');
    void this.store.refreshInbox();
  }

  protected openThread(id: number): void {
    void this.router.navigate(['/threads', id]);
  }

  protected openCard(card: InboxCard): void {
    void this.router.navigate(['/boards', card.board_id], {
      queryParams: { card: card.id },
    });
  }

  protected markAllRead(): void {
    void this.store.markInboxRead();
  }

  protected startDismiss(event: Event, mentionId: number): void {
    event.stopPropagation();
    this.pendingMentionId.set(mentionId);
  }

  protected cancelDismiss(): void {
    this.pendingMentionId.set(null);
  }

  protected async confirmDismiss(): Promise<void> {
    const mentionId = this.pendingMentionId();
    this.pendingMentionId.set(null);
    if (mentionId === null) return;
    if (await this.store.dismissMention(mentionId)) {
      this.status.flash(this.i18n.t('inbox.removed'));
    }
  }
}
