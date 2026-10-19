import { createServer, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig, type Config } from '../config.ts';
import {
  eventHead,
  isConfigured,
  listEventsSince,
  openDb,
  seedDefaults,
  type Db,
} from '../db/index.ts';
import { authenticate } from './auth.ts';
import { readJsonBody, send, sendError } from './http.ts';
import { ROUTES } from './routes.ts';
import { serveStatic } from './static.ts';

const HEALTHY = { ok: true, service: 'agora' };

export interface App {
  server: Server;
  db: Db;
  cfg: Config;
  url: string;
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function createApp(cfg: Config): App {
  const db = openDb(cfg.dbPath);
  const ctx = { db, cfg };
  const url = `http://${cfg.bind}:${cfg.port}`;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const started = Date.now();
    try {
      const target = new URL(req.url ?? '/', url);
      const pathname = target.pathname;
      const method = (req.method ?? 'GET').toUpperCase();

      if (pathname === '/healthz') {
        send(res, 200, { ...HEALTHY, db: cfg.dbPath });
        return;
      }

      // Live change feed: one long-lived SSE response per seat. Every
      // mutation already lands in the `events` journal, so the stream is a
      // tail of that table — no extra write path to keep in sync.
      if (method === 'GET' && pathname === '/api/events/stream') {
        streamEvents(req, res, db, target.searchParams);
        logLine(method, pathname, 200, started, undefined);
        return;
      }

      const route = ROUTES.find((r) => r.method === method && r.re.test(pathname));
      if (!route) {
        if (method === 'GET' && !pathname.startsWith('/api') && serveStatic(res, pathname)) {
          logLine(method, pathname, 200, started, undefined);
          return;
        }
        send(res, 404, { error: { code: 'not_found', message: `no route for ${method} ${pathname}` } });
        return;
      }

      const match = route.re.exec(pathname)!;
      const agent = route.auth ? authenticate(db, req) : undefined;
      const body = MUTATING.has(method)
        ? ((await readJsonBody(req, cfg.maxBodyBytes)) as Record<string, unknown>)
        : {};
      const actor = agent ?? {
        id: 0,
        handle: 'anonymous',
        display_name: 'anonymous',
        token_hash: '',
        password_hash: null,
        is_human: 0,
        color: null,
        created_at: '',
      };

      const result = route.h(ctx, match, body, actor, target.searchParams);
      send(res, result.status, result.body);
      logLine(method, pathname, result.status, started, agent?.handle);
    } catch (err) {
      sendError(res, err);
      const status = (err as { status?: number }).status ?? 500;
      logLine(req.method ?? '?', req.url ?? '?', status, started, undefined);
    }
  });

  return { server, db, cfg, url };
}

/** SSE tail of the append-only events journal. `?since=<id>` resumes after a
    reconnect; without it the stream starts at the head (history is not
    replayed — the client's first poll carries the current state anyway). */
function streamEvents(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
  query: URLSearchParams,
): void {
  try {
    authenticate(db, req);
  } catch (err) {
    sendError(res, err);
    return;
  }

  const sinceRaw = query.get('since');
  let cursor: number;
  if (sinceRaw === null) {
    cursor = eventHead(db);
  } else {
    const n = Number(sinceRaw);
    if (!Number.isInteger(n) || n < 0) {
      send(res, 400, {
        error: { code: 'bad_request', message: 'since must be a non-negative integer' },
      });
      return;
    }
    cursor = n;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');

  let closed = false;
  let pump: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (closed) return;
    closed = true;
    if (pump !== null) clearTimeout(pump);
    clearInterval(beat);
    res.end();
  };
  const beat = setInterval(() => {
    if (!closed) res.write(': tick\n\n');
  }, 15_000);
  // The response (not the request) owns the lifetime: a GET request stream is
  // already complete when the handler runs, so req 'close' would fire at once.
  res.on('close', stop);
  res.on('error', stop);

  const drain = () => {
    if (closed) return;
    try {
      const rows = listEventsSince(db, cursor);
      for (const row of rows) {
        cursor = row.id;
        const frame = {
          id: row.id,
          ts: row.ts,
          actor_id: row.actor_id,
          action: row.action,
          target: row.target,
          payload: row.payload_json,
        };
        res.write(`id: ${row.id}\nevent: change\ndata: ${JSON.stringify(frame)}\n\n`);
      }
    } catch {
      /* a transient read failure must not tear the stream down */
    }
    pump = setTimeout(drain, 400);
  };
  drain();
}

function logLine(
  method: string,
  path: string,
  status: number,
  started: number,
  handle: string | undefined,
): void {
  const who = handle ? ` as @${handle}` : '';
  process.stdout.write(`${method} ${path} -> ${status} (${Date.now() - started}ms)${who}\n`);
}

export function start(cfg: Config = loadConfig()): Promise<App> {
  const app = createApp(cfg);
  const seed = seedDefaults(app.db, {
    defaultBoard: cfg.defaultBoard,
    defaultBoardName: cfg.defaultBoardName,
    defaultBoardDescription: cfg.defaultBoardDescription,
    rootHandle: cfg.rootHandle,
    rootPassword: cfg.rootPassword,
  });

  return new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(cfg.port, cfg.bind, () => {
      const actual = app.server.address();
      const port = typeof actual === 'object' && actual ? actual.port : cfg.port;
      const appUrl = `http://${cfg.bind}:${port}`;
      Object.assign(app, { url: appUrl });

      process.stdout.write(`agora listening on ${appUrl}\n`);
      process.stdout.write(`database: ${cfg.dbPath}\n`);
      if (seed.root) {
        process.stdout.write(
          `seeded root login @${seed.root.handle} - password shown once, store it now: ${seed.root.password}\n`,
        );
      } else if (!isConfigured(app.db)) {
        process.stdout.write(`setup required - open ${appUrl} to create the first admin account\n`);
      } else {
        process.stdout.write(
          `board "${cfg.defaultBoard}" ready (${seed.columns.map((c) => c.name).join(' -> ')})\n`,
        );
      }

      const shutdown = (): void => {
        app.server.close(() => {
          app.db.close();
          process.exit(0);
        });
        setTimeout(() => process.exit(0), 2000).unref();
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      resolve(app);
    });
  });
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  start().catch((err) => {
    process.stderr.write(`agora failed to start: ${String(err)}\n`);
    process.exit(1);
  });
}
