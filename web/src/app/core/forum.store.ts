import { Injectable, computed, inject, signal } from '@angular/core';

import { ApiError, ApiService } from './api.service';
import type { Board, Card, ThreadDetail, ThreadSummary, Inbox, Agent, Column } from './models';
import { SessionService } from './session.service';
import { StatusService } from './status.service';

export type View = 'threads' | 'board' | 'inbox';

const POLL_MS = 3000;

@Injectable({ providedIn: 'root' })
export class ForumStore {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);
  private readonly status = inject(StatusService);

  readonly boards = signal<Board[]>([]);
  readonly agents = signal<Agent[]>([]);
  readonly threads = signal<ThreadSummary[]>([]);
  readonly thread = signal<ThreadDetail | null>(null);
  readonly cards = signal<Card[]>([]);
  readonly inbox = signal<Inbox | null>(null);
  readonly category = signal<string>('');
  readonly boardId = signal<number | null>(null);
  readonly view = signal<View>('threads');

  readonly currentBoard = computed<Board | null>(
    () => this.boards().find((b) => b.id === this.boardId()) ?? null,
  );
  readonly columns = computed<Column[]>(() =>
    (this.currentBoard()?.columns ?? []).slice().sort((a, b) => a.position - b.position || a.id - b.id),
  );
  readonly inboxCount = computed(() => {
    const inbox = this.inbox();
    return inbox ? inbox.counts.mentions + inbox.counts.cards : 0;
  });

  private openThreadId: number | null = null;
  private busy = false;
  private lastSig = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  // ---- lifecycle -----------------------------------------------------------

  startPolling(): void {
    this.stopPolling();
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  stopPolling(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One poll cycle, skipped while a request is in flight or a field is focused. */
  async tick(): Promise<void> {
    if (!this.session.connected() || this.busy || isEditing()) return;
    this.busy = true;
    try {
      await this.refreshAll();
      this.lastSig = this.signature();
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy = false;
    }
  }

  // ---- reads ---------------------------------------------------------------

  async refreshBoards(): Promise<void> {
    const boards = await this.api.listBoards();
    this.boards.set(boards);
    if (!this.currentBoard()) {
      // restore the last board this seat used, else fall back to the first.
      const remembered = this.session.boardId();
      const pick = boards.find((b) => b.id === remembered)?.id ?? boards[0]?.id ?? null;
      this.boardId.set(pick);
      if (pick !== null) this.session.rememberBoard(pick);
    }
  }

  async refreshAgents(): Promise<void> {
    this.agents.set(await this.api.listAgents());
  }

  async refreshThreads(): Promise<void> {
    const board = this.boardId();
    if (board === null) {
      this.threads.set([]);
      return;
    }
    this.threads.set(await this.api.listThreads(board, this.category() || undefined));
  }

  async refreshCards(): Promise<void> {
    const board = this.boardId();
    this.cards.set(board === null ? [] : await this.api.listCards(board));
  }

  async refreshInbox(): Promise<void> {
    const me = this.session.me();
    if (!me) return;
    this.inbox.set(await this.api.inbox(me.handle));
  }

  async loadThread(id: number): Promise<void> {
    this.openThreadId = id;
    this.thread.set(await this.api.getThread(id));
  }

  async refreshAll(): Promise<void> {
    await this.refreshBoards();
    await this.refreshAgents();
    switch (this.view()) {
      case 'threads':
        if (this.openThreadId !== null) await this.loadThread(this.openThreadId);
        else await this.refreshThreads();
        break;
      case 'board':
        await this.refreshCards();
        break;
      case 'inbox':
        await this.refreshInbox();
        break;
    }
    if (this.view() !== 'inbox') await this.refreshInbox();
  }

  // ---- navigation ----------------------------------------------------------

  setView(view: View): void {
    this.view.set(view);
    if (view !== 'threads') this.clearThread();
  }

  closeThread(): void {
    this.clearThread();
    this.view.set('threads');
  }

  private clearThread(): void {
    this.openThreadId = null;
    this.thread.set(null);
  }

  async switchBoard(id: number): Promise<void> {
    this.clearThread();
    this.boardId.set(id);
    this.session.rememberBoard(id);
    await this.mutate(async () => undefined);
  }

  async setCategory(category: string): Promise<void> {
    this.category.set(category);
    await this.mutate(() => this.refreshThreads());
  }

  // ---- mutations -----------------------------------------------------------

  async postThread(input: { title: string; category: string; body: string; mentions: string[] }): Promise<boolean> {
    const board = this.boardId();
    if (board === null) return false;
    return this.mutate(async () => {
      await this.api.createThread({ board_id: board, ...input });
      this.status.flash('thread posted');
    });
  }

  async reply(threadId: number, body: string, mentions: string[]): Promise<boolean> {
    return this.mutate(async () => {
      await this.api.reply(threadId, body, mentions);
      this.status.flash('reply posted');
    });
  }

  async toggleReaction(postId: number, emoji: string, remove: boolean): Promise<boolean> {
    return this.mutate(async () => {
      try {
        await this.api.toggleReaction('posts', postId, emoji, remove ? 'remove' : 'add');
      } catch (err) {
        if (!(err instanceof ApiError) || (err.status !== 409 && err.status !== 404)) throw err;
      }
    });
  }

  async addColumn(name: string): Promise<boolean> {
    const board = this.boardId();
    if (board === null) return false;
    return this.mutate(async () => {
      await this.api.addColumn(board, name);
      this.status.flash(`column "${name}" added`);
    });
  }

  async renameColumn(columnId: number, name: string): Promise<boolean> {
    const board = this.boardId();
    if (board === null) return false;
    return this.mutate(async () => {
      await this.api.updateColumn(board, columnId, { name });
      this.status.flash('column renamed');
    });
  }

  async reorderColumn(columnId: number, from: number, delta: number): Promise<boolean> {
    const board = this.boardId();
    if (board === null) return false;
    const order = this.columns().slice();
    const [moved] = order.splice(from, 1);
    if (!moved) return false;
    order.splice(from + delta, 0, moved);
    return this.mutate(async () => {
      for (let i = 0; i < order.length; i++) {
        const col = order[i];
        if (col && col.position !== i) await this.api.updateColumn(board, col.id, { position: i });
      }
      this.status.flash('columns reordered');
    });
  }

  cardsIn(columnId: number): Card[] {
    return this.cards()
      .filter((c) => c.column_id === columnId)
      .sort((a, b) => a.position - b.position || a.id - b.id);
  }

  async moveCard(card: Card, targetColumnId: number, targetIndex: number): Promise<boolean> {
    const members = this.cardsIn(targetColumnId).filter((c) => c.id !== card.id);
    const index = Math.max(0, Math.min(targetIndex, members.length));
    const desired = [...members.slice(0, index), card, ...members.slice(index)];
    return this.mutate(async () => {
      await this.api.patchCard(card.id, { column_id: targetColumnId, position: index });
      for (let i = 0; i < desired.length; i++) {
        const item = desired[i];
        if (item && item.position !== i) await this.api.patchCard(item.id, { position: i });
      }
    });
  }

  async setAssignee(cardId: number, assigneeId: number | null): Promise<boolean> {
    return this.mutate(async () => {
      await this.api.patchCard(cardId, { assignee: assigneeId });
    });
  }

  async toggleDone(card: Card): Promise<boolean> {
    return this.mutate(async () => {
      await this.api.patchCard(card.id, { done: !card.done_at });
    });
  }

  // ---- internals -----------------------------------------------------------

  private async mutate(action: () => Promise<void>): Promise<boolean> {
    try {
      await action();
      await this.refreshAll();
      this.lastSig = this.signature();
      return true;
    } catch (err) {
      this.fail(err);
      return false;
    }
  }

  private fail(err: unknown): void {
    if (err instanceof ApiError && err.status === 401) {
      this.session.leave();
      this.status.flash('token rejected — connect again', true);
      return;
    }
    this.status.flash(err instanceof Error ? err.message : String(err), true);
  }

  private signature(): string {
    return JSON.stringify([
      this.boards(),
      this.agents(),
      this.threads(),
      this.thread(),
      this.cards(),
      this.inbox(),
      this.view(),
      this.category(),
      this.boardId(),
    ]);
  }
}

function isEditing(): boolean {
  const node = document.activeElement as HTMLElement | null;
  if (!node || typeof node.closest !== 'function' || !node.closest('.main')) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
