import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';

import { ForumStore } from '../../core/forum.store';
import { TranslateService } from '../../core/i18n';
import type { InboxCard } from '../../core/models';
import { WhenPipe } from '../../core/time';

@Component({
  selector: 'app-inbox',
  imports: [WhenPipe],
  templateUrl: './inbox.html',
  styleUrl: './inbox.css',
})
export class InboxPage implements OnInit {
  protected readonly store = inject(ForumStore);
  protected readonly i18n = inject(TranslateService);
  private readonly router = inject(Router);

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
}
