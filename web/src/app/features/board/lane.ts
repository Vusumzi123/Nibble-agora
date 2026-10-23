import { Component, ElementRef, ViewChild, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ForumStore } from '../../core/forum.store';
import { TranslateService } from '../../core/i18n';
import type { Card, Column } from '../../core/models';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { COLUMN_DRAG_TYPE, acceptsDrag, dropIndex, startDrag } from '../../shared/drag-reorder';
import { Ellipsis } from '../../shared/ellipsis';
import { CardDetail } from './card-detail';
import { CardTile } from './card-tile';

@Component({
  selector: 'app-lane',
  imports: [FormsModule, CardTile, CardDetail, ConfirmDialog, Ellipsis],
  templateUrl: './lane.html',
  styleUrl: './lane.css',
})
export class Lane {
  readonly column = input.required<Column>();
  /** True while the board's cards load for the first time. */
  readonly loading = input(false);

  protected readonly store = inject(ForumStore);
  protected readonly i18n = inject(TranslateService);
  protected readonly cards = computed(() => this.store.cardsIn(this.column().id));
  protected readonly skeletons = [1, 2, 3];

  /** Index (within the column, excluding the dragged card) where a drop would land. */
  private readonly dropAt = signal<number | null>(null);

  /**
   * Cards to render, with an empty landing placeholder at `dropAt` and the
   * dragged card lifted out of the flow — so the other cards shift to make room.
   */
  protected readonly rows = computed(() => {
    const dragged = this.store.draggingCardId();
    const at = this.dropAt();
    const rest = this.cards().filter((card) => card.id !== dragged);
    if (at === null) return rest.map((card) => ({ card, gap: false }));
    const out: { card: Card | null; gap: boolean }[] = [];
    for (let i = 0; i <= rest.length; i++) {
      if (i === at) out.push({ card: null, gap: true });
      const card = rest[i];
      if (card) out.push({ card, gap: false });
    }
    return out;
  });

  @ViewChild('renameInput') private renameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('cardsEl') private cardsEl?: ElementRef<HTMLElement>;

  /** Inline rename of the column name (double-click). */
  protected editing = false;
  protected editName = '';
  /** The new-card modal, opened in edit mode by the header + button. */
  protected creating = false;
  /** true while the delete-column confirm dialog is open. */
  protected confirming = false;
  /** True while a column drag hovers over this lane. */
  protected over = false;

  // ---- column drag & drop --------------------------------------------------

  protected onDragStart(event: DragEvent): void {
    startDrag(event, COLUMN_DRAG_TYPE, this.column().id);
  }

  protected onDragOver(event: DragEvent): void {
    if (!acceptsDrag(event, COLUMN_DRAG_TYPE)) return;
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
    if (!acceptsDrag(event, COLUMN_DRAG_TYPE)) return;
    event.preventDefault();
    this.over = false;

    const columns = this.store.columns();
    const draggedId = Number(event.dataTransfer?.getData(COLUMN_DRAG_TYPE));
    const draggedFrom = columns.findIndex((c) => c.id === draggedId);
    const overIdx = columns.findIndex((c) => c.id === this.column().id);
    if (draggedFrom < 0 || overIdx < 0 || draggedFrom === overIdx) return;

    const target = dropIndex(
      event,
      event.currentTarget as HTMLElement,
      overIdx,
      draggedFrom,
      'x',
    );
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
    this.creating = true;
  }

  // ---- delete column ----------------------------------------------------------

  protected startDelete(): void {
    this.creating = false;
    this.confirming = true;
  }

  protected async deleteColumn(): Promise<void> {
    this.confirming = false;
    await this.store.deleteColumn(this.column().id);
  }

  // ---- cards ---------------------------------------------------------------

  /** Card drop target: accept the drag and park the landing placeholder.
      `getData` is unavailable during dragover in browsers, so a card drag is
      detected via its `text/plain` type; the id is already on the store from
      the tile's dragstart. */
  protected onCardsDragOver(event: DragEvent): void {
    if (!acceptsDrag(event, 'text/plain')) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dropAt.set(this.computeDropIndex(event));
  }

  protected onCardsDragLeave(event: DragEvent): void {
    const to = event.relatedTarget as Node | null;
    const from = event.currentTarget as HTMLElement | null;
    if (to && from?.contains(to)) return;
    this.dropAt.set(null);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    const at = this.dropAt() ?? this.computeDropIndex(event);
    this.dropAt.set(null);
    const id = Number(event.dataTransfer?.getData('text/plain'));
    const card = this.store.cards().find((c) => c.id === id);
    this.store.draggingCardId.set(null);
    if (!card) return;
    void this.store.moveCard(card, this.column().id, at);
  }

  /** Fallback when there was no prior dragover (e.g. a bare drop). */
  private computeDropIndex(event: DragEvent): number {
    const body = this.cardsEl?.nativeElement;
    const nodes = body
      ? [...body.querySelectorAll<HTMLElement>('.kanban-card:not(.kanban-card--placeholder)')]
      : [];
    let at = nodes.length;
    for (let i = 0; i < nodes.length; i++) {
      const rect = nodes[i]?.getBoundingClientRect();
      if (rect && event.clientY < rect.top + rect.height / 2) {
        at = i;
        break;
      }
    }
    return at;
  }
}
