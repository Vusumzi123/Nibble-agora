import { Injectable, computed, inject, signal } from '@angular/core';

import { ApiError, ApiService } from './api.service';
import { BusyService } from './busy.service';
import type {
  Agent,
  Board,
  Card,
  Column,
  Forum,
  ForumOverview,
  Inbox,
  Project,
  ThreadDetail,
  ThreadSummary,
} from './models';
import { SessionService } from './session.service';
import { StatusService } from './status.service';

export type View = 'threads' | 'board' | 'boards' | 'forum' | 'inbox' | 'settings';
export type ThreadSort = 'updated' | 'created' | 'votes' | 'views';

const POLL_MS = 3000;

/** Threads fetched per batch; the list grows by one batch per sentinel hit. */
export const THREAD_PAGE_SIZE = 20;

/** Replies fetched per batch when scrolling up a thread. */
export const REPLY_PAGE_SIZE = 10;

/** Minimum time a batch's loading state stays visible, so the dots read as motion. */
const MIN_LOADING_MS = 1000;
/** Older replies stay behind the dots at least this long — same beat as the
    thread list, longer because the prepend is anchored mid-scroll. */
const MIN_OLDER_LOAD_MS = 2000;

@Injectable({ providedIn: 'root' })
export class ForumStore {
  private readonly api = inject(ApiService);
  readonly session = inject(SessionService);
  private readonly status = inject(StatusService);
  private readonly curtain = inject(BusyService);

  readonly forums = signal<Forum[]>([]);
  readonly boards = signal<Board[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly overview = signal<ForumOverview | null>(null);
  readonly agents = signal<Agent[]>([]);
  readonly threads = signal<ThreadSummary[]>([]);
  /** How many threads the list is allowed to hold — grows as the sentinel fires. */
  readonly threadLimit = signal<number>(THREAD_PAGE_SIZE);
  readonly threadTotal = signal<number>(0);
  readonly hasMoreThreads = computed(() => this.threads().length < this.threadTotal());
  /** True while a batch is in flight (incl. the minimum visible beat). */
  readonly loadingMore = signal(false);
  /** True only while the list re-enters (a fresh first batch, not a poll). */
  readonly threadsReloading = signal(false);
  readonly thread = signal<ThreadDetail | null>(null);
  /** True while the thread head (entry + meta) loads — replies are separate. */
  readonly threadLoading = signal(false);
  /** True while the newest reply page loads. */
  readonly repliesLoading = signal(false);
  /** True while an older reply page is being prepended. */
  readonly repliesLoadingMore = signal(false);
  /** Replies that exist on the server, however many are loaded. */
  readonly repliesTotal = signal(0);
  /** Index of the first loaded reply — >0 means older pages remain. */
  readonly repliesOffset = signal(0);
  readonly hasOlderReplies = computed(
    () => this.repliesOffset() > 0 && !this.repliesLoading(),
  );
  readonly cards = signal<Card[]>([]);
  readonly inbox = signal<Inbox | null>(null);
  /** Empty = all categories; multiple selections narrow the list (OR). */
  readonly categories = signal<string[]>([]);
  readonly sort = signal<ThreadSort>('updated');
  readonly forumId = signal<number | null>(null);
  readonly boardId = signal<number | null>(null);
  readonly view = signal<View>('threads');

  readonly currentForum = computed<Forum | null>(
    () => this.forums().find((f) => f.id === this.forumId()) ?? null,
  );
  readonly currentBoard = computed<Board | null>(
    () => this.boards().find((b) => b.id === this.boardId()) ?? null,
  );
  readonly columns = computed<Column[]>(() =>
    (this.currentBoard()?.columns ?? [])
      .slice()
      .sort((a, b) => a.position - b.position || a.id - b.id),
  );
  readonly inboxCount = computed(() => {
    const inbox = this.inbox();
    return inbox ? inbox.counts.mentions + inbox.counts.cards : 0;
  });

  private openThreadId: number | null = null;
  private busy = false;
  /** Overridable so tests (and future tuning) need not wait out the beat. */
  minOlderLoadMs = MIN_OLDER_LOAD_MS;
  private lastSig = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private forumsLoad: Promise<void> | null = null;

  // ---- lifecycle -----------------------------------------------------------

  startPolling(): void {
    this.stopPolling();
    // one cycle now, so a reload never waits out the first interval.
    void this.tick();
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

  async refreshForums(): Promise<void> {
    // Join an in-flight load instead of stacking a second one: boot fires the
    // first poll while the entered page is already asking for its own data.
    this.forumsLoad ??= this.fetchForums().finally(() => {
      this.forumsLoad = null;
    });
    return this.forumsLoad;
  }

  private async fetchForums(): Promise<void> {
    const forums = await this.api.listForums();
    this.forums.set(forums);
    if (this.forumId() === null || !forums.some((f) => f.id === this.forumId())) {
      // restore the last forum this seat used, else fall back to the first.
      const remembered = this.session.forumId();
      const pick = forums.find((f) => f.id === remembered)?.id ?? forums[0]?.id ?? null;
      this.forumId.set(pick);
      if (pick !== null) this.session.rememberForum(pick);
    }
  }

  /** Forum-scoped reads learn the active forum themselves; boot or the poll
      usually has it already, so the hot path is a plain null check. */
  private async ensureForum(): Promise<void> {
    try {
      await this.refreshForums();
    } catch {
      /* forums stay unloaded — the scoped read falls back to empty/unscoped */
    }
  }

  async refreshBoards(): Promise<void> {
    if (this.forumId() === null) await this.ensureForum();
    const boards = await this.api.listBoards(this.forumId() ?? undefined);
    this.boards.set(boards);
    if (!this.currentBoard()) {
      // restore the last board this seat used, else fall back to the first.
      const remembered = this.session.boardId();
      const pick = boards.find((b) => b.id === remembered)?.id ?? boards[0]?.id ?? null;
      this.boardId.set(pick);
      if (pick !== null) this.session.rememberBoard(pick);
    }
  }

  async refreshProjects(): Promise<void> {
    if (this.forumId() === null) await this.ensureForum();
    this.projects.set(await this.api.listProjects(this.forumId() ?? undefined));
  }

  async refreshOverview(): Promise<void> {
    if (this.forumId() === null) await this.ensureForum();
    const forum = this.forumId();
    this.overview.set(forum === null ? null : await this.api.forumOverview(forum));
  }

  async refreshAgents(): Promise<void> {
    this.agents.set(await this.api.listAgents());
  }

  private async fetchThreadsWindow(): Promise<{ threads: ThreadSummary[]; total: number }> {
    const forum = this.forumId();
    if (forum === null) return { threads: [], total: 0 };
    return this.api.listThreads(forum, this.categories(), this.sort(), {
      limit: this.threadLimit(),
      offset: 0,
    });
  }

  async refreshThreads(): Promise<void> {
    if (this.forumId() === null) await this.ensureForum();
    const { threads, total } = await this.fetchThreadsWindow();
    this.threads.set(threads);
    this.threadTotal.set(total);
  }

  /** Entering the list: first batch only, fetched now — never a stale window. */
  async reloadThreads(): Promise<void> {
    this.resetPaging();
    this.threadsReloading.set(true);
    try {
      await this.refreshThreads();
    } catch (err) {
      this.fail(err);
    } finally {
      this.threadsReloading.set(false);
    }
  }

  /** Pull one more batch of threads; no-op while exhausted or already loading. */
  async loadMoreThreads(): Promise<void> {
    if (!this.hasMoreThreads() || this.loadingMore()) return;
    this.loadingMore.set(true);
    const started = Date.now();
    const before = this.threadLimit();
    this.threadLimit.set(before + THREAD_PAGE_SIZE);
    const sig = this.listSig();
    try {
      const page = await this.fetchThreadsWindow();
      // hold the batch back until the beat is up: committing early would grow
      // the list above the sentinel and push the dots off-screen instantly.
      const left = MIN_LOADING_MS - (Date.now() - started);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      // drop it if the board/filter/sort changed while we were fetching.
      if (this.listSig() === sig) {
        this.threads.set(page.threads);
        this.threadTotal.set(page.total);
      }
    } catch (err) {
      if (this.threadLimit() === before + THREAD_PAGE_SIZE) this.threadLimit.set(before);
      this.fail(err);
    } finally {
      this.loadingMore.set(false);
    }
  }

  /** Identity of the current thread-list query — a change mid-flight voids a batch. */
  private listSig(): string {
    return JSON.stringify([this.forumId(), this.categories(), this.sort(), this.threadLimit()]);
  }

  async refreshCards(): Promise<void> {
    // legacy `/board` has no id in the URL — learn the picked board first.
    if (this.boardId() === null) await this.refreshBoards().catch(() => {});
    const board = this.boardId();
    this.cards.set(board === null ? [] : await this.api.listCards(board));
  }

  async refreshInbox(): Promise<void> {
    const me = this.session.me();
    if (!me) return;
    this.inbox.set(await this.api.inbox(me.handle));
  }

  /** "Mark all read" on the inbox page — clears every unread mention. */
  async markInboxRead(): Promise<boolean> {
    const me = this.session.me();
    if (!me) return false;
    return this.mutate(async () => {
      await this.api.markInboxRead(me.handle);
      this.status.flash('mentions marked read');
    });
  }

  /** Open a thread: the head lands first, then the newest reply page. The two
      sections track their own loading flags, so the entry renders while the
      responses are still in flight. */
  async openThread(id: number): Promise<void> {
    const firstOpen = this.openThreadId !== id;
    this.openThreadId = id;
    this.thread.set(null);
    this.repliesTotal.set(0);
    this.repliesOffset.set(0);
    this.threadLoading.set(true);
    this.repliesLoading.set(true);
    if (firstOpen) {
      // count the view once per open — polling must not inflate it.
      try {
        await this.api.viewThread(id);
      } catch {
        /* view counting is best-effort; the thread still loads */
      }
    }
    try {
      const head = await this.api.getThread(id, { limit: 0 });
      if (this.openThreadId !== id) return;
      this.thread.set(head);
      this.repliesTotal.set(head.replies_total ?? 0);
      this.threadLoading.set(false);

      const total = this.repliesTotal();
      const offset = Math.max(0, total - REPLY_PAGE_SIZE);
      const page = await this.api.getThread(id, { limit: REPLY_PAGE_SIZE, offset });
      if (this.openThreadId !== id) return;
      this.thread.set(page);
      this.repliesTotal.set(page.replies_total ?? total);
      this.repliesOffset.set(offset);
    } catch (err) {
      if (this.openThreadId === id) this.fail(err);
    } finally {
      if (this.openThreadId === id) {
        this.threadLoading.set(false);
        this.repliesLoading.set(false);
      }
    }
  }

  /** Scroll-up pagination: prepend the previous reply page, keeping the
      loaded suffix anchored on the newest reply. */
  async loadOlderReplies(): Promise<void> {
    const id = this.openThreadId;
    if (
      id === null ||
      !this.hasOlderReplies() ||
      this.repliesLoading() ||
      this.repliesLoadingMore()
    ) {
      return;
    }
    const total = this.repliesTotal();
    const offset = Math.max(0, this.repliesOffset() - REPLY_PAGE_SIZE);
    // Ask only for the replies that are missing: when the window is not
    // page-aligned a full page would overlap (and duplicate) what is loaded.
    const limit = this.repliesOffset() - offset;
    const started = Date.now();
    this.repliesLoadingMore.set(true);
    try {
      const page = await this.api.getThread(id, { limit, offset });
      // hold the prepend back until the beat is up, so the dots are seen and
      // the anchoring lands on the settled layout.
      const left = this.minOlderLoadMs - (Date.now() - started);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      if (this.openThreadId !== id) return;
      const current = this.thread();
      if (current?.thread.id === id) {
        this.thread.set({
          ...page,
          posts: [page.posts[0], ...page.posts.slice(1), ...current.posts.slice(1)],
        });
      } else {
        this.thread.set(page);
      }
      this.repliesTotal.set(page.replies_total ?? total);
      this.repliesOffset.set(offset);
    } catch (err) {
      if (this.openThreadId === id) this.fail(err);
    } finally {
      if (this.openThreadId === id) this.repliesLoadingMore.set(false);
    }
  }

  /** Silent poll refresh of the open thread — keeps the loaded reply window
      (anything new is picked up because the window runs to the newest reply). */
  async loadThread(id: number): Promise<void> {
    if (this.openThreadId !== id || this.thread() === null) return;
    const head = await this.api.getThread(id, { limit: 0 });
    if (this.openThreadId !== id) return;
    const total = head.replies_total ?? 0;
    const offset = Math.min(this.repliesOffset(), Math.max(0, total));
    const page =
      total > offset
        ? await this.api.getThread(id, { limit: Math.min(total - offset, 500), offset })
        : head;
    if (this.openThreadId !== id) return;
    this.thread.set(page);
    this.repliesTotal.set(page.replies_total ?? total);
    this.repliesOffset.set(offset);
  }

  /** One refresh cycle: forums always (the panel + every scoped read needs
      them), then only what the active view renders — in parallel, not as a
      serial chain that makes each module wait for the previous one. */
  async refreshAll(): Promise<void> {
    await this.refreshForums();
    const jobs: Promise<void>[] = [this.refreshInbox()];
    switch (this.view()) {
      case 'threads':
        if (this.openThreadId !== null) jobs.push(this.loadThread(this.openThreadId));
        // a held batch owns the list window until it commits; polling must not
        // reveal it early (threadLimit is already bumped during the hold).
        else if (!this.loadingMore()) jobs.push(this.refreshThreads());
        break;
      case 'board':
        // the card list hangs off the picked board — boards must land first.
        await this.refreshBoards();
        jobs.push(this.refreshCards(), this.refreshAgents());
        break;
      case 'boards':
        jobs.push(this.refreshBoards(), this.refreshProjects());
        break;
      case 'forum':
        jobs.push(this.refreshBoards(), this.refreshProjects(), this.refreshOverview());
        break;
      case 'inbox':
      case 'settings':
        // only the forums + the inbox badge render from here.
        break;
    }
    await Promise.all(jobs);
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
    this.threadLoading.set(false);
    this.repliesLoading.set(false);
    this.repliesLoadingMore.set(false);
    this.repliesTotal.set(0);
    this.repliesOffset.set(0);
  }

  /** A new board/filter/sort starts over at the first batch. */
  private resetPaging(): void {
    this.threadLimit.set(THREAD_PAGE_SIZE);
  }

  async switchBoard(id: number): Promise<void> {
    this.clearThread();
    this.resetPaging();
    this.boardId.set(id);
    this.session.rememberBoard(id);
    await this.mutate(async () => undefined);
  }

  /** Select a forum: its boards, projects and threads all reload. */
  async switchForum(id: number): Promise<void> {
    if (id === this.forumId()) return;
    this.clearThread();
    this.resetPaging();
    this.forumId.set(id);
    this.session.rememberForum(id);
    // the previous board belongs to another forum; let refreshBoards re-pick one.
    this.boardId.set(null);
    await this.mutate(async () => undefined);
  }

  async setCategories(categories: string[]): Promise<void> {
    this.resetPaging();
    this.categories.set(categories);
    await this.mutate(() => this.refreshThreads());
  }

  /** Click a tag: add it to (or drop it from) the active filter set. */
  async toggleCategory(category: string): Promise<void> {
    const active = this.categories();
    await this.setCategories(
      active.includes(category) ? active.filter((c) => c !== category) : [...active, category],
    );
  }

  async setSort(sort: ThreadSort): Promise<void> {
    this.resetPaging();
    this.sort.set(sort);
    await this.mutate(() => this.refreshThreads());
  }

  // ---- mutations -----------------------------------------------------------

  async postThread(input: {
    title: string;
    category: string;
    body: string;
    mentions: string[];
  }): Promise<boolean> {
    const forum = this.forumId();
    if (forum === null) return false;
    return this.mutate(async () => {
      await this.api.createThread({ forum_id: forum, ...input });
      this.status.flash('thread posted');
    }, 'posting thread');
  }

  async voteThread(threadId: number, remove: boolean): Promise<boolean> {
    return this.mutate(async () => {
      const res = await this.api.voteThread(threadId, remove ? 'remove' : 'up');
      const detail = this.thread();
      if (detail && detail.thread.id === threadId) {
        this.thread.set({
          ...detail,
          voted: res.voted,
          thread: { ...detail.thread, votes: res.votes },
        });
      }
      this.status.flash(remove ? 'vote removed' : 'thread upvoted');
    }, remove ? 'removing vote' : 'upvoting thread');
  }

  async reply(threadId: number, body: string, mentions: string[]): Promise<boolean> {
    return this.mutate(async () => {
      await this.api.reply(threadId, body, mentions);
      this.status.flash('reply posted');
    }, 'posting reply');
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

  /** Create a project; the server also creates its single board + columns. */
  async createProject(
    name: string,
    description: string | null,
  ): Promise<{ project: Project; board: Board } | null> {
    const forum = this.forumId();
    if (forum === null) return null;
    let created: { project: Project; board: Board } | null = null;
    const ok = await this.mutate(async () => {
      created = await this.api.createProject({
        name,
        description: description || null,
        forum_id: forum,
      });
      this.status.flash(`project "${name}" created`);
    }, 'creating project');
    return ok ? created : null;
  }

  /** Create a forum (top-level workspace); selects it once created. */
  async createForum(name: string, description: string | null): Promise<Forum | null> {
    let forum: Forum | null = null;
    const ok = await this.mutate(async () => {
      forum = await this.api.createForum({ name, description: description || null });
      this.status.flash(`forum "${name}" created`);
    });
    if (ok && forum) await this.switchForum((forum as Forum).id);
    return ok ? forum : null;
  }

  async addColumn(name: string): Promise<boolean> {
    const board = this.boardId();
    if (board === null) return false;
    return this.mutate(async () => {
      await this.api.addColumn(board, name);
      this.status.flash(`column "${name}" added`);
    });
  }

  async addCard(columnId: number, title: string): Promise<boolean> {
    const board = this.boardId();
    if (board === null) return false;
    return this.mutate(async () => {
      await this.api.createCard(board, { column_id: columnId, title });
      this.status.flash('card added');
    });
  }

  /** Delete a column; the server cascades its cards and re-denses positions. */
  async deleteColumn(columnId: number): Promise<boolean> {
    if (this.boardId() === null) return false;
    return this.mutate(async () => {
      await this.api.deleteColumn(columnId);
      this.status.flash('column deleted');
    });
  }

  /** Rename / re-describe the open project (server moves both rows). */
  async updateBoardDetails(name: string, description: string | null): Promise<boolean> {
    const board = this.boardId();
    if (board === null) return false;
    return this.mutate(async () => {
      await this.api.updateBoard(board, { name, description });
      this.status.flash('project updated');
    });
  }

  /** Delete a project (and everything hanging off its board). */
  async deleteBoard(boardId: number): Promise<boolean> {
    return this.mutate(async () => {
      await this.api.deleteBoard(boardId);
      this.status.flash('project deleted');
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

  async deleteCard(card: Card): Promise<boolean> {
    return this.mutate(async () => {
      await this.api.deleteCard(card.id);
      this.status.flash('card deleted');
    });
  }

  /** Card detail modal save — rewrite title/body (either may be omitted). */
  async updateCard(cardId: number, patch: { title?: string; body?: string }): Promise<boolean> {
    return this.mutate(async () => {
      await this.api.patchCard(cardId, patch);
      this.status.flash('card updated');
    });
  }

  // ---- internals -----------------------------------------------------------

  private async mutate(action: () => Promise<void>, blocking?: string): Promise<boolean> {
    const work = async () => {
      await action();
      await this.refreshAll();
      this.lastSig = this.signature();
    };
    try {
      if (blocking) await this.curtain.run(blocking, work);
      else await work();
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
      this.forums(),
      this.boards(),
      this.projects(),
      this.overview(),
      this.agents(),
      this.threads(),
      this.thread(),
      this.cards(),
      this.inbox(),
      this.view(),
      this.categories(),
      this.sort(),
      this.forumId(),
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
