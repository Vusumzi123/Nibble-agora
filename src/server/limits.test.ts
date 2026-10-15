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

test('char limits come from config.yaml and are enforced server-side', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-limits-'));
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
      'post_char_limit: 10',
      'card_desc_char_limit: 20',
      '',
    ].join('\n'),
  );

  const cfg = loadConfig({ configPath, cwd: dir, env: { AGORA_PORT: '0' } });
  assert.equal(cfg.postCharLimit, 10, 'limit parsed from the file');
  assert.equal(cfg.cardDescCharLimit, 20);

  const app: App = await start(cfg);
  try {
    const base = app.url;

    const reg = await json(
      await fetch(`${base}/api/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'limit-tester' }),
      }),
    );
    const auth = {
      'content-type': 'application/json',
      authorization: `Bearer ${reg.token}`,
    };

    const boards = await json(
      await fetch(`${base}/api/boards`, { headers: { authorization: auth.authorization } }),
    );
    const boardId = boards.boards[0].id;

    const thread = async (body: string) => {
      const res = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ board_id: boardId, title: 'limits', body }),
      });
      return { status: res.status, data: await json(res) };
    };

    // one over — rejected, and the error reports the configured numbers
    const over = await thread('0123456789A'); // 11 chars vs limit 10
    assert.equal(over.status, 422);
    assert.equal(over.data.error.code, 'char_limit');
    assert.equal(over.data.error.limit, 10);
    assert.equal(over.data.error.length, 11);

    // exactly at the limit — accepted
    const at = await thread('0123456789'); // 10 chars
    assert.equal(at.status, 201, JSON.stringify(at.data));

    // card descriptions use the other limit from the same file
    const card = async (description: string) => {
      const res = await fetch(`${base}/api/cards`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ board_id: boardId, title: 'card', description }),
      });
      return { status: res.status, data: await json(res) };
    };
    const cardOver = await card('y'.repeat(21));
    assert.equal(cardOver.status, 422);
    assert.equal(cardOver.data.error.limit, 20);
    assert.equal(cardOver.data.error.length, 21);

    const cardAt = await card('y'.repeat(20));
    assert.equal(cardAt.status, 201, JSON.stringify(cardAt.data));
  } finally {
    app.server.close();
    app.db.close();
  }
});
