import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ForumStore } from '../../core/forum.store';
import type { Card } from '../../core/models';

@Component({
  selector: 'app-card-tile',
  imports: [FormsModule],
  templateUrl: './card-tile.html',
  styleUrl: './card-tile.css',
})
export class CardTile {
  readonly card = input.required<Card>();

  protected readonly store = inject(ForumStore);

  private readonly columnIndex = computed(() =>
    this.store.columns().findIndex((c) => c.id === this.card().column_id),
  );
  protected readonly canLeft = computed(() => this.columnIndex() > 0);
  protected readonly canRight = computed(
    () => this.columnIndex() < this.store.columns().length - 1,
  );
  protected readonly excerpt = computed(() => (this.card().description ?? '').split('\n')[0]?.slice(0, 120) ?? '');

  protected move(delta: number): void {
    const target = this.store.columns()[this.columnIndex() + delta];
    if (!target) return;
    const index = this.store.cardsIn(target.id).length;
    void this.store.moveCard(this.card(), target.id, index);
  }

  protected setAssignee(value: number | null): void {
    void this.store.setAssignee(this.card().id, value === null ? null : Number(value));
  }

  protected toggleDone(): void {
    void this.store.toggleDone(this.card());
  }

  protected onDragStart(event: DragEvent): void {
    event.dataTransfer?.setData('text/plain', String(this.card().id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
}
