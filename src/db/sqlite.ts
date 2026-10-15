import { DatabaseSync, type StatementSync } from 'node:sqlite';

type Row = Record<string, unknown>;

/** Thin wrapper over node:sqlite — the only place that talks to the DB. */
export class Db {
  readonly raw: DatabaseSync;
  private readonly stmts = new Map<string, StatementSync>();

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
  }

  /** Prepared-statement cache — statements are tiny and reused constantly. */
  prep(sql: string): StatementSync {
    let st = this.stmts.get(sql);
    if (!st) {
      st = this.raw.prepare(sql);
      this.stmts.set(sql, st);
    }
    return st;
  }

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.prep(sql).all(...(params as never[])) as T[];
  }

  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    return this.prep(sql).get(...(params as never[])) as T | undefined;
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const r = this.prep(sql).run(...(params as never[]));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Run `fn` in a transaction; rolls back on any throw. */
  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        /* rollback of a failed statement is best-effort */
      }
      throw err;
    }
  }

  close(): void {
    this.stmts.clear();
    this.raw.close();
  }
}
