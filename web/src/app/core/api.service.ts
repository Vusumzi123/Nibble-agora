import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type {
  Agent,
  AppConfig,
  Board,
  Card,
  Column,
  Forum,
  ForumOverview,
  Inbox,
  Limits,
  Me,
  Post,
  Project,
  Reaction,
  SetupInput,
  Thread,
  ThreadDetail,
  ThreadSummary,
} from './models';

export interface LoginResult {
  agent: Agent;
  token: string;
  limits: Limits;
}

interface ApiErrorBody {
  error?: { code?: string; field?: string; limit?: number; length?: number; message?: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function describe(err: HttpErrorResponse): ApiError {
  const body = (err.error ?? {}) as ApiErrorBody;
  const detail = body.error ?? {};
  const message =
    detail.code === 'char_limit'
      ? `${detail.field}: ${detail.length}/${detail.limit} characters`
      : detail.message || `HTTP ${err.status}`;
  return new ApiError(message, err.status);
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  private request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    return firstValueFrom(
      this.http.request<T>(method, path, { body: body === undefined ? undefined : body }),
    ).catch((err: unknown) => {
      throw err instanceof HttpErrorResponse ? describe(err) : err;
    });
  }

  identify(): Promise<Me> {
    return this.request<Me>('GET', '/api/me');
  }

  /** Username + password login for human seats; returns the session bearer token. */
  login(handle: string, password: string): Promise<LoginResult> {
    return this.request<LoginResult>('POST', '/api/login', { handle, password });
  }

  /** Public instance config: setup state, forum name, theme. */
  getConfig(): Promise<AppConfig> {
    return this.request<AppConfig>('GET', '/api/config');
  }

  /** First-run: create the admin seat + instance settings. */
  setup(input: SetupInput): Promise<LoginResult & { config: AppConfig }> {
    return this.request('POST', '/api/setup', input);
  }

  updateSettings(patch: { forum_name?: string; theme?: string }): Promise<AppConfig> {
    return this.request<AppConfig>('PATCH', '/api/settings', patch);
  }

  changePassword(current_password: string, new_password: string): Promise<{ ok: boolean }> {
    return this.request('POST', '/api/settings/password', { current_password, new_password });
  }

  register(handle: string, password?: string): Promise<Agent & { token: string }> {
    return this.request('POST', '/api/agents', password ? { handle, password } : { handle });
  }

  listAgents(): Promise<Agent[]> {
    return this.request<{ agents: Agent[] }>('GET', '/api/agents').then((r) => r.agents);
  }

  listBoards(forumId?: number): Promise<Board[]> {
    const query = forumId === undefined ? '' : `?forum=${forumId}`;
    return this.request<{ boards: Board[] }>('GET', `/api/boards${query}`).then((r) => r.boards);
  }

  listForums(): Promise<Forum[]> {
    return this.request<{ forums: Forum[] }>('GET', '/api/forums').then((r) => r.forums);
  }

  createForum(input: {
    name: string;
    description?: string | null;
  }): Promise<Forum> {
    return this.request<{ forum: Forum }>('POST', '/api/forums', input).then((r) => r.forum);
  }

  listProjects(forumId?: number): Promise<Project[]> {
    const query = forumId === undefined ? '' : `?forum=${forumId}`;
    return this.request<{ projects: Project[] }>('GET', `/api/projects${query}`).then(
      (r) => r.projects,
    );
  }

  /** Create a project — the server creates its single board + default columns. */
  createProject(input: {
    name: string;
    description?: string | null;
    forum_id?: number;
  }): Promise<{ project: Project; board: Board; columns: Column[] }> {
    return this.request('POST', '/api/projects', input);
  }

  /** Forum home: counts + recently active threads for one forum. */
  forumOverview(forumId: number): Promise<ForumOverview> {
    return this.request<ForumOverview>('GET', `/api/forums/${forumId}/overview`);
  }

  /** Rename/re-describe a project — the server moves its board row along. */
  updateBoard(
    boardId: number,
    patch: { name?: string; description?: string | null },
  ): Promise<{ board: Board; project: Project | null }> {
    return this.request('PATCH', `/api/boards/${boardId}`, patch);
  }

  /** Delete a project: its board, columns and cards cascade away. */
  deleteBoard(boardId: number): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/api/boards/${boardId}`);
  }

  listThreads(
    forumId: number,
    categories?: string[],
    sort?: string,
    page?: { limit: number; offset: number },
  ): Promise<{ threads: ThreadSummary[]; total: number }> {
    const params = new URLSearchParams();
    for (const cat of categories ?? []) params.append('category', cat);
    if (sort) params.set('sort', sort);
    if (page) {
      params.set('limit', String(page.limit));
      params.set('offset', String(page.offset));
    }
    const query = params.toString() ? `?${params}` : '';
    return this.request<{ threads: ThreadSummary[]; total?: number }>(
      'GET',
      `/api/forums/${forumId}/threads${query}`,
    ).then((r) => ({ threads: r.threads, total: r.total ?? r.threads.length }));
  }

  getThread(id: number): Promise<ThreadDetail> {
    return this.request<ThreadDetail>('GET', `/api/threads/${id}`);
  }

  /** Count one view — the seat fires this once per thread open, never per poll. */
  viewThread(id: number): Promise<{ thread: Thread }> {
    return this.request('POST', `/api/threads/${id}/view`);
  }

  voteThread(id: number, op: 'up' | 'remove'): Promise<{ votes: number; voted: boolean }> {
    return this.request('POST', `/api/threads/${id}/vote`, { op });
  }

  createThread(input: {
    forum_id: number;
    category: string;
    title: string;
    body: string;
    mentions: string[];
  }): Promise<Thread> {
    return this.request<{ thread: Thread }>('POST', '/api/threads', input).then((r) => r.thread);
  }

  reply(threadId: number, body: string, mentions: string[]): Promise<Post> {
    return this.request<{ post: Post }>('POST', `/api/threads/${threadId}/replies`, {
      body,
      mentions,
    }).then((r) => r.post);
  }

  toggleReaction(
    target: 'posts' | 'cards',
    id: number,
    emoji: string,
    op: 'add' | 'remove',
  ): Promise<Reaction[]> {
    return this.request<{ reactions: Reaction[] }>('POST', `/api/${target}/${id}/reactions`, {
      emoji,
      op,
    }).then((r) => r.reactions);
  }

  listCards(boardId: number): Promise<Card[]> {
    return this.request<{ cards: Card[] }>('GET', `/api/boards/${boardId}/cards`).then(
      (r) => r.cards,
    );
  }

  patchCard(
    cardId: number,
    patch: {
      column_id?: number;
      position?: number;
      assignee?: number | null;
      done?: boolean;
      title?: string;
      body?: string;
    },
  ): Promise<Card> {
    return this.request<{ card: Card }>('PATCH', `/api/cards/${cardId}`, patch).then((r) => r.card);
  }

  addColumn(boardId: number, name: string): Promise<Column> {
    return this.request<{ column: Column }>('POST', `/api/boards/${boardId}/columns`, {
      name,
    }).then((r) => r.column);
  }

  createCard(
    boardId: number,
    patch: { column_id?: number; title: string; body?: string },
  ): Promise<Card> {
    return this.request<{ card: Card }>('POST', '/api/cards', {
      board_id: boardId,
      ...patch,
    }).then((r) => r.card);
  }

  deleteColumn(columnId: number): Promise<{ ok: boolean; id: number }> {
    return this.request<{ ok: boolean; id: number }>('DELETE', `/api/columns/${columnId}`);
  }

  deleteCard(cardId: number): Promise<{ ok: boolean; id: number }> {
    return this.request<{ ok: boolean; id: number }>('DELETE', `/api/cards/${cardId}`);
  }

  updateColumn(
    boardId: number,
    columnId: number,
    patch: { name?: string; position?: number },
  ): Promise<Column> {
    return this.request<{ column: Column }>('POST', `/api/boards/${boardId}/columns`, {
      id: columnId,
      ...patch,
    }).then((r) => r.column);
  }

  inbox(handle: string): Promise<Inbox> {
    return this.request<Inbox>('GET', `/api/inbox/${encodeURIComponent(handle)}`);
  }
}
