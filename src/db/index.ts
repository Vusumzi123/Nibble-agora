import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Db } from './sqlite.ts';
import { migrate } from './migrate.ts';
import { hashPassword } from './passwords.ts';
import type { Agent, Board, Column, EventRow } from './types.ts';

export { Db } from './sqlite.ts';
export { migrate, migrationState } from './migrate.ts';
export type * from './types.ts';
export { hashPassword, verifyPassword, randomPassword } from './passwords.ts';

/** Default columns seeded for every new board (plan §Data model). */
export const DEFAULT_COLUMNS = ['inbox', 'todo', 'doing', 'done', 'dropped'] as const;

export function openDb(dbPath: string): Db {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Db(dbPath);
  migrate(db);
  return db;
}

/**
 * Append to the audit journal. Every mutation goes through here.
 * `payload` must already be JSON-serialisable; it is stored as text.
 */
export function logEvent(
  db: Db,
  e: { actorId?: number | null; action: string; target?: string | null; payload?: unknown },
): number {
  const payload = e.payload === undefined ? null : JSON.stringify(e.payload);
  const r = db.run(
    'INSERT INTO events (actor_id, action, target, payload) VALUES (?, ?, ?, ?)',
    e.actorId ?? null,
    e.action,
    e.target ?? null,
    payload,
  );
  return r.lastInsertRowid;
}

export function listEvents(db: Db, limit = 100): (EventRow & { payload_json: unknown })[] {
  const rows = db.all<EventRow>('SELECT * FROM events ORDER BY id DESC LIMIT ?', limit);
  return rows.map((r) => ({
    ...r,
    payload_json: r.payload ? safeParse(r.payload) : null,
  }));
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface SeedResult {
  board: Board;
  columns: Column[];
  created: boolean;
  /** Root seat credential, present only when it was created or reset now. */
  root: { id: number; handle: string; password: string } | null;
}

export interface SeedConfig {
  defaultBoard: string;
  defaultBoardName: string;
  defaultBoardDescription: string;
  /** Root human handle (default `root`). */
  rootHandle?: string;
  /** Explicit root password; when absent a strong one is generated once. */
  rootPassword?: string;
}

/**
 * Idempotent first-boot seed: the default board with its five columns. An admin
 * seat is created **only** when an explicit `rootPassword` is configured
 * (automated deploys); otherwise the instance starts unconfigured and the first
 * admin is created by the `/setup` wizard. Only the scrypt hash is stored.
 */
export function seedDefaults(db: Db, cfg: SeedConfig): SeedResult {
  let created = false;

  let board = db.get<Board>('SELECT * FROM boards WHERE slug = ?', cfg.defaultBoard);
  if (!board) {
    created = true;
    const now = new Date().toISOString();
    db.run(
      'INSERT INTO boards (name, slug, description, created_by, created_at) VALUES (?, ?, ?, NULL, ?)',
      cfg.defaultBoardName,
      cfg.defaultBoard,
      cfg.defaultBoardDescription || null,
      now,
    );
    board = db.get<Board>('SELECT * FROM boards WHERE slug = ?', cfg.defaultBoard)!;
    DEFAULT_COLUMNS.forEach((name, i) => {
      db.run(
        'INSERT INTO columns (board_id, name, position, wip_limit) VALUES (?, ?, ?, NULL)',
        board!.id,
        name,
        i,
      );
    });
    logEvent(db, {
      action: 'board.seed',
      target: `board:${board.id}`,
      payload: { slug: cfg.defaultBoard, columns: [...DEFAULT_COLUMNS] },
    });
  }

  const columns = db.all<Column>(
    'SELECT * FROM columns WHERE board_id = ? ORDER BY position',
    board.id,
  );

  let root: SeedResult['root'] = null;
  if (cfg.rootPassword && cfg.rootPassword.length > 0) {
    const handle = cfg.rootHandle?.trim().replace(/^@/, '').toLowerCase() || 'root';
    const existing = db.get<Agent>('SELECT * FROM agents WHERE handle = ?', handle);
    if (!existing) {
      db.run(
        'INSERT INTO agents (handle, display_name, token_hash, password_hash, is_human, color, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
        handle,
        'Root',
        hashToken(newToken()),
        hashPassword(cfg.rootPassword),
        '#e0a458',
        new Date().toISOString(),
      );
      const row = db.get<Agent>('SELECT * FROM agents WHERE handle = ?', handle)!;
      logEvent(db, {
        actorId: row.id,
        action: 'agent.seed',
        target: `agent:${row.id}`,
        payload: { handle, role: 'root' },
      });
      root = { id: row.id, handle: row.handle, password: cfg.rootPassword };
      created = true;
    } else {
      // An explicit password (env/config) always (re)sets the admin credential.
      db.run('UPDATE agents SET password_hash = ? WHERE id = ?', hashPassword(cfg.rootPassword), existing.id);
      logEvent(db, { actorId: existing.id, action: 'agent.password_reset', target: `agent:${existing.id}` });
      root = { id: existing.id, handle: existing.handle, password: cfg.rootPassword };
    }
  }

  return { board, columns, created, root };
}

// ---------------------------------------------------------------------------
// Tokens — bearer credentials, shown once, stored only as a SHA-256 hash.
// ---------------------------------------------------------------------------

export function newToken(): string {
  return `agr_${randomBytes(24).toString('base64url')}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function verifyToken(agent: Pick<Agent, 'token_hash'>, presented: string): boolean {
  const a = Buffer.from(agent.token_hash, 'utf8');
  const b = Buffer.from(hashToken(presented), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function findAgentByToken(db: Db, token: string): Agent | undefined {
  if (!token) return undefined;
  const hash = hashToken(token);
  return db.get<Agent>('SELECT * FROM agents WHERE token_hash = ?', hash);
}

export function findAgentByHandle(db: Db, handle: string): Agent | undefined {
  return db.get<Agent>('SELECT * FROM agents WHERE handle = ?', handle);
}

// ---------------------------------------------------------------------------
// Settings — instance configuration (forum name, theme, …)
// ---------------------------------------------------------------------------

export function getSetting(db: Db, key: string): string | undefined {
  return db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
    new Date().toISOString(),
  );
}

export function allSettings(db: Db): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of db.all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
    out[row.key] = row.value;
  }
  return out;
}

/** An instance is set up once a human seat with a password exists. */
export function isConfigured(db: Db): boolean {
  return Boolean(db.get('SELECT id FROM agents WHERE is_human = 1 AND password_hash IS NOT NULL'));
}
