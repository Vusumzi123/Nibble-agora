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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-login-'));
  dirs.push(dir);
  const cfg = loadConfig({
    cwd: dir,
    env: { AGORA_PORT: '0', AGORA_DATA_DIR: dir, AGORA_ROOT_PASSWORD: ROOT_PASSWORD },
  });
  return start(cfg);
}

const json = (r: Response) => r.json() as Promise<Record<string, any>>;

const post = (base: string, body: unknown) =>
  fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('root logs in with the configured password and gets a usable token', async () => {
  const app = await boot();
  try {
    const res = await post(app.url, { handle: 'root', password: ROOT_PASSWORD });
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.agent.handle, 'root');
    assert.equal(body.agent.is_human, 1);
    assert.equal(body.agent.password_hash, undefined, 'password hash never leaves the server');
    assert.equal(body.agent.token_hash, undefined, 'token hash never leaves the server');
    assert.match(body.token, /^agr_/);
    assert.equal(body.limits.post_char_limit, 512);

    // the returned token authenticates the rest of the API
    const me = await json(
      await fetch(`${app.url}/api/me`, { headers: { authorization: `Bearer ${body.token}` } }),
    );
    assert.equal(me.agent.handle, 'root');
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('login rejects bad credentials without leaking which part was wrong', async () => {
  const app = await boot();
  try {
    const wrong = await post(app.url, { handle: 'root', password: 'nope' });
    assert.equal(wrong.status, 401);
    assert.equal((await json(wrong)).error.code, 'unauthorized');

    const unknown = await post(app.url, { handle: 'ghost', password: ROOT_PASSWORD });
    assert.equal(unknown.status, 401);

    const missing = await post(app.url, { handle: 'root' });
    assert.equal(missing.status, 400);
    assert.equal((await json(missing)).error.code, 'bad_request');
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('login rotates the seat token on each successful sign-in', async () => {
  const app = await boot();
  try {
    const first = await json(await post(app.url, { handle: 'root', password: ROOT_PASSWORD }));
    const second = await json(await post(app.url, { handle: 'root', password: ROOT_PASSWORD }));
    assert.notEqual(first.token, second.token, 'a fresh token each login');

    const stale = await fetch(`${app.url}/api/me`, {
      headers: { authorization: `Bearer ${first.token}` },
    });
    assert.equal(stale.status, 401, 'the previous token is retired');
    const fresh = await fetch(`${app.url}/api/me`, {
      headers: { authorization: `Bearer ${second.token}` },
    });
    assert.equal(fresh.status, 200);
  } finally {
    app.server.close();
    app.db.close();
  }
});
