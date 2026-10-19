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

/** Boot a fresh instance + a registered seat with one card on the seeded board. */
async function withCard(
  fn: (ctx: {
    base: string;
    auth: Record<string, string>;
    cardId: number;
    boardId: number;
  }) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-cards-'));
  dirs.push(dir);
  const configPath = path.join(dir, 'config.yaml');
  writeFileSync(
    configPath,
    ['bind: 127.0.0.1', 'port: 0', 'data_dir: data', 'db_file: agora.db', 'default_board: agora', ''].join('\n'),
  );
  const cfg = loadConfig({ configPath, cwd: dir, env: { AGORA_PORT: '0' } });
  const app: App = await start(cfg);
  try {
    const reg = await json(
      await fetch(`${app.url}/api/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'cards-tester' }),
      }),
    );
    const auth = {
      'content-type': 'application/json',
      authorization: `Bearer ${reg.token}`,
    };
    const boards = await json(await fetch(`${app.url}/api/boards`, { headers: auth }));
    const boardId = boards.boards[0].id;
    const created = await json(
      await fetch(`${app.url}/api/cards`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ board_id: boardId, title: 'conversation card' }),
      }),
    );
    await fn({ base: app.url, auth, cardId: created.card.id, boardId });
  } finally {
    app.server.close();
    app.db.close();
  }
}

test('a card starts unblocked and PATCH toggles blocked_at', () =>
  withCard(async ({ base, auth, cardId, boardId }) => {
    const listed = await json(
      await fetch(`${base}/api/boards/${boardId}/cards`, { headers: auth }),
    );
    assert.equal(listed.cards[0].blocked_at, null);

    const block = await fetch(`${base}/api/cards/${cardId}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ blocked: true }),
    });
    assert.equal(block.status, 200);
    const blocked = await json(block);
    assert.ok(blocked.card.blocked_at, 'blocked_at is stamped');

    // re-blocking keeps the original timestamp
    const again = await json(
      await fetch(`${base}/api/cards/${cardId}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ blocked: true }),
      }),
    );
    assert.equal(again.card.blocked_at, blocked.card.blocked_at);

    const unblock = await json(
      await fetch(`${base}/api/cards/${cardId}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ blocked: false }),
      }),
    );
    assert.equal(unblock.card.blocked_at, null);
  }));

test('cards list in priority (position) order and PATCH reorders them', () =>
  withCard(async ({ base, auth, cardId, boardId }) => {
    const create = async (title: string) =>
      json(
        await fetch(`${base}/api/cards`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ board_id: boardId, title }),
        }),
      );
    const second = await create('second');
    const third = await create('third');

    const listed = async () =>
      json(await fetch(`${base}/api/boards/${boardId}/cards`, { headers: auth }));
    const order = async () =>
      (await listed()).cards.map((c: any) => c.title) as string[];

    assert.deepEqual(await order(), ['conversation card', 'second', 'third']);

    // client-style dense reorder: third, first, second
    const positions: Array<[number, number]> = [
      [second.card.id, 2],
      [third.card.id, 0],
      [cardId, 1],
    ];
    for (const [id, position] of positions) {
      const res = await fetch(`${base}/api/cards/${id}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ position }),
      });
      assert.equal(res.status, 200);
      assert.equal((await json(res)).card.position, position);
    }

    assert.deepEqual(await order(), ['third', 'conversation card', 'second']);
  }));

test('card comments can be posted and read back in order', () =>
  withCard(async ({ base, auth, cardId }) => {
    const empty = await json(
      await fetch(`${base}/api/cards/${cardId}/comments`, { headers: auth }),
    );
    assert.equal(empty.card_id, cardId);
    assert.deepEqual(empty.comments, []);

    const first = await fetch(`${base}/api/cards/${cardId}/comments`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ body: 'first thought' }),
    });
    assert.equal(first.status, 201);
    const one = await json(first);
    assert.equal(one.comment.body, 'first thought');
    assert.equal(one.comment.author_handle, 'cards-tester');
    assert.equal(one.comment.card_id, cardId);

    const second = await json(
      await fetch(`${base}/api/cards/${cardId}/comments`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ body: 'second thought' }),
      }),
    );

    const list = await json(
      await fetch(`${base}/api/cards/${cardId}/comments`, { headers: auth }),
    );
    assert.deepEqual(
      list.comments.map((c: any) => c.body),
      ['first thought', 'second thought'],
      'oldest first, newest last',
    );
    assert.equal(list.comments[1].id, second.comment.id);

    const blank = await fetch(`${base}/api/cards/${cardId}/comments`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ body: '   ' }),
    });
    assert.equal(blank.status, 400, 'an empty comment is refused');

    const long = await fetch(`${base}/api/cards/${cardId}/comments`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ body: 'x'.repeat(600) }),
    });
    assert.equal(long.status, 422, 'comments share the post character limit');
  }));

test('comments go away with their card', () =>
  withCard(async ({ base, auth, cardId }) => {
    await fetch(`${base}/api/cards/${cardId}/comments`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ body: 'temporary' }),
    });
    const del = await fetch(`${base}/api/cards/${cardId}`, { method: 'DELETE', headers: auth });
    assert.equal(del.status, 200);

    const gone = await fetch(`${base}/api/cards/${cardId}/comments`, { headers: auth });
    assert.equal(gone.status, 404);
  }));
