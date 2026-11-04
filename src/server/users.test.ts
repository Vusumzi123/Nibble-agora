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

test('POST /api/agents/:id/password resets the password and revokes the old token', async () => {
  const app = await boot();
  try {
    const rootToken = await loginRoot(app.url);
    const created = await fetch(`${app.url}/api/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'reset-me',
        display_name: 'Reset Me',
        is_human: true,
        password: 'old-password',
      }),
    });
    assert.equal(created.status, 201);
    const seat = await json(created);
    const oldToken = seat.token as string;

    const login = (password: string) =>
      fetch(`${app.url}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'reset-me', password }),
      });

    const reset = await fetch(`${app.url}/api/agents/${seat.id}/password`, {
      method: 'POST',
      headers: { authorization: `Bearer ${rootToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'new-password' }),
    });
    assert.equal(reset.status, 200);
    const body = await json(reset);
    assert.equal(body.id, seat.id);
    assert.equal(body.handle, 'reset-me');
    assert.equal(body.token_hash, undefined, 'token hash never leaves the server');
    assert.equal(body.password_hash, undefined, 'password hash never leaves the server');

    // the old bearer is dead
    const me = await fetch(`${app.url}/api/me`, {
      headers: { authorization: `Bearer ${oldToken}` },
    });
    assert.equal(me.status, 401);

    // old password rejected, new password accepted
    assert.equal((await login('old-password')).status, 401);
    const relogin = await login('new-password');
    assert.equal(relogin.status, 200);

    // journal carries the id only, never the plaintext
    const ev = app.db.get<any>(
      "SELECT * FROM events WHERE action = 'agent.password_reset' ORDER BY id DESC LIMIT 1",
    );
    assert.ok(ev, 'agent.password_reset journal event written');
    assert.equal(JSON.parse(ev.payload).agent_id, seat.id);
    assert.equal(JSON.stringify(ev).includes('new-password'), false);
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('POST /api/agents/:id/password rejects short passwords and unknown ids', async () => {
  const app = await boot();
  try {
    const rootToken = await loginRoot(app.url);
    const created = await fetch(`${app.url}/api/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'short-pass', is_human: true, password: 'old-password' }),
    });
    const seat = await json(created);

    const reset = (id: number, password: unknown) =>
      fetch(`${app.url}/api/agents/${id}/password`, {
        method: 'POST',
        headers: { authorization: `Bearer ${rootToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });

    const short = await reset(seat.id, '1234567');
    assert.equal(short.status, 400);
    assert.equal((await json(short)).error.field, 'password');

    const missing = await reset(seat.id, undefined);
    assert.equal(missing.status, 400);

    const unknown = await reset(999999, 'new-password');
    assert.equal(unknown.status, 404);
    assert.equal((await json(unknown)).error.field, 'agent_id');
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('PATCH /api/agents/:id renames a seat everywhere and keeps its token valid', async () => {
  const app = await boot();
  try {
    const rootToken = await loginRoot(app.url);
    const seatRes = await fetch(`${app.url}/api/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'rename-me',
        display_name: 'Rename Me',
        color: '#111111',
      }),
    });
    assert.equal(seatRes.status, 201);
    const seat = await json(seatRes);
    const seatToken = seat.token as string;

    const forums = await json(
      await fetch(`${app.url}/api/forums`, {
        headers: { authorization: `Bearer ${rootToken}` },
      }),
    );
    const forumId = forums.forums[0].id;

    // root mentions the seat; the seat also authors its own thread
    const mentioned = await fetch(`${app.url}/api/threads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${rootToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        forum_id: forumId,
        category: 'task',
        title: 'mentioned',
        body: 'hey',
        mentions: ['rename-me'],
      }),
    });
    assert.equal(mentioned.status, 201);
    const mentionedThread = (await json(mentioned)).thread.id as number;

    const authored = await fetch(`${app.url}/api/threads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${seatToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        forum_id: forumId,
        category: 'discussion',
        title: 'authored',
        body: 'hello',
      }),
    });
    assert.equal(authored.status, 201);
    const authoredThread = (await json(authored)).thread.id as number;

    const patch = await fetch(`${app.url}/api/agents/${seat.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${rootToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'renamed-seat',
        display_name: 'Renamed Seat',
        color: '#222222',
      }),
    });
    assert.equal(patch.status, 200);
    const updated = await json(patch);
    assert.equal(updated.handle, 'renamed-seat');
    assert.equal(updated.display_name, 'Renamed Seat');
    assert.equal(updated.color, '#222222');
    assert.equal(updated.token_hash, undefined, 'token hash never leaves the server');
    assert.equal(updated.password_hash, undefined, 'password hash never leaves the server');

    // the directory reflects the new handle
    const list = await json(await getAgents(app.url, rootToken, '?q=renamed'));
    assert.deepEqual(handlesOf(list), ['renamed-seat']);

    // mention pills and post authors re-derive the handle through a live JOIN
    const pillThread = await json(
      await fetch(`${app.url}/api/threads/${mentionedThread}`, {
        headers: { authorization: `Bearer ${rootToken}` },
      }),
    );
    assert.deepEqual(pillThread.posts[0].mentions, ['renamed-seat']);
    const authorThread = await json(
      await fetch(`${app.url}/api/threads/${authoredThread}`, {
        headers: { authorization: `Bearer ${rootToken}` },
      }),
    );
    assert.equal(authorThread.posts[0].author_handle, 'renamed-seat');

    // the old bearer still authenticates under the new identity
    const me = await json(
      await fetch(`${app.url}/api/me`, {
        headers: { authorization: `Bearer ${seatToken}` },
      }),
    );
    assert.equal(me.agent.handle, 'renamed-seat');

    // journal keeps before/after identity only — never credentials
    const ev = app.db.get<any>(
      "SELECT * FROM events WHERE action = 'agent.update' ORDER BY id DESC LIMIT 1",
    );
    assert.ok(ev, 'agent.update journal event written');
    const payload = JSON.parse(ev.payload);
    assert.equal(payload.before.handle, 'rename-me');
    assert.equal(payload.after.handle, 'renamed-seat');
    assert.equal(JSON.stringify(ev).includes('token_hash'), false);
    assert.equal(JSON.stringify(ev).includes('password_hash'), false);
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('PATCH /api/agents/:id rejects collisions, bad handles, empty bodies and unknown ids', async () => {
  const app = await boot();
  try {
    const rootToken = await loginRoot(app.url);
    const seat = await register(app.url, 'patch-bad');
    await register(app.url, 'patch-taken');

    const patch = (id: number, body: unknown) =>
      fetch(`${app.url}/api/agents/${id}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${rootToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const dupe = await patch(seat.id, { handle: 'patch-taken' });
    assert.equal(dupe.status, 409);
    const dupeBody = await json(dupe);
    assert.equal(dupeBody.error.field, 'handle');
    assert.equal(dupeBody.error.value, 'patch-taken');

    const bad = await patch(seat.id, { handle: 'Bad Handle!' });
    assert.equal(bad.status, 400);
    assert.equal((await json(bad)).error.field, 'handle');

    const empty = await patch(seat.id, {});
    assert.equal(empty.status, 400);
    assert.equal((await json(empty)).error.field, 'handle');

    const unknown = await patch(999999, { display_name: 'x' });
    assert.equal(unknown.status, 404);
    assert.equal((await json(unknown)).error.field, 'agent_id');

    // the seat was never mutated by the rejected calls
    const list = await json(await getAgents(app.url, rootToken, '?q=patch-'));
    assert.deepEqual(handlesOf(list), ['patch-bad', 'patch-taken']);
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('DELETE /api/agents/:id disables without destroying authored content', async () => {
  const app = await boot();
  try {
    const rootToken = await loginRoot(app.url);
    const seatRes = await fetch(`${app.url}/api/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'author-seat', display_name: 'Author Seat' }),
    });
    assert.equal(seatRes.status, 201);
    const seat = await json(seatRes);
    const seatToken = seat.token as string;

    const authored = await fetch(`${app.url}/api/threads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${seatToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        category: 'discussion',
        title: 'authored before disable',
        body: 'hello',
      }),
    });
    assert.equal(authored.status, 201);
    const threadId = (await json(authored)).thread.id as number;

    const disable = await fetch(`${app.url}/api/agents/${seat.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${rootToken}` },
    });
    assert.equal(disable.status, 200);
    const disabled = await json(disable);
    assert.equal(disabled.id, seat.id);
    assert.ok(disabled.disabled_at, 'disabled_at is stamped');
    assert.equal(disabled.token_hash, undefined, 'token hash never leaves the server');

    // the live session dies on its next request
    const me = await fetch(`${app.url}/api/me`, {
      headers: { authorization: `Bearer ${seatToken}` },
    });
    assert.equal(me.status, 401);

    // hidden from the default directory, visible with include_disabled
    const hidden = await json(await getAgents(app.url, rootToken, '?q=author-seat'));
    assert.deepEqual(handlesOf(hidden), []);
    const shown = await json(
      await getAgents(app.url, rootToken, '?q=author-seat&include_disabled=1'),
    );
    assert.equal(handlesOf(shown)[0], 'author-seat');
    assert.equal(shown.agents[0].disabled_at, disabled.disabled_at);

    // authored content survives: the thread still renders the author handle
    const thread = await json(
      await fetch(`${app.url}/api/threads/${threadId}`, {
        headers: { authorization: `Bearer ${rootToken}` },
      }),
    );
    assert.equal(thread.posts[0].author_handle, 'author-seat');

    // idempotent: a second disable is a 200 no-op and journals once
    const again = await fetch(`${app.url}/api/agents/${seat.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${rootToken}` },
    });
    assert.equal(again.status, 200);
    const events = app.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM events WHERE action = 'agent.disable'",
    );
    assert.equal(events?.n, 1);
    const ev = app.db.get<any>(
      "SELECT * FROM events WHERE action = 'agent.disable' ORDER BY id DESC LIMIT 1",
    );
    assert.equal(JSON.parse(ev.payload).agent_id, seat.id);
    assert.equal(JSON.stringify(ev).includes('token_hash'), false);
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('disabled human seats cannot log in; restore re-enables and unknown ids 404', async () => {
  const app = await boot();
  try {
    const rootToken = await loginRoot(app.url);
    const created = await fetch(`${app.url}/api/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'human-seat',
        display_name: 'Human Seat',
        is_human: true,
        password: 'correct-horse',
      }),
    });
    assert.equal(created.status, 201);
    const seat = await json(created);

    const login = () =>
      fetch(`${app.url}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'human-seat', password: 'correct-horse' }),
      });
    assert.equal((await login()).status, 200);

    const disable = await fetch(`${app.url}/api/agents/${seat.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${rootToken}` },
    });
    assert.equal(disable.status, 200);

    const rejected = await login();
    assert.equal(rejected.status, 403);
    assert.match((await json(rejected)).error.message, /disabled/i);

    // restore clears the marker and lets the human sign in with the same password
    const restore = await fetch(`${app.url}/api/agents/${seat.id}/restore`, {
      method: 'POST',
      headers: { authorization: `Bearer ${rootToken}` },
    });
    assert.equal(restore.status, 200);
    const restored = await json(restore);
    assert.equal(restored.disabled_at, null);
    assert.equal(restored.token_hash, undefined, 'token hash never leaves the server');
    assert.equal((await login()).status, 200);

    // restore is idempotent and journals once
    const restoreAgain = await fetch(`${app.url}/api/agents/${seat.id}/restore`, {
      method: 'POST',
      headers: { authorization: `Bearer ${rootToken}` },
    });
    assert.equal(restoreAgain.status, 200);
    const events = app.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM events WHERE action = 'agent.restore'",
    );
    assert.equal(events?.n, 1);

    for (const [method, url] of [
      ['DELETE', '/api/agents/999999'],
      ['POST', '/api/agents/999999/restore'],
    ] as const) {
      const res = await fetch(`${app.url}${url}`, {
        method,
        headers: { authorization: `Bearer ${rootToken}` },
      });
      assert.equal(res.status, 404);
      assert.equal((await json(res)).error.field, 'agent_id');
    }
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('POST /api/logout revokes the caller bearer and journals agent.logout', async () => {
  const app = await boot();
  try {
    await loginRoot(app.url);
    const created = await fetch(`${app.url}/api/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'logout-seat',
        display_name: 'Logout Seat',
        is_human: true,
        password: 'correct-horse',
      }),
    });
    assert.equal(created.status, 201);
    const seat = await json(created);

    const login = await fetch(`${app.url}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'logout-seat', password: 'correct-horse' }),
    });
    assert.equal(login.status, 200);
    const token = (await json(login)).token as string;

    const logout = await fetch(`${app.url}/api/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(logout.status, 200);
    const body = await json(logout);
    assert.equal(body.ok, true);
    assert.equal(body.token, undefined, 'no credential returned');
    assert.equal(body.token_hash, undefined, 'no token hash returned');
    assert.equal(body.password_hash, undefined, 'no password hash returned');

    // the bearer used for the call is dead on the next request
    const me = await fetch(`${app.url}/api/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(me.status, 401);

    // journalled once with the id only, never token material
    const events = app.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM events WHERE action = 'agent.logout'",
    );
    assert.equal(events?.n, 1);
    const ev = app.db.get<any>(
      "SELECT * FROM events WHERE action = 'agent.logout' ORDER BY id DESC LIMIT 1",
    );
    assert.equal(JSON.parse(ev.payload).agent_id, seat.id);
    assert.equal(JSON.stringify(ev).includes('token_hash'), false);

    // a second logout with the dead token is 401
    const again = await fetch(`${app.url}/api/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(again.status, 401);

    // missing token is 401 too
    const anonymous = await fetch(`${app.url}/api/logout`, { method: 'POST' });
    assert.equal(anonymous.status, 401);
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('mentions accept seat ids as well as handles, with dedupe and unknown ids reported', async () => {
  const app = await boot();
  try {
    const token = await loginRoot(app.url);
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const target = await register(app.url, 'id-target');
    const numericHandle = await register(app.url, '424242');

    // root's inbox lookup also accepts the id, so it proves the seat exists
    const forums = await json(await fetch(`${app.url}/api/forums`, { headers: auth }));
    const forumId = forums.forums[0].id;
    const openThread = async (mentions: Array<string | number>, title: string) => {
      const res = await fetch(`${app.url}/api/threads`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ forum_id: forumId, category: 'task', title, body: 'ping', mentions }),
      });
      assert.equal(res.status, 201);
      return json(res);
    };

    // numeric id, numeric string and @handle all resolve to the same seat
    const created = await openThread([target.id, String(target.id), `@${target.handle}`], 'by id');
    assert.deepEqual(created.mentions, [target.id], 'deduped to the seat id');
    assert.deepEqual(created.unknown_mentions, [], 'no unknown mentions');

    // a digit-only mention still resolves to a numeric handle when no id matches
    const byHandle = await openThread(['424242'], 'numeric handle');
    assert.deepEqual(byHandle.mentions, [numericHandle.id], 'numeric handle fallback');
    assert.deepEqual(byHandle.unknown_mentions, []);

    // unknown ids stay non-fatal and are reported
    const unknown = await openThread([987654], 'unknown id');
    assert.deepEqual(unknown.mentions, []);
    assert.deepEqual(unknown.unknown_mentions, ['987654']);

    // replies take the same path (forum_delegate's numeric-assignee case)
    const reply = await fetch(`${app.url}/api/threads/${created.thread.id}/replies`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ body: 'reply by id', mentions: [String(target.id)] }),
    });
    assert.equal(reply.status, 201);
    assert.deepEqual((await json(reply)).mentions, [target.id]);

    // the seat's inbox carries both notifications
    const inbox = await json(
      await fetch(`${app.url}/api/inbox/id-target`, { headers: auth }),
    );
    assert.equal(inbox.counts.mentions_total, 2, 'thread + reply mentions landed');
    assert.equal(inbox.counts.mentions, 2, 'both start unread');
  } finally {
    app.server.close();
    app.db.close();
  }
});
