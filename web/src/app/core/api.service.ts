import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import type {
  Agent,
  AppConfig,
  Board,
  Card,
  Column,
  Inbox,
  Limits,
  Me,
  Post,
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

  private request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
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

  listBoards(): Promise<Board[]> {
    return this.request<{ boards: Board[] }>('GET', '/api/boards').then((r) => r.boards);
  }

  listThreads(boardId: number, category?: string): Promise<ThreadSummary[]> {
    const query = category ? `?category=${encodeURIComponent(category)}` : '';
    return this.request<{ threads: ThreadSummary[] }>(
      'GET',
      `/api/boards/${boardId}/threads${query}`,
    ).then((r) => r.threads);
  }

  getThread(id: number): Promise<ThreadDetail> {
    return this.request<ThreadDetail>('GET', `/api/threads/${id}`);
  }

  createThread(input: {
    board_id: number;
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
    patch: { column_id?: number; position?: number; assignee?: number | null; done?: boolean },
  ): Promise<Card> {
    return this.request<{ card: Card }>('PATCH', `/api/cards/${cardId}`, patch).then((r) => r.card);
  }

  addColumn(boardId: number, name: string): Promise<Column> {
    return this.request<{ column: Column }>('POST', `/api/boards/${boardId}/columns`, {
      name,
    }).then((r) => r.column);
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
