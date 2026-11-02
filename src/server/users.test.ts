import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../config.ts';
import { start, type App } from './index.ts';

const ROOT_PASSWORD = 'test-root-password';
const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function boot(): Promise<App> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-users-'));
  dirs.push(dir);
  const cfg = loadConfig({
    cwd: dir,
    env: { AGORA_PORT: '0', AGORA_DATA_DIR: dir, AGORA_ROOT_PASSWORD: ROOT_PASSWORD },
  });
  return start(cfg);
}

const json = (r: Response) => r.json() as Promise<Record<string, any>>;

async function register(base: string, handle: string, display_name?: string) {
  const res = await fetch(`${base}/api/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(display_name === undefined ? { handle } : { handle, display_name }),
  });
  assert.equal(res.status, 201, `register ${handle}`);
  return json(res);
}

async function loginRoot(base: string): Promise<string> {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle: 'root', password: ROOT_PASSWORD }),
  });
  assert.equal(res.status, 200);
  return (await json(res)).token as string;
}

const getAgents = (base: string, token: string, query = '') =>
  fetch(`${base}/api/agents${query}`, { headers: { authorization: `Bearer ${token}` } });

const handlesOf = (body: Record<string, any>) => body.agents.map((a: any) => a.handle);

test('GET /api/agents pages with limit/offset and reports the unfiltered total', async () => {
  const app = await boot();
  try {
    const token = await loginRoot(app.url);
    for (const handle of ['p-a', 'p-b', 'p-c', 'p-d', 'p-e']) await register(app.url, handle);

    const first = await json(await getAgents(app.url, token, '?limit=2&offset=0'));
    assert.deepEqual(handlesOf(first), ['p-a', 'p-b']);
    assert.equal(first.total, 6);

    const second = await json(await getAgents(app.url, token, '?limit=2&offset=2'));
    assert.deepEqual(handlesOf(second), ['p-c', 'p-d']);
    assert.equal(second.total, 6);

    const third = await json(await getAgents(app.url, token, '?limit=2&offset=4'));
    assert.deepEqual(handlesOf(third), ['p-e', 'root']);

    // no limit: full list, preserved for the pickers/autocomplete
    const all = await json(await getAgents(app.url, token));
    assert.deepEqual(handlesOf(all), ['p-a', 'p-b', 'p-c', 'p-d', 'p-e', 'root']);
    assert.equal(all.total, 6);

    const bad = await getAgents(app.url, token, '?limit=0');
    assert.equal(bad.status, 400);
    assert.equal((await json(bad)).error.field, 'limit');
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('GET /api/agents searches handle and display name case-insensitively, with paging', async () => {
  const app = await boot();
  try {
    const token = await loginRoot(app.url);
    await register(app.url, 'silvia', 'Silvia Stone');
    await register(app.url, 'simon', 'Simon Says');
    await register(app.url, 'zoe', 'Zoe Zane');
    await register(app.url, 'team-a');
    await register(app.url, 'team-b');
    await register(app.url, 'team-c');
    await register(app.url, 'under_score');

    const byHandle = await json(await getAgents(app.url, token, '?q=SIMON'));
    assert.deepEqual(handlesOf(byHandle), ['simon']);
    assert.equal(byHandle.total, 1);

    const byDisplay = await json(await getAgents(app.url, token, '?q=stone'));
    assert.deepEqual(handlesOf(byDisplay), ['silvia']);

    const paged = await json(await getAgents(app.url, token, '?q=team&limit=2&offset=0'));
    assert.deepEqual(handlesOf(paged), ['team-a', 'team-b']);
    assert.equal(paged.total, 3);

    const pageTwo = await json(await getAgents(app.url, token, '?q=team&limit=2&offset=2'));
    assert.deepEqual(handlesOf(pageTwo), ['team-c']);
    assert.equal(pageTwo.total, 3);

    // LIKE metacharacters are escaped, not treated as wildcards
    const underscore = await json(await getAgents(app.url, token, '?q=_'));
    assert.deepEqual(handlesOf(underscore), ['under_score']);
    const percent = await json(await getAgents(app.url, token, '?q=%25'));
    assert.deepEqual(handlesOf(percent), []);
    assert.equal(percent.total, 0);
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('disabled seats are hidden by default, visible with include_disabled, and carry disabled_at', async () => {
  const app = await boot();
  try {
    const token = await loginRoot(app.url);
    await register(app.url, 'active-one');
    await register(app.url, 'gone');
    const disabledAt = '2026-10-30T00:00:00.000Z';
    app.db.run('UPDATE agents SET disabled_at = ? WHERE handle = ?', disabledAt, 'gone');

    const active = await json(await getAgents(app.url, token));
    assert.deepEqual(handlesOf(active), ['active-one', 'root']);
    assert.equal(active.total, 2);
    for (const agent of active.agents) {
      assert.equal(agent.disabled_at, null);
      assert.equal(agent.token_hash, undefined, 'token hashes never leave the server');
      assert.equal(agent.password_hash, undefined, 'password hashes never leave the server');
    }

    const hiddenBySearch = await json(await getAgents(app.url, token, '?q=gone'));
    assert.deepEqual(handlesOf(hiddenBySearch), []);
    assert.equal(hiddenBySearch.total, 0);

    const including = await json(await getAgents(app.url, token, '?include_disabled=1'));
    assert.deepEqual(handlesOf(including), ['active-one', 'gone', 'root']);
    assert.equal(including.total, 3);
    const gone = including.agents.find((a: any) => a.handle === 'gone');
    assert.equal(gone.disabled_at, disabledAt);

    const searched = await json(await getAgents(app.url, token, '?q=gone&include_disabled=1'));
    assert.deepEqual(handlesOf(searched), ['gone']);
    assert.equal(searched.total, 1);
  } finally {
    app.server.close();
    app.db.close();
  }
});
