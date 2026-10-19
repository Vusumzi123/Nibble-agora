import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ForumStore } from '../../core/forum.store';
import { StatusService } from '../../core/status.service';
import { dragScroll, stopDragScroll } from '../../shared/drag-reorder';
import { Lane } from './lane';

@Component({
  selector: 'app-board',
  imports: [FormsModule, RouterLink, Lane],
  templateUrl: './board.html',
  styleUrl: './board.css',
})
export class BoardPage implements OnInit, OnDestroy {
  protected readonly store = inject(ForumStore);
  private readonly status = inject(StatusService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Board the URL asks for (`/boards/:id`); null = legacy `/board`, keep selection. */
  private readonly paramId = signal<number | null>(null);
  /** One-shot: the inbox handed us this card to reveal once the board renders. */
  private readonly targetCardId = signal<number | null>(null);

  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;

  @ViewChild('colName') private colName?: ElementRef<HTMLInputElement>;
  @ViewChild('nameInput') private nameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('lanesStrip') private lanesStrip?: ElementRef<HTMLElement>;

  protected columnName = '';
  /** The floating "new column" popup and the settings modal are local UI. */
  protected addColumnOpen = false;
  protected settingsOpen = false;
  protected confirmDelete = false;
  protected editName = '';
  protected editDesc = '';

  /** True until the first board/card read settles (or a board is found). */
  private readonly entering = signal(true);
  /** Show the board skeleton only when there is no board to draw yet. */
  protected readonly loadingBoard = computed(
    () =>
      !this.store.currentBoard() &&
      (this.entering() || this.store.boardsLoading() || this.store.cardsLoading()),
  );
  protected readonly skeletonLanes = [1, 2, 3];
  protected readonly skeletonCards = [1, 2, 3];

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.applyParam(params.get('id'));
    });

    // Inbox → project detail hands over the card to land on.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const raw = params.get('card');
      const id = raw === null ? NaN : Number(raw);
      this.targetCardId.set(Number.isInteger(id) && id > 0 ? id : null);
    });

    // Once the cards are rendered, glide the target tile into view and flash it.
    // The effect can outrun change detection, so poll the DOM for a few frames.
    effect((onCleanup) => {
      const target = this.targetCardId();
      if (target === null || !this.store.cards().some((card) => card.id === target)) return;
      let frames = 0;
      let raf = 0;
      const step = (): void => {
        frames += 1;
        const node = this.host.nativeElement.querySelector<HTMLElement>(
          `.kanban-card[data-id="${target}"]`,
        );
        if (node) {
          node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          this.store.focusCard(target);
          this.targetCardId.set(null);
          return;
        }
        if (frames > 60) {
          this.targetCardId.set(null);
          return;
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      onCleanup(() => cancelAnimationFrame(raf));
    });

    // A deep-linked board id that the server doesn't know (or arrives later)
    // falls back to the project list once boards are actually loaded.
    effect(() => {
      const id = this.paramId();
      const boards = this.store.boards();
      if (id === null || boards.length === 0) return;
      if (!boards.some((b) => b.id === id)) void this.router.navigate(['/boards']);
    });
  }

  ngOnInit(): void {
    this.store.setView('board');
    // `dragend` fires on the source tile, but `rows` removes that tile mid-drag,
    // so the event never bubbles to a lane handler. A window listener always
    // runs and guarantees the drag state is cleared (drop, cancel, or Escape).
    window.addEventListener('dragend', this.onWindowDragEnd);
    void this.store.refreshCards().finally(() => this.entering.set(false));
  }

  ngOnDestroy(): void {
    window.removeEventListener('dragend', this.onWindowDragEnd);
    stopDragScroll();
  }

  private readonly onWindowDragEnd = (): void => {
    this.store.draggingCardId.set(null);
    stopDragScroll();
  };

  private applyParam(raw: string | null): void {
    if (raw === null) {
      this.paramId.set(null);
      return;
    }
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      this.paramId.set(null);
      void this.router.navigate(['/boards']);
      return;
    }
    this.paramId.set(id);
    if (id !== this.store.boardId()) void this.store.switchBoard(id);
  }

  // ---- drag auto-scroll ----------------------------------------------------

  /** Keep the strip and the hovered column under the pointer as it drags. */
  protected onDragOverStrip(event: DragEvent): void {
    const strip = this.lanesStrip?.nativeElement;
    if (strip) dragScroll(strip, event);
  }

  protected stopDragScroll(): void {
    stopDragScroll();
  }

  protected async addColumn(): Promise<void> {
    const name = this.columnName.trim();
    if (!name) {
      this.status.flash('column name is required', true);
      return;
    }
    if (await this.store.addColumn(name)) {
      this.columnName = '';
      this.addColumnOpen = false;
    }
  }

  // ---- floating add-column popup -------------------------------------------

  protected toggleAddColumn(): void {
    if (this.addColumnOpen) {
      this.closeAddColumn();
      return;
    }
    this.addColumnOpen = true;
    // the popup is view-bound — let it render before stealing focus.
    setTimeout(() => this.colName?.nativeElement.focus());
  }

  protected closeAddColumn(): void {
    this.addColumnOpen = false;
    this.columnName = '';
  }

  // ---- board settings modal ------------------------------------------------

  protected openSettings(): void {
    const board = this.store.currentBoard();
    if (!board) return;
    this.editName = board.name;
    this.editDesc = board.description ?? '';
    this.confirmDelete = false;
    this.settingsOpen = true;
    setTimeout(() => this.nameInput?.nativeElement.focus());
  }

  protected closeSettings(): void {
    this.settingsOpen = false;
    this.confirmDelete = false;
  }

  protected async saveSettings(): Promise<void> {
    const name = this.editName.trim();
    if (!name) {
      this.status.flash('name is required', true);
      return;
    }
    const description = this.editDesc.trim() || null;
    const current = this.store.currentBoard();
    if (current && current.name === name && (current.description ?? null) === description) {
      this.closeSettings();
      return;
    }
    if (await this.store.updateBoardDetails(name, description)) this.closeSettings();
  }

  protected async deleteProject(): Promise<void> {
    const board = this.store.currentBoard();
    if (!board) return;
    if (await this.store.deleteBoard(board.id)) {
      this.closeSettings();
      void this.router.navigate(['/boards']);
    }
  }
}
