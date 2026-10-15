import { Component, computed, inject, input } from '@angular/core';

import { ForumStore } from '../../core/forum.store';
import type { Column } from '../../core/models';
import { CardTile } from './card-tile';

@Component({
  selector: 'app-lane',
  imports: [CardTile],
  templateUrl: './lane.html',
  styleUrl: './lane.css',
})
export class Lane {
  readonly column = input.required<Column>();
  readonly index = input.required<number>();
  readonly total = input.required<number>();

  protected readonly store = inject(ForumStore);
  protected readonly cards = computed(() => this.store.cardsIn(this.column().id));

  protected allow(event: DragEvent): void {
    event.preventDefault();
  }

  protected async rename(): Promise<void> {
    const value = prompt('rename column', this.column().name);
    if (!value || value.trim() === this.column().name) return;
    await this.store.renameColumn(this.column().id, value.trim());
  }

  protected move(delta: number): void {
    void this.store.reorderColumn(this.column().id, this.index(), delta);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    const id = Number(event.dataTransfer?.getData('text/plain'));
    const card = this.store.cards().find((c) => c.id === id);
    const body = event.currentTarget as HTMLElement | null;
    if (!card || !body) return;

    const nodes = [...body.querySelectorAll<HTMLElement>('.kanban-card')];
    let index = nodes.length;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    if (card.column_id === this.column().id) {
      const from = this.cards().findIndex((c) => c.id === card.id);
      if (from !== -1 && index > from) index -= 1;
    }
    void this.store.moveCard(card, this.column().id, index);
  }
}
