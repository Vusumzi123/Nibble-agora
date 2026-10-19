import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../config.ts';
import { start, type App } from './index.ts';

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const json = (r: Response) => r.json() as Promise<Record<string, any>>;

async function boot(): Promise<{ app: App; base: string; auth: Record<string, string> }> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-events-'));
  dirs.push(dir);
  const configPath = path.join(dir, 'config.yaml');
  writeFileSync(
    configPath,
    [
      'bind: 127.0.0.1',
      'port: 0',
      'data_dir: data',
      'db_file: agora.db',
      'default_board: agora',
      '',
    ].join('\n'),
  );
  const cfg = loadConfig({ configPath, cwd: dir, env: { AGORA_PORT: '0' } });
  const app = await start(cfg);
  const reg = await json(
    await fetch(`${app.url}/api/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'events-tester' }),
    }),
  );
  const auth = {
    'content-type': 'application/json',
    authorization: `Bearer ${reg.token}`,
  };
  return { app, base: app.url, auth };
}

test('events journal and live stream carry card mutations', async () => {
  const { app, base, auth } = await boot();
  try {
    const head = await json(await fetch(`${base}/api/events`, { headers: { authorization: auth.authorization } }));
    assert.ok(head.last_id > 0, 'setup/registration already journaled');

    const boards = await json(await fetch(`${base}/api/boards`, { headers: { authorization: auth.authorization } }));
    const board = boards.boards[0];
    assert.ok(board, 'default board exists');

    const ac = new AbortController();
    const stream = await fetch(`${base}/api/events/stream?since=${head.last_id}`, {
      headers: { authorization: auth.authorization },
      signal: ac.signal,
    });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let feed = '';

    // Mutate after the stream is open — the tail must pick it up.
    const created = await fetch(`${base}/api/cards`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        board_id: board.id,
        column_id: board.columns[0].id,
        title: 'streamed card',
        body: 'hello',
      }),
    });
    assert.equal(created.status, 201);

    const deadline = Date.now() + 6000;
    // Keep one read in flight across timeout ticks — racing a fresh read each
    // time would leave the loser pending and swallow the next chunk.
    let pending: ReturnType<typeof reader.read> | null = null;
    while (Date.now() < deadline && !feed.includes('card.create')) {
      pending ??= reader.read();
      const chunk = await Promise.race([
        pending,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
      ]);
      if (chunk === null) continue;
      pending = null;
      if (chunk.done) break;
      feed += decoder.decode(chunk.value, { stream: true });
    }
    ac.abort();
    await reader.cancel().catch(() => {});

    assert.match(feed, /event: change/, 'stream carries named events');
    assert.match(feed, /"action":"card.create"/, 'the mutation lands in the feed');
    assert.match(feed, /"title":"streamed card"/, 'the event payload is passed through');

    // The plain route is the reconnect fallback: same rows, ascending.
    const after = await json(
      await fetch(`${base}/api/events?since=${head.last_id}`, {
        headers: { authorization: auth.authorization },
      }),
    );
    assert.equal(after.events.at(-1).action, 'card.create');
    assert.ok(after.last_id >= after.events.at(-1).id);

    // The stream is a seat-only read.
    const anon = await fetch(`${base}/api/events/stream`);
    assert.equal(anon.status, 401);
    await anon.body?.cancel();

    const bad = await fetch(`${base}/api/events?since=-4`, {
      headers: { authorization: auth.authorization },
    });
    assert.equal(bad.status, 400);
  } finally {
    app.server.close();
    app.db.close();
  }
});
