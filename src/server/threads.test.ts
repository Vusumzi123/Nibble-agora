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

test('thread list paginates with limit/offset and reports total', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-paging-'));
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
  const app: App = await start(cfg);
  try {
    const base = app.url;

    const reg = await json(
      await fetch(`${base}/api/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'paging-tester' }),
      }),
    );
    const auth = {
      'content-type': 'application/json',
      authorization: `Bearer ${reg.token}`,
    };

    const forums = await json(
      await fetch(`${base}/api/forums`, {
        headers: { authorization: auth.authorization },
      }),
    );
    const forumId = forums.forums[0].id;

    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          forum_id: forumId,
          category: i < 3 ? 'task' : 'discussion',
          title: `paging ${i}`,
          body: 'body',
        }),
      });
      assert.equal(res.status, 201, `thread ${i} created`);
    }

    const list = async (query: string) => {
      const res = await fetch(`${base}/api/forums/${forumId}/threads${query}`, {
        headers: auth,
      });
      return { status: res.status, data: await json(res) };
    };

    // no limit: every thread, as before, plus the total
    const all = await list('');
    assert.equal(all.status, 200);
    assert.equal(all.data.threads.length, 7);
    assert.equal(all.data.total, 7);

    const first = await list('?limit=3');
    assert.equal(first.data.threads.length, 3, 'limit caps the page');
    assert.equal(first.data.total, 7, 'total spans all matching threads');

    const second = await list('?limit=3&offset=3');
    assert.equal(second.data.threads.length, 3);
    const ids = new Set([...all.data.threads.map((t: any) => t.id)]);
    const pageIds = new Set([...first.data.threads, ...second.data.threads].map((t: any) => t.id));
    assert.equal(
      [...pageIds].every((id: number) => ids.has(id)),
      true,
      'pages are drawn from the full set',
    );
    assert.equal(
      first.data.threads[0].id !== second.data.threads[0].id,
      true,
      'pages do not overlap',
    );

    const last = await list('?limit=3&offset=6');
    assert.equal(last.data.threads.length, 1, 'partial tail page');
    assert.equal(last.data.total, 7);

    const offsetOnly = await list('?offset=5');
    assert.equal(
      offsetOnly.data.threads.length,
      2,
      'offset without limit skips then returns the rest',
    );
    assert.equal(offsetOnly.data.total, 7);

    const filtered = await list('?category=task&limit=2');
    assert.equal(filtered.data.threads.length, 2);
    assert.equal(filtered.data.total, 3, 'total honours the category filter');
    assert.equal(
      filtered.data.threads.every((t: any) => t.category === 'task'),
      true,
    );

    for (const query of ['?limit=0', '?limit=201', '?limit=abc', '?offset=-1', '?offset=x']) {
      const bad = await list(query);
      assert.equal(bad.status, 400, `${query} rejected with 400`);
      assert.equal(bad.data.error.code, 'bad_request');
    }
  } finally {
    app.server.close();
    app.db.close();
  }
});
