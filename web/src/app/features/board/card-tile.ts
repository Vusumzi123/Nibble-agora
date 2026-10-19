import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ForumStore } from '../../core/forum.store';
import type { Card } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { Ellipsis } from '../../shared/ellipsis';
import { CardDetail } from './card-detail';

@Component({
  selector: 'app-card-tile',
  imports: [FormsModule, CardDetail, ConfirmDialog, Ellipsis],
  templateUrl: './card-tile.html',
})
export class CardTile {
  readonly card = input.required<Card>();

  protected readonly store = inject(ForumStore);

  /** true while the card detail modal is open (click the tile's text). */
  protected open = false;

  /** true while the delete-card confirm dialog is open. */
  protected confirming = false;

  private readonly order = computed(() => this.store.cardsIn(this.card().column_id));
  private readonly index = computed(() =>
    this.order().findIndex((card) => card.id === this.card().id),
  );
  protected readonly canUp = computed(() => this.index() > 0);
  protected readonly canDown = computed(() => {
    const index = this.index();
    return index >= 0 && index < this.order().length - 1;
  });
  /**
   * Flattened body snippet for the tile. The snippet carries
   * `[appEllipsis]="3"` — three lines show first, then the directive's CSS
   * clamp draws the "…" plus a hover tooltip; the title stays one line.
   */
  protected readonly excerpt = computed(() =>
    (this.card().body ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
  );

  protected move(delta: number): void {
    const target = this.index() + delta;
    if (target < 0 || target >= this.order().length) return;
    void this.store.moveCard(this.card(), this.card().column_id, target);
  }

  protected setAssignee(value: number | null): void {
    void this.store.setAssignee(this.card().id, value === null ? null : Number(value));
  }

  protected startDelete(): void {
    this.confirming = true;
  }

  protected async remove(): Promise<void> {
    this.confirming = false;
    await this.store.deleteCard(this.card());
  }

  protected onDragStart(event: DragEvent): void {
    this.store.draggingCardId.set(this.card().id);
    event.dataTransfer?.setData('text/plain', String(this.card().id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
}
