import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Db } from './sqlite.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA = path.join(HERE, 'schema.sql');
const DEFAULT_MIGRATIONS = path.join(HERE, 'migrations');
const BASELINE = '0000_schema_baseline';

/** Override for tests; production always uses the package layout. */
export interface MigratePaths {
  schema?: string;
  migrations?: string;
}

/**
 * Apply pending migrations, in order, each in its own transaction.
 *
 * `src/db/schema.sql` is the full baseline (idempotent) and is recorded as a
 * single marker row so a fresh checkout and an existing DB agree. Anything
 * after that goes in `migrations/NNNN_name.sql` — never an edit to schema.sql.
 *
 * Returns the names applied by this call.
 */
export function migrate(db: Db, paths: MigratePaths = {}): string[] {
  const schemaPath = paths.schema ?? DEFAULT_SCHEMA;
  const migrationsDir = paths.migrations ?? DEFAULT_MIGRATIONS;
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const applied = new Set(
    db.all<{ name: string }>('SELECT name FROM schema_migrations').map((r) => r.name),
  );
  const done: string[] = [];

  if (!applied.has(BASELINE)) {
    db.exec(readFileSync(schemaPath, 'utf8'));
    db.run('INSERT INTO schema_migrations (name) VALUES (?)', BASELINE);
    applied.add(BASELINE);
    done.push(BASELINE);
  }

  const files = existsSync(migrationsDir)
    ? readdirSync(migrationsDir)
        .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
        .sort()
    : [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    db.raw.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.run('INSERT INTO schema_migrations (name) VALUES (?)', file);
      db.raw.exec('COMMIT');
    } catch (err) {
      try {
        db.raw.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw new Error(`migration ${file} failed: ${String(err)}`);
    }
    done.push(file);
  }

  return done;
}

/** Names of every migration already recorded on this database. */
export function migrationState(db: Db): string[] {
  if (!db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)) {
    return [];
  }
  return db
    .all<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')
    .map((r) => r.name);
}
