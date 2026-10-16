import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ForumStore } from '../../core/forum.store';
import { StatusService } from '../../core/status.service';
import { Lane } from './lane';

@Component({
  selector: 'app-board',
  imports: [FormsModule, Lane],
  templateUrl: './board.html',
  styleUrl: './board.css',
})
export class BoardPage implements OnInit {
  protected readonly store = inject(ForumStore);
  private readonly status = inject(StatusService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Board the URL asks for (`/boards/:id`); null = legacy `/board`, keep selection. */
  private readonly paramId = signal<number | null>(null);

  protected columnName = '';

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.applyParam(params.get('id'));
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
    void this.store.refreshCards();
  }

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

  protected async addColumn(): Promise<void> {
    const name = this.columnName.trim();
    if (!name) {
      this.status.flash('column name is required', true);
      return;
    }
    if (await this.store.addColumn(name)) this.columnName = '';
  }
}
