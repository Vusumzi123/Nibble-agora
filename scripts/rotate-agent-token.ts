/**
 * Rotate a non-human agent's bearer token in-place.
 *
 * There is no API route for this: `/api/login` only works for password seats,
 * and `POST /api/agents` rejects an existing handle. This maintenance script
 * keeps the same agent id, handle, assignments, and history.
 *
 *   npm run rotate:token -- --id 6 --handle nemu-cli --dry-run
 *   npm run rotate:token -- --id 6 --handle nemu-cli --execute
 *
 * The token is written once to a 0600 file (default `.tmp/nemu-cli.token`) and
 * never printed. `--execute` requires an explicit `--actor` seat (default root)
 * and writes an `agent.token_rotate` event to the append-only journal.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { loadConfig } from '../src/config.ts';
import { hashToken, logEvent, newToken } from '../src/db/index.ts';
import { Db } from '../src/db/sqlite.ts';

interface Args {
  id: number;
  handle: string;
  actor: string;
  tokenFile: string;
  url: string;
  dryRun: boolean;
  execute: boolean;
}

function usage(): never {
  console.error(
    'usage: npm run rotate:token -- --id <n> --handle <handle> (--dry-run | --execute) ' +
      '[--actor root] [--token-file .tmp/<handle>.token] [--url http://127.0.0.1:7430]',
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const id = Number(get('--id'));
  const handle = get('--handle');
  if (!Number.isInteger(id) || id <= 0 || !handle) usage();

  const dryRun = argv.includes('--dry-run');
  const execute = argv.includes('--execute');
  if (dryRun === execute) usage();

  const cfg = loadConfig();
  const actor = get('--actor') ?? cfg.rootHandle ?? 'root';
  const tokenFile = path.resolve(get('--token-file') ?? `.tmp/${handle}.token`);
  const url = get('--url') ?? `http://${cfg.bind}:${cfg.port}`;
  return { id, handle, actor, tokenFile, url, dryRun, execute };
}

interface Row {
  id: number;
  handle: string;
  display_name: string;
  is_human: number;
}

function inspect(dbPath: string, args: Args): Row {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const journal = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    const busy = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
    const rows = db
      .prepare('SELECT id, handle, display_name, is_human FROM agents WHERE id = ? AND handle = ?')
      .all(args.id, args.handle) as unknown as Row[];
    if (rows.length !== 1) {
      throw new Error(
        `expected exactly one row for id=${args.id} handle=${args.handle}, found ${rows.length}`,
      );
    }
    const row = rows[0];
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          db: dbPath,
          journal_mode: journal.journal_mode,
          busy_timeout: busy.timeout,
          agent: row,
          token_file: args.tokenFile,
          token_file_exists: existsSync(args.tokenFile),
        },
        null,
        2,
      ),
    );
    return row;
  } finally {
    db.close();
  }
}

async function verify(url: string, tokenFile: string, handle: string): Promise<void> {
  const token = readFileSync(tokenFile, 'utf8').trim();
  const res = await fetch(`${url}/api/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`verification failed: GET /api/me -> ${res.status}`);
  const body = (await res.json()) as { agent?: { handle?: string } };
  if (body.agent?.handle !== handle) {
    throw new Error(`verification failed: token identifies as @${body.agent?.handle ?? '?'}`);
  }
}

function rotate(dbPath: string, args: Args): string {
  if (existsSync(args.tokenFile)) {
    throw new Error(`refusing to overwrite existing token file: ${args.tokenFile}`);
  }
  mkdirSync(path.dirname(args.tokenFile), { recursive: true, mode: 0o700 });

  const db = new Db(dbPath);
  const actor = db.get<{ id: number; handle: string }>(
    'SELECT id, handle FROM agents WHERE handle = ?',
    args.actor,
  );
  if (!actor) throw new Error(`actor @${args.actor} not found`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.resolve('.tmp', `agora-pre-rotate-${stamp}.db`);
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);

  const token = newToken();
  let fileCreated = false;
  db.raw.exec('BEGIN IMMEDIATE');
  try {
    const update = db.run(
      'UPDATE agents SET token_hash = ? WHERE id = ? AND handle = ?',
      hashToken(token),
      args.id,
      args.handle,
    );
    if (update.changes !== 1) {
      throw new Error(
        `expected one row for id=${args.id} handle=${args.handle}, changed ${update.changes}`,
      );
    }
    logEvent(db, {
      actorId: actor.id,
      action: 'agent.token_rotate',
      target: `agent:${args.id}`,
      payload: { handle: args.handle, actor: actor.handle, backup },
    });

    const fd = openSync(args.tokenFile, 'wx', 0o600);
    fileCreated = true;
    try {
      writeSync(fd, token);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    db.raw.exec('COMMIT');
  } catch (err) {
    try {
      db.raw.exec('ROLLBACK');
    } catch {
      /* best-effort */
    }
    if (fileCreated) {
      try {
        unlinkSync(args.tokenFile);
      } catch {
        /* best-effort */
      }
    }
    throw err;
  } finally {
    db.close();
  }

  console.log(
    JSON.stringify(
      {
        rotated: true,
        agent_id: args.id,
        handle: args.handle,
        actor: actor.handle,
        backup,
        token_file: args.tokenFile,
      },
      null,
      2,
    ),
  );
  return token;
}

const args = parseArgs(process.argv.slice(2));
const cfg = loadConfig();

if (args.dryRun) {
  inspect(cfg.dbPath, args);
} else {
  rotate(cfg.dbPath, args);
  await verify(args.url, args.tokenFile, args.handle);
  console.log(`verified @${args.handle} via GET /api/me`);
}
