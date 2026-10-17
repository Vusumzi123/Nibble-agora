import { Component, ElementRef, ViewChild, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ForumStore } from '../../core/forum.store';
import type { Column } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { Ellipsis } from '../../shared/ellipsis';
import { CardTile } from './card-tile';

/** Custom mime that marks a drag as "column being moved". */
const COLUMN_MIME = 'application/x-nibble-column';

@Component({
  selector: 'app-lane',
  imports: [FormsModule, CardTile, ConfirmDialog, Ellipsis],
  templateUrl: './lane.html',
  styleUrl: './lane.css',
})
export class Lane {
  readonly column = input.required<Column>();

  protected readonly store = inject(ForumStore);
  protected readonly cards = computed(() => this.store.cardsIn(this.column().id));

  @ViewChild('renameInput') private renameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('newcardInput') private newcardInput?: ElementRef<HTMLInputElement>;

  /** Inline rename of the column name (double-click). */
  protected editing = false;
  protected editName = '';
  /** Inline "new card" strip under the header. */
  protected adding = false;
  protected newTitle = '';
  /** true while the delete-column confirm dialog is open. */
  protected confirming = false;
  /** True while a column drag hovers over this lane. */
  protected over = false;

  // ---- column drag & drop --------------------------------------------------

  protected onDragStart(event: DragEvent): void {
    const dt = event.dataTransfer;
    if (!dt) return;
    dt.effectAllowed = 'move';
    dt.setData(COLUMN_MIME, String(this.column().id));
  }

  protected onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes(COLUMN_MIME)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.over = true;
  }

  protected onDragLeave(event: DragEvent): void {
    const to = event.relatedTarget as Node | null;
    const from = event.currentTarget as HTMLElement | null;
    if (to && from?.contains(to)) return;
    this.over = false;
  }

  protected onLaneDrop(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes(COLUMN_MIME)) return;
    event.preventDefault();
    this.over = false;

    const columns = this.store.columns();
    const draggedId = Number(event.dataTransfer.getData(COLUMN_MIME));
    const draggedFrom = columns.findIndex((c) => c.id === draggedId);
    const overIdx = columns.findIndex((c) => c.id === this.column().id);
    if (draggedFrom < 0 || overIdx < 0 || draggedFrom === overIdx) return;

    // Which half of this lane? Left half → insert before it, right half → after.
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    let target = event.clientX < rect.left + rect.width / 2 ? overIdx : overIdx + 1;
    if (draggedFrom < target) target -= 1;
    if (target === draggedFrom) return;
    void this.store.reorderColumn(draggedId, draggedFrom, target - draggedFrom);
  }

  // ---- inline rename (double-click the name) --------------------------------

  protected startRename(): void {
    if (this.editing) return;
    this.editName = this.column().name;
    this.editing = true;
    // the input is view-bound — let it render before focusing/selecting.
    setTimeout(() => this.renameInput?.nativeElement.select());
  }

  protected commitRename(): void {
    if (!this.editing) return;
    this.editing = false;
    const name = this.editName.trim();
    if (!name || name === this.column().name) return;
    void this.store.renameColumn(this.column().id, name);
  }

  protected cancelRename(): void {
    this.editing = false;
  }

  // ---- new card -------------------------------------------------------------

  protected startAddCard(): void {
    this.confirming = false;
    this.adding = true;
    setTimeout(() => this.newcardInput?.nativeElement.focus());
  }

  protected async addCard(): Promise<void> {
    const title = this.newTitle.trim();
    if (!title) {
      this.cancelAddCard();
      return;
    }
    // keep the strip open for rapid entry; Esc or blur closes it.
    if (await this.store.addCard(this.column().id, title)) this.newTitle = '';
  }

  protected cancelAddCard(): void {
    this.adding = false;
    this.newTitle = '';
  }

  // ---- delete column ----------------------------------------------------------

  protected startDelete(): void {
    this.adding = false;
    this.newTitle = '';
    this.confirming = true;
  }

  protected async deleteColumn(): Promise<void> {
    this.confirming = false;
    await this.store.deleteColumn(this.column().id);
  }

  // ---- cards ---------------------------------------------------------------

  protected allow(event: DragEvent): void {
    event.preventDefault();
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
