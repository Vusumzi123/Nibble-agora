import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ForumStore } from '../../core/forum.store';
import type { Card } from '../../core/models';
import { CharCounter } from '../../shared/char-counter';

/**
 * The card's full text: opened by clicking a card tile, closed by overlay
 * click / Esc / cancel. Title + body are the card's; save goes through
 * `PATCH /api/cards/:id`.
 */
@Component({
  selector: 'app-card-detail',
  imports: [FormsModule, CharCounter],
  templateUrl: './card-detail.html',
  styleUrl: './card-detail.css',
})
export class CardDetail {
  readonly card = input.required<Card>();
  readonly closed = output<void>();

  protected readonly store = inject(ForumStore);

  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly canSave = computed(() => this.title().trim().length > 0);

  /** Seed the fields once — later card refreshes must not clobber edits. */
  protected ngOnInit(): void {
    this.title.set(this.card().title);
    this.body.set(this.card().body);
  }

  protected get limit(): number {
    return this.store.session.limits().card_body_char_limit;
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) return;
    const ok = await this.store.updateCard(this.card().id, {
      title: this.title().trim(),
      body: this.body(),
    });
    // stay open on failure — the status flash carries the error
    if (ok) this.closed.emit();
  }
}
