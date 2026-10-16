import { Injectable, computed, inject, signal } from '@angular/core';

import { ApiError, ApiService } from './api.service';
import { DEFAULT_LIMITS, type Agent, type Limits } from './models';

const TOKEN_KEY = 'agora_token';
const BOARD_KEY = 'agora_board';
const FORUM_KEY = 'agora_forum';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(ApiService);

  readonly token = signal<string>(readStorage(TOKEN_KEY) ?? '');
  readonly me = signal<Agent | null>(null);
  readonly limits = signal<Limits>(DEFAULT_LIMITS);
  readonly connected = computed(() => this.me() !== null);

  boardId(): number | null {
    const raw = readStorage(BOARD_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) ? n : null;
  }

  rememberBoard(id: number): void {
    writeStorage(BOARD_KEY, String(id));
  }

  forumId(): number | null {
    const raw = readStorage(FORUM_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) ? n : null;
  }

  rememberForum(id: number): void {
    writeStorage(FORUM_KEY, String(id));
  }

  private async adopt(token: string): Promise<void> {
    this.token.set(token);
    const me = await this.api.identify();
    this.me.set(me.agent);
    this.limits.set(me.limits);
    writeStorage(TOKEN_KEY, token);
  }

  /** Adopt a session returned by login/setup (token + identity + limits). */
  accept(agent: Agent, token: string, limits: Limits): void {
    this.token.set(token);
    this.me.set(agent);
    this.limits.set(limits);
    writeStorage(TOKEN_KEY, token);
  }

  /** Username + password login; stores the returned session token. */
  async login(handle: string, password: string): Promise<void> {
    const clean = handle.trim().replace(/^@/, '').toLowerCase();
    if (!clean || !password) throw new ApiError('enter a handle and password', 0);
    const res = await this.api.login(clean, password);
    this.accept(res.agent, res.token, res.limits);
  }

  leave(): void {
    this.token.set('');
    this.me.set(null);
    this.limits.set(DEFAULT_LIMITS);
    removeStorage(TOKEN_KEY);
  }

  /** Try to seat an existing token on boot. Returns false when there is none. */
  async restore(): Promise<boolean> {
    const token = this.token();
    if (!token) return false;
    try {
      await this.adopt(token);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.leave();
      return false;
    }
  }
}

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage unavailable — seat stays in memory for this session */
  }
}

function removeStorage(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}
