import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../config.ts';
import { start, type App } from './index.ts';

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function boot(): Promise<App> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-setup-'));
  dirs.push(dir);
  const cfg = loadConfig({ cwd: dir, env: { AGORA_PORT: '0', AGORA_DATA_DIR: dir } });
  return start(cfg);
}

const json = (r: Response) => r.json() as Promise<Record<string, any>>;

function call(
  base: string,
  method: string,
  pathName: string,
  body?: unknown,
  token?: string,
): Promise<Response> {
  return fetch(`${base}${pathName}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('a fresh instance is unconfigured and exposes safe defaults', async () => {
  const app = await boot();
  try {
    const cfg = await json(await call(app.url, 'GET', '/api/config'));
    assert.equal(cfg.configured, false);
    assert.equal(cfg.theme, 'dark');
    assert.ok(cfg.forum_name);
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('setup creates the admin, configures the instance and is one-shot', async () => {
  const app = await boot();
  try {
    const res = await call(app.url, 'POST', '/api/setup', {
      handle: 'admin',
      password: 'longenough1',
      forum_name: 'Calm Hall',
      theme: 'calm',
    });
    assert.equal(res.status, 201);
    const body = await json(res);
    assert.equal(body.agent.handle, 'admin');
    assert.equal(body.agent.is_human, 1);
    assert.equal(body.agent.password_hash, undefined, 'password hash never leaves the server');
    assert.match(body.token, /^agr_/);
    assert.deepEqual(body.config, { configured: true, forum_name: 'Calm Hall', theme: 'calm' });

    const cfg = await json(await call(app.url, 'GET', '/api/config'));
    assert.equal(cfg.configured, true);
    assert.equal(cfg.theme, 'calm');
    assert.equal(cfg.forum_name, 'Calm Hall');

    const again = await call(app.url, 'POST', '/api/setup', {
      handle: 'other',
      password: 'longenough1',
    });
    assert.equal(again.status, 409, 'setup is disabled once configured');

    const login = await call(app.url, 'POST', '/api/login', {
      handle: 'admin',
      password: 'longenough1',
    });
    assert.equal(login.status, 200);
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('settings + password changes require auth, validate, and take effect', async () => {
  const app = await boot();
  try {
    const setup = await json(
      await call(app.url, 'POST', '/api/setup', { handle: 'admin', password: 'longenough1' }),
    );
    const token = setup.token as string;

    assert.equal((await call(app.url, 'PATCH', '/api/settings', { theme: 'light' })).status, 401);
    assert.equal(
      (await call(app.url, 'PATCH', '/api/settings', { theme: 'neon' }, token)).status,
      400,
    );

    const ok = await json(
      await call(app.url, 'PATCH', '/api/settings', { theme: 'light', forum_name: 'Stoa' }, token),
    );
    assert.equal(ok.theme, 'light');
    assert.equal(ok.forum_name, 'Stoa');

    assert.equal(
      (
        await call(
          app.url,
          'POST',
          '/api/settings/password',
          { current_password: 'nope', new_password: 'brandnewpw1' },
          token,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await call(
          app.url,
          'POST',
          '/api/settings/password',
          { current_password: 'longenough1', new_password: 'brandnewpw1' },
          token,
        )
      ).status,
      200,
    );

    assert.equal(
      (await call(app.url, 'POST', '/api/login', { handle: 'admin', password: 'longenough1' })).status,
      401,
    );
    assert.equal(
      (await call(app.url, 'POST', '/api/login', { handle: 'admin', password: 'brandnewpw1' })).status,
      200,
    );
  } finally {
    app.server.close();
    app.db.close();
  }
});
