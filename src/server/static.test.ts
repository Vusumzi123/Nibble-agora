import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config.ts';
import { start, type App } from './index.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_INDEX = path.resolve(HERE, '..', '..', 'web', 'dist', 'agora', 'browser', 'index.html');
const webBuilt = existsSync(WEB_INDEX);
const skipUnlessBuilt = webBuilt ? false : 'web build missing — run `npm run build:web`';

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function bootWeb(): Promise<App> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-web-'));
  dirs.push(dir);
  const cfg = loadConfig({
    cwd: dir,
    env: { AGORA_PORT: '0', AGORA_DATA_DIR: dir },
  });
  return start(cfg);
}

const json = (r: Response) => r.json() as Promise<Record<string, any>>;

test('the built Angular seat is served alongside the API', { skip: skipUnlessBuilt }, async () => {
  const app = await bootWeb();
  try {
    const base = app.url;

    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type') ?? '', /text\/html/);
    const html = await index.text();
    assert.match(html, /<app-root>/);
    assert.match(html, /Agora/);

    const mainJs = /main-[A-Za-z0-9]+\.js/.exec(html)?.[0];
    assert.ok(mainJs, 'index references a hashed main bundle');
    const bundle = await fetch(`${base}/${mainJs}`);
    assert.equal(bundle.status, 200);
    assert.match(bundle.headers.get('content-type') ?? '', /javascript/);

    const indexAlias = await fetch(`${base}/index.html`);
    assert.equal(indexAlias.status, 200);
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('client-side routes fall back to the seat shell', { skip: skipUnlessBuilt }, async () => {
  const app = await bootWeb();
  try {
    const base = app.url;
    for (const route of ['/threads', '/threads/12', '/board', '/inbox']) {
      const res = await fetch(`${base}${route}`);
      assert.equal(res.status, 200, `${route} should fall back to index.html`);
      assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    }
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('static serving never shadows the API and rejects traversal', { skip: skipUnlessBuilt }, async () => {
  const app = await bootWeb();
  try {
    const base = app.url;

    const missing = await fetch(`${base}/nope.html`);
    assert.equal(missing.status, 404);
    assert.equal((await json(missing)).error.code, 'not_found');

    const apiMissing = await fetch(`${base}/api/nope`);
    assert.equal(apiMissing.status, 404);

    const post = await fetch(`${base}/`, { method: 'POST' });
    assert.equal(post.status, 404, 'static files are GET-only');

    const traversal = await fetch(`${base}/../package.json`);
    assert.equal(traversal.status, 404);

    const encoded = await fetch(`${base}/%2e%2e/%2e%2e/package.json`);
    assert.equal(encoded.status, 404);
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('GET /api/me exposes char limits; GET /api/agents lists seats without token hashes', async () => {
  const app = await bootWeb();
  try {
    const base = app.url;

    const reg = await json(
      await fetch(`${base}/api/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'ui-tester' }),
      }),
    );
    const headers = { authorization: `Bearer ${reg.token}` };

    const me = await json(await fetch(`${base}/api/me`, { headers }));
    assert.equal(me.agent.handle, 'ui-tester');
    assert.equal(me.limits.post_char_limit, 512);
    assert.equal(me.limits.card_desc_char_limit, 4000);
    assert.equal(me.agent.token_hash, undefined);
    assert.equal(me.agent.password_hash, undefined);

    const agents = await json(await fetch(`${base}/api/agents`, { headers }));
    const handles = agents.agents.map((a: { handle: string }) => a.handle).sort();
    assert.deepEqual(handles, ['ui-tester']);
    for (const a of agents.agents) {
      assert.equal(a.token_hash, undefined, 'token hashes never leave the server');
      assert.equal(a.password_hash, undefined, 'password hashes never leave the server');
    }
  } finally {
    app.server.close();
    app.db.close();
  }
});
