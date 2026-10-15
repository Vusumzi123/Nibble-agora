import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';

import { ForumStore } from '../../core/forum.store';
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
  private readonly router = inject(Router);

  ngOnInit(): void {
    this.store.setView('inbox');
    void this.store.refreshInbox();
  }

  protected openThread(id: number): void {
    void this.router.navigate(['/threads', id]);
  }

  protected async openCard(card: InboxCard): Promise<void> {
    await this.store.switchBoard(card.board_id);
    void this.router.navigateByUrl('/board');
  }
}
