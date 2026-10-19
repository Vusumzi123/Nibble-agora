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

/** Boot a fresh instance + a registered seat, run the body, always tear down. */
async function withProjects(
  fn: (ctx: { base: string; auth: Record<string, string> }) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-projects-'));
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
        body: JSON.stringify({ handle: 'projects-tester' }),
      }),
    );
    await fn({
      base: app.url,
      auth: {
        'content-type': 'application/json',
        authorization: `Bearer ${reg.token}`,
      },
    });
  } finally {
    app.server.close();
    app.db.close();
  }
}

test('projects list exposes one board per project; the seeded forum counts too', () =>
  withProjects(async ({ base, auth }) => {
    const data = await json(await fetch(`${base}/api/projects`, { headers: auth }));
    assert.equal(data.projects.length, 1, 'the seeded default project');
    assert.equal(data.projects[0].name, 'Agora');
    assert.equal(data.projects[0].slug, 'agora');
    assert.ok(data.projects[0].board_id, 'seeded project has a board');
  }));

test('POST /api/projects creates the project, its single board and default columns', () =>
  withProjects(async ({ base, auth }) => {
    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Nemu Home', description: 'agent workbench' }),
    });
    assert.equal(res.status, 201);
    const data = await json(res);
    assert.equal(data.project.name, 'Nemu Home');
    assert.equal(data.project.slug, 'nemu-home');
    assert.equal(data.project.position, 1, 'new projects append after the seed');
    assert.equal(data.board.name, 'Nemu Home');
    assert.equal(data.board.project_id, data.project.id);
    assert.deepEqual(
      data.columns.map((c: { name: string }) => c.name),
      ['INBOX', 'TODO', 'IN-PROGRESS', 'TESTING', 'DONE', 'DROPPED'],
    );

    // listed with its board link
    const list = await json(await fetch(`${base}/api/projects`, { headers: auth }));
    const created = list.projects.find((p: { name: string }) => p.name === 'Nemu Home');
    assert.ok(created);
    assert.equal(created.board_id, data.board.id);

    // duplicate names are refused across projects and boards
    const dup = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Nemu Home' }),
    });
    assert.equal(dup.status, 409);
  }));

test('PATCH /api/projects/:id reorders the project list', () =>
  withProjects(async ({ base, auth }) => {
    const second = await json(
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ name: 'Second' }),
      }),
    );
    const third = await json(
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ name: 'Third' }),
      }),
    );
    const initial = await json(await fetch(`${base}/api/projects`, { headers: auth }));
    assert.deepEqual(
      initial.projects.map((p: { name: string }) => p.name),
      ['Agora', 'Second', 'Third'],
    );

    // mirror the client: move Third to the front, then densify the rest
    const order = [third.project.id, initial.projects[0].id, second.project.id];
    for (let i = 0; i < order.length; i++) {
      const res = await fetch(`${base}/api/projects/${order[i]}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ position: i }),
      });
      assert.equal(res.status, 200);
      assert.equal((await json(res)).project.position, i);
    }

    const reordered = await json(await fetch(`${base}/api/projects`, { headers: auth }));
    assert.deepEqual(
      reordered.projects.map((p: { name: string }) => p.name),
      ['Third', 'Agora', 'Second'],
    );
    assert.deepEqual(
      reordered.projects.map((p: { position: number }) => p.position),
      [0, 1, 2],
    );

    // negative positions and anonymous writes are refused
    assert.equal(
      (
        await fetch(`${base}/api/projects/${second.project.id}`, {
          method: 'PATCH',
          headers: auth,
          body: JSON.stringify({ position: -1 }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(`${base}/api/projects/${second.project.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ position: 0 }),
        })
      ).status,
      401,
    );
  }));

test('a board created via the legacy endpoint also gets its project', () =>
  withProjects(async ({ base, auth }) => {
    const res = await fetch(`${base}/api/boards`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Legacy Board' }),
    });
    assert.equal(res.status, 201);
    const data = await json(res);
    assert.ok(data.board.project_id, 'legacy boards are never project-less');

    const list = await json(await fetch(`${base}/api/projects`, { headers: auth }));
    const created = list.projects.find((p: { name: string }) => p.name === 'Legacy Board');
    assert.ok(created, 'its project is listed');
    assert.equal(created.board_id, data.board.id);
  }));

test('PATCH /api/boards/:id renames project and board together, slug stays stable', () =>
  withProjects(async ({ base, auth }) => {
    const created = await json(
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ name: 'To Rename', description: 'old' }),
      }),
    );

    const res = await fetch(`${base}/api/boards/${created.board.id}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ name: 'Renamed Project', description: 'new' }),
    });
    assert.equal(res.status, 200);
    const data = await json(res);
    assert.equal(data.board.name, 'Renamed Project');
    assert.equal(data.board.description, 'new');
    assert.equal(data.project.name, 'Renamed Project');
    assert.equal(data.project.description, 'new');
    assert.equal(data.project.slug, created.project.slug, 'the slug never moves');

    // a name already used by another project is refused on both tables
    const dup = await fetch(`${base}/api/boards/${created.board.id}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ name: 'Agora' }),
    });
    assert.equal(dup.status, 409);
  }));

test('DELETE /api/boards/:id drops the project, its board and the cascade', () =>
  withProjects(async ({ base, auth }) => {
    const created = await json(
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ name: 'Doomed' }),
      }),
    );

    const res = await fetch(`${base}/api/boards/${created.board.id}`, {
      method: 'DELETE',
      headers: auth,
    });
    assert.equal(res.status, 200);

    const projects = await json(await fetch(`${base}/api/projects`, { headers: auth }));
    assert.ok(
      !projects.projects.some((p: { name: string }) => p.name === 'Doomed'),
      'the project row is gone',
    );
    const boards = await json(await fetch(`${base}/api/boards`, { headers: auth }));
    assert.ok(
      !boards.boards.some((b: { id: number }) => b.id === created.board.id),
      'the board row is gone',
    );
    assert.ok(
      boards.boards.every((b: { project_id: number }) => b.project_id !== null),
      'no board is left project-less',
    );
  }));

test('DELETE /api/columns/:id cascades cards, denses positions, needs a token', () =>
  withProjects(async ({ base, auth }) => {
    const created = await json(
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ name: 'Column Test' }),
      }),
    );
    const boardId: number = created.board.id;
    const first: { id: number } = created.columns[0];

    const card = await json(
      await fetch(`${base}/api/cards`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ board_id: boardId, column_id: first.id, title: 'doomed card' }),
      }),
    );
    assert.equal(card.card.column_id, first.id);

    // anonymous delete is refused
    assert.equal((await fetch(`${base}/api/columns/${first.id}`, { method: 'DELETE' })).status, 401);

    const res = await fetch(`${base}/api/columns/${first.id}`, { method: 'DELETE', headers: auth });
    assert.equal(res.status, 200);
    assert.deepEqual(await json(res), { ok: true, id: first.id });

    const boards = await json(await fetch(`${base}/api/boards`, { headers: auth }));
    const board = boards.boards.find((b: { id: number }) => b.id === boardId);
    assert.ok(
      !board.columns.some((c: { id: number }) => c.id === first.id),
      'the column row is gone',
    );
    assert.deepEqual(
      board.columns.map((c: { position: number }) => c.position),
      [0, 1, 2, 3, 4],
      'remaining positions are dense',
    );

    const cards = await json(await fetch(`${base}/api/boards/${boardId}/cards`, { headers: auth }));
    assert.ok(
      !cards.cards.some((c: { id: number }) => c.id === card.card.id),
      'the card cascaded away',
    );

    assert.equal(
      (await fetch(`${base}/api/columns/999999`, { method: 'DELETE', headers: auth })).status,
      404,
    );
  }));

test('DELETE /api/cards/:id removes the card, re-denses its column, needs a token', () =>
  withProjects(async ({ base, auth }) => {
    const created = await json(
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ name: 'Card Delete' }),
      }),
    );
    const boardId: number = created.board.id;
    const colId: number = created.columns[0].id;

    const mk = async (title: string) => {
      const r = await json(
        await fetch(`${base}/api/cards`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ board_id: boardId, column_id: colId, title }),
        }),
      );
      return r.card as { id: number; position: number };
    };
    const a = await mk('first');
    const b = await mk('second');
    const c = await mk('third');

    // anonymous delete is refused
    assert.equal((await fetch(`${base}/api/cards/${b.id}`, { method: 'DELETE' })).status, 401);

    const res = await fetch(`${base}/api/cards/${b.id}`, { method: 'DELETE', headers: auth });
    assert.equal(res.status, 200);
    assert.deepEqual(await json(res), { ok: true, id: b.id });

    const cards = await json(await fetch(`${base}/api/boards/${boardId}/cards`, { headers: auth }));
    const ids = cards.cards.map((x: { id: number }) => x.id);
    assert.ok(!ids.includes(b.id), 'the card row is gone');
    assert.ok(ids.includes(a.id) && ids.includes(c.id), 'its neighbours survive');
    assert.deepEqual(
      cards.cards.map((x: { position: number }) => x.position),
      [0, 1],
      'remaining positions are dense',
    );

    assert.equal(
      (await fetch(`${base}/api/cards/${b.id}`, { method: 'DELETE', headers: auth })).status,
      404,
    );
  }));

test('forum overview reports counts and recent threads; threads carry no project link', () =>
  withProjects(async ({ base, auth }) => {
    const forums = await json(await fetch(`${base}/api/forums`, { headers: auth }));
    const forumId = forums.forums[0].id;

    await fetch(`${base}/api/threads`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ forum_id: forumId, category: 'idea', title: 'overview topic', body: 'hi' }),
    });

    const data = await json(await fetch(`${base}/api/forums/${forumId}/overview`, { headers: auth }));
    assert.equal(data.forum.name, 'Agora');
    assert.equal(data.counts.projects, 1);
    assert.equal(data.counts.threads, 1);
    assert.equal(data.recent_threads.length, 1);
    assert.equal(data.recent_threads[0].title, 'overview topic');
    assert.ok(
      !('project_name' in data.recent_threads[0]),
      'no project association on threads',
    );
  }));

test('forums own their projects and threads; a second forum is isolated', () =>
  withProjects(async ({ base, auth }) => {
    const created = await json(
      await fetch(`${base}/api/forums`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ name: 'Nemu Space' }),
      }),
    );
    const secondId = created.forum.id;

    await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Nemu Home', forum_id: secondId }),
    });
    await fetch(`${base}/api/threads`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ forum_id: secondId, title: 'second forum thread', body: 'hi' }),
    });

    const forums = await json(await fetch(`${base}/api/forums`, { headers: auth }));
    assert.equal(forums.forums.length, 2);

    // the default forum still sees only its own seeded project, no threads
    const first = forums.forums[0];
    const firstProjects = await json(
      await fetch(`${base}/api/projects?forum=${first.id}`, { headers: auth }),
    );
    assert.equal(firstProjects.projects.length, 1);
    const firstThreads = await json(
      await fetch(`${base}/api/forums/${first.id}/threads`, { headers: auth }),
    );
    assert.equal(firstThreads.threads.length, 0);

    // the second forum holds the new project + thread
    const secondProjects = await json(
      await fetch(`${base}/api/projects?forum=${secondId}`, { headers: auth }),
    );
    assert.equal(secondProjects.projects.length, 1);
    assert.equal(secondProjects.projects[0].name, 'Nemu Home');
    const secondThreads = await json(
      await fetch(`${base}/api/forums/${secondId}/threads`, { headers: auth }),
    );
    assert.equal(secondThreads.threads.length, 1);
    assert.equal(secondThreads.threads[0].title, 'second forum thread');
  }));

test('cards carry a body (renamed from description); the thread bridge is gone', () =>
  withProjects(async ({ base, auth }) => {
    const created = await json(
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ name: 'Body Test' }),
      }),
    );
    const boardId: number = created.board.id;
    const colId: number = created.columns[0].id;

    const made = await json(
      await fetch(`${base}/api/cards`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          board_id: boardId,
          column_id: colId,
          title: 'body card',
          body: 'hello\nworld',
        }),
      }),
    );
    assert.equal(made.card.body, 'hello\nworld');
    assert.equal('thread_id' in made.card, false, 'cards carry no thread link');
    assert.equal('description' in made.card, false, 'description became body');

    const patched = await json(
      await fetch(`${base}/api/cards/${made.card.id}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ title: 'renamed', body: 'v2' }),
      }),
    );
    assert.equal(patched.card.title, 'renamed');
    assert.equal(patched.card.body, 'v2');

    // the old field name is inert — cards have one text field now
    const stale = await json(
      await fetch(`${base}/api/cards/${made.card.id}`, {
        method: 'PATCH',
        headers: auth,
        body: JSON.stringify({ description: 'ignored' }),
      }),
    );
    assert.equal(stale.card.body, 'v2', 'description is not a field anymore');

    // both link endpoints are gone
    assert.equal(
      (
        await fetch(`${base}/api/cards/${made.card.id}/link`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ thread_id: 1 }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${base}/api/threads/1/link`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ card_id: made.card.id }),
        })
      ).status,
      404,
    );
  }));

test('projects and overview reads require a bearer token', () =>
  withProjects(async ({ base }) => {
    assert.equal((await fetch(`${base}/api/projects`)).status, 401);
    assert.equal((await fetch(`${base}/api/forums/1/overview`)).status, 401);
  }));
