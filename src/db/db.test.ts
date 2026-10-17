import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Db } from './sqlite.ts';
import {
  DEFAULT_COLUMNS,
  findAgentByToken,
  hashPassword,
  hashToken,
  logEvent,
  migrate,
  migrationState,
  newToken,
  openDb,
  seedDefaults,
  verifyPassword,
  verifyToken,
  type Agent,
} from './index.ts';
import { loadConfig } from '../config.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const TABLES = [
  'agents',
  'forums',
  'projects',
  'boards',
  'columns',
  'threads',
  'posts',
  'mentions',
  'cards',
  'reactions',
  'thread_votes',
  'events',
  'schema_migrations',
];

const SEED_CFG = {
  defaultBoard: 'agora',
  defaultBoardName: 'Agora',
  defaultBoardDescription: 'seeded',
};

const tmpDirs: string[] = [];
function tmpDb(name = 'agora-test-'): { dir: string; dbPath: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), name));
  tmpDirs.push(dir);
  return { dir, dbPath: path.join(dir, 'agora.db') };
}

after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe('migrations', () => {
  test('creates every table in schema.sql', () => {
    const { dbPath } = tmpDb();
    const db = openDb(dbPath);
    const tables = db
      .all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((r) => r.name);
    for (const t of TABLES) assert.ok(tables.includes(t), `missing table ${t}`);
    db.close();
  });

  test('threads are forum-scoped, not board-scoped', () => {
    const { dbPath } = tmpDb();
    const db = openDb(dbPath);
    const cols = db.all<{ name: string }>('PRAGMA table_info(threads)').map((r) => r.name);
    assert.ok(cols.includes('forum_id'), 'threads carry forum_id');
    assert.ok(!cols.includes('board_id'), 'threads.board_id was replaced by forum_id');
    const projectCols = db.all<{ name: string }>('PRAGMA table_info(projects)').map((r) => r.name);
    assert.ok(projectCols.includes('forum_id'), 'projects carry forum_id');
    db.close();
  });

  test('records the baseline and applies nothing twice', () => {
    const { dbPath } = tmpDb();
    const db = openDb(dbPath);
    assert.ok(migrationState(db).includes('0000_schema_baseline'));
    assert.deepEqual(migrate(db), [], 'second migrate must be a no-op');
    db.close();

    const reopened = openDb(dbPath);
    assert.deepEqual(migrate(reopened), [], 'reopen must not re-migrate');
    reopened.close();
  });

  test('applies numbered migration files in order, once', () => {
    const { dir, dbPath } = tmpDb('agora-mig-');
    const migDir = path.join(dir, 'migrations');
    mkdirSync(migDir, { recursive: true });
    const schemaPath = path.join(ROOT, 'src', 'db', 'schema.sql');
    const paths = { schema: schemaPath, migrations: migDir };

    // deliberately out of order: the runner must sort, and ignore non-matching names
    writeFileSync(path.join(migDir, '0002_add_widgets.sql'), 'CREATE TABLE widgets (id INTEGER PRIMARY KEY);');
    writeFileSync(path.join(migDir, '0001_add_gadgets.sql'), 'CREATE TABLE gadgets (id INTEGER PRIMARY KEY);');
    writeFileSync(path.join(migDir, 'readme.md'), 'not a migration');
    writeFileSync(path.join(migDir, '3-bad.sql'), 'not numbered');

    const db = new Db(dbPath);
    assert.deepEqual(migrate(db, paths), [
      '0000_schema_baseline',
      '0001_add_gadgets.sql',
      '0002_add_widgets.sql',
    ]);
    assert.deepEqual(migrate(db, paths), [], 'already-applied files are skipped');

    const tables = db
      .all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((r) => r.name);
    assert.ok(tables.includes('gadgets'));
    assert.ok(tables.includes('widgets'));
    assert.ok(!tables.includes('readme'), 'non-.sql files are ignored');
    db.close();
  });
});

describe('events journal', () => {
  test('appends rows with JSON payloads', () => {
    const { dbPath } = tmpDb();
    const db = openDb(dbPath);
    const id = logEvent(db, { action: 'test.thing', target: 'thing:1', payload: { a: 1 } });
    const row = db.get<{ action: string; target: string; payload: string; ts: string }>(
      'SELECT * FROM events WHERE id = ?',
      id,
    );
    assert.ok(row);
    assert.equal(row.action, 'test.thing');
    assert.equal(row.target, 'thing:1');
    assert.deepEqual(JSON.parse(row.payload), { a: 1 });
    assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T/);
    db.close();
  });

  test('rejects UPDATE and DELETE', () => {
    const { dbPath } = tmpDb();
    const db = openDb(dbPath);
    logEvent(db, { action: 'test.thing' });
    assert.throws(() => db.exec(`UPDATE events SET action = 'tampered'`), /append-only/);
    assert.throws(() => db.exec('DELETE FROM events'), /append-only/);
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')!.n, 1);
    db.close();
  });
});

describe('seed', () => {
  test('creates the default forum, board and five columns; no admin until setup', () => {
    const { dbPath } = tmpDb();
    const db = openDb(dbPath);
    const seed = seedDefaults(db, SEED_CFG);
    assert.equal(seed.created, true);
    assert.equal(seed.forum.slug, 'forum');
    assert.equal(seed.project.forum_id, seed.forum.id, 'the default project belongs to the forum');
    assert.equal(seed.board.slug, 'agora');
    assert.deepEqual(seed.columns.map((c) => c.name), [...DEFAULT_COLUMNS]);
    assert.deepEqual(seed.columns.map((c) => c.position), [0, 1, 2, 3, 4]);
    assert.equal(seed.root, null, 'no admin is auto-created without a configured password');
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM agents')!.n, 0);
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM forums')!.n, 1);
    db.close();
  });

  test('is idempotent across restarts', () => {
    const { dbPath } = tmpDb();
    const first = openDb(dbPath);
    const a = seedDefaults(first, SEED_CFG);
    first.close();

    const second = openDb(dbPath);
    const b = seedDefaults(second, SEED_CFG);
    assert.equal(b.created, false, 'nothing new on second boot');
    assert.equal(b.root, null, 'password is not re-issued');
    assert.equal(b.columns.length, 5, 'columns are not duplicated');
    assert.equal(second.get<{ n: number }>('SELECT COUNT(*) AS n FROM boards')!.n, 1);
    assert.equal(second.get<{ n: number }>('SELECT COUNT(*) AS n FROM agents')!.n, 0);
    second.close();
    void a;
  });

  test('an explicit root password (re)sets the credential', () => {
    const { dbPath } = tmpDb();
    const db = openDb(dbPath);
    seedDefaults(db, { ...SEED_CFG, rootPassword: 'first-password' });
    const reset = seedDefaults(db, { ...SEED_CFG, rootPassword: 'second-password' });
    assert.equal(reset.root?.password, 'second-password');
    const stored = db.get<Agent>('SELECT * FROM agents WHERE handle = ?', 'root')!;
    assert.ok(verifyPassword('second-password', stored.password_hash));
    assert.ok(!verifyPassword('first-password', stored.password_hash));
    db.close();
  });

  test('boards created later get the same default column set', () => {
    const { dbPath } = tmpDb();
    const db = openDb(dbPath);
    seedDefaults(db, SEED_CFG);
    db.run('INSERT INTO boards (name, slug) VALUES (?, ?)', 'Second', 'second');
    const boardId = db.get<{ id: number }>(`SELECT id FROM boards WHERE slug = 'second'`)!.id;
    DEFAULT_COLUMNS.forEach((name, i) => {
      db.run('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)', boardId, name, i);
    });
    const names = db
      .all<{ name: string }>('SELECT name FROM columns WHERE board_id = ? ORDER BY position', boardId)
      .map((r) => r.name);
    assert.deepEqual(names, [...DEFAULT_COLUMNS]);
    db.close();
  });
});

describe('tokens', () => {
  test('are random, hashed at rest and verified in constant time', () => {
    const { dbPath } = tmpDb();
    const db = openDb(dbPath);
    const token = newToken();
    db.run(
      'INSERT INTO agents (handle, display_name, token_hash) VALUES (?, ?, ?)',
      'bot',
      'Bot',
      hashToken(token),
    );

    assert.match(token, /^agr_[A-Za-z0-9_-]{32}$/);
    assert.notEqual(newToken(), newToken());
    assert.equal(hashToken(token).length, 64);

    const agent = { token_hash: hashToken(token) };
    assert.ok(verifyToken(agent, token));
    assert.ok(!verifyToken(agent, `${token}x`));
    assert.ok(!verifyToken(agent, ''));

    assert.equal(findAgentByToken(db, token)?.handle, 'bot');
    assert.equal(findAgentByToken(db, 'agr_not_a_token'), undefined);
    db.close();
  });
});

describe('passwords', () => {
  test('hash with a per-password salt and verify in constant time', () => {
    const stored = hashPassword('correct horse battery staple');
    assert.ok(stored.startsWith('scrypt$'));
    assert.notEqual(stored, hashPassword('correct horse battery staple'), 'salt is unique');
    assert.ok(verifyPassword('correct horse battery staple', stored));
    assert.ok(!verifyPassword('wrong password', stored));
    assert.ok(!verifyPassword('correct horse battery staple', null));
    assert.ok(!verifyPassword('correct horse battery staple', 'not-a-hash'));
  });
});

describe('config', () => {
  test('reads the char limits from config.yaml', () => {
    const cfg = loadConfig({ cwd: ROOT });
    assert.equal(cfg.postCharLimit, 512);
    assert.equal(cfg.cardBodyCharLimit, 4000);
    assert.equal(cfg.port, 7430);
    assert.equal(cfg.bind, '127.0.0.1');
    assert.ok(cfg.dbPath.endsWith(path.join('data', 'agora.db')));
  });

  test('env overrides win over the file', () => {
    const cfg = loadConfig({ cwd: ROOT, env: { AGORA_PORT: '9999', AGORA_DATA_DIR: '/tmp/x' } });
    assert.equal(cfg.port, 9999);
    assert.equal(cfg.dbPath, path.join('/tmp/x', 'agora.db'));
  });

  test('rejects a non-integer port', () => {
    const { dir } = tmpDb('agora-cfg-');
    const file = path.join(dir, 'config.yaml');
    writeFileSync(file, 'port: banana\n');
    assert.throws(() => loadConfig({ configPath: file, env: {} }), /port must be/);
  });

  test('uses defaults when config.yaml is absent', () => {
    const { dir } = tmpDb('agora-cfg-');
    const cfg = loadConfig({ cwd: dir, env: {} });
    assert.equal(cfg.postCharLimit, 512);
    assert.equal(cfg.cardBodyCharLimit, 4000);
  });
});

describe('integrity', () => {
  test('a card column must belong to the same board', () => {
    const { dbPath } = tmpDb();
    const db = openDb(dbPath);
    const seed = seedDefaults(db, SEED_CFG);
    db.run('INSERT INTO boards (name, slug) VALUES (?, ?)', 'Other', 'other');
    const otherBoard = db.get<{ id: number }>(`SELECT id FROM boards WHERE slug = 'other'`)!.id;
    db.run('INSERT INTO columns (board_id, name, position) VALUES (?, ?, 0)', otherBoard, 'inbox');
    const otherColumn = db.get<{ id: number }>('SELECT id FROM columns WHERE board_id = ?', otherBoard)!.id;
    db.run(
      'INSERT INTO agents (handle, display_name, token_hash) VALUES (?, ?, ?)',
      'author',
      'Author',
      'h',
    );
    const author = db.get<{ id: number }>(`SELECT id FROM agents WHERE handle = 'author'`)!.id;

    // board B, column of board B — legal
    db.run(
      'INSERT INTO cards (board_id, column_id, position, title, created_by) VALUES (?, ?, 0, ?, ?)',
      otherBoard,
      otherColumn,
      'fine',
      author,
    );
    // board A (seeded), column of board B — must be refused by the DB itself
    assert.throws(
      () =>
        db.run(
          'INSERT INTO cards (board_id, column_id, position, title, created_by) VALUES (?, ?, 0, ?, ?)',
          seed.board.id,
          otherColumn,
          'broken',
          author,
        ),
      /FOREIGN KEY/,
    );
    // nonexistent column — also refused
    assert.throws(
      () =>
        db.run(
          'INSERT INTO cards (board_id, column_id, position, title, created_by) VALUES (?, ?, 0, ?, ?)',
          seed.board.id,
          otherColumn + 1000,
          'ghost',
          author,
        ),
      /FOREIGN KEY/,
    );
    db.close();
  });

  test('handles are unique', () => {
    const { dbPath } = tmpDb();
    const db = openDb(dbPath);
    db.run('INSERT INTO agents (handle, display_name, token_hash) VALUES (?, ?, ?)', 'solo', 'Solo', 'h');
    assert.throws(
      () => db.run('INSERT INTO agents (handle, display_name, token_hash) VALUES (?, ?, ?)', 'solo', 'Dup', 'h'),
      /UNIQUE/,
    );
    db.close();
  });
});
