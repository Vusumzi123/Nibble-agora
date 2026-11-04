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

test('mention read state: reading the thread clears the badge; explicit read is self-only', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-readflag-'));
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

    const reg = async (handle: string) =>
      json(
        await fetch(`${base}/api/agents`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle }),
        }),
      );
    const reader = await reg('badge-reader');
    const bystander = await reg('badge-bystander');
    const authR = {
      'content-type': 'application/json',
      authorization: `Bearer ${reader.token}`,
    };
    const authB = {
      'content-type': 'application/json',
      authorization: `Bearer ${bystander.token}`,
    };

    const forums = await json(
      await fetch(`${base}/api/forums`, { headers: { authorization: authR.authorization } }),
    );
    const forumId = forums.forums[0].id;

    const openThread = async (auth: Record<string, string>, title: string) =>
      json(
        await fetch(`${base}/api/threads`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({
            forum_id: forumId,
            category: 'task',
            title,
            body: 'ping',
            mentions: ['badge-reader'],
          }),
        }),
      );
    const inbox = async () =>
      json(await fetch(`${base}/api/inbox/badge-reader`, { headers: { authorization: authR.authorization } }));

    // 1) a fresh mention starts unread and is counted
    const t1 = await openThread(authB, 'read flag 1');
    const first = await inbox();
    assert.equal(first.counts.mentions, 1, 'unread count is 1');
    assert.equal(first.counts.mentions_total, 1, 'total is 1');
    assert.equal(first.mentions[0].read_at, null, 'row starts with read_at null');

    // 2) the reader fetching the thread clears it
    const view = await fetch(`${base}/api/threads/${t1.thread.id}`, {
      headers: { authorization: authR.authorization },
    });
    assert.equal(view.status, 200);
    const afterView = await inbox();
    assert.equal(afterView.counts.mentions, 0, 'reading clears the unread count');
    assert.equal(afterView.counts.mentions_total, 1, 'the mention still exists');
    assert.ok(afterView.mentions[0].read_at, 'read_at is stamped');

    // 3) someone else reading does not clear the reader's badge
    const t2 = await openThread(authB, 'read flag 2');
    await fetch(`${base}/api/threads/${t2.thread.id}`, {
      headers: { authorization: authB.authorization },
    });
    const afterBystander = await inbox();
    assert.equal(afterBystander.counts.mentions, 1, 'bystander read leaves it unread');

    // 4) explicit mark-all is self-only
    const other = await fetch(`${base}/api/inbox/badge-reader/read`, {
      method: 'POST',
      headers: authB,
    });
    assert.equal(other.status, 403, "another seat cannot clear your inbox");
    assert.equal((await json(other)).error.code, 'forbidden');

    const mine = await fetch(`${base}/api/inbox/badge-reader/read`, {
      method: 'POST',
      headers: authR,
    });
    assert.equal(mine.status, 200);
    assert.deepEqual(await json(mine), { ok: true, marked: 1 });

    const cleared = await inbox();
    assert.equal(cleared.counts.mentions, 0, 'badge cleared by mark-all');
    assert.equal(cleared.counts.mentions_total, 2, 'totals survive the read');

    // 5) idempotent + guards
    const again = await fetch(`${base}/api/inbox/badge-reader/read`, {
      method: 'POST',
      headers: authR,
    });
    assert.deepEqual(await json(again), { ok: true, marked: 0 }, 'second read marks nothing');

    const ghost = await fetch(`${base}/api/inbox/ghost/read`, {
      method: 'POST',
      headers: authR,
    });
    assert.equal(ghost.status, 404, 'unknown handle is 404');

    const anon = await fetch(`${base}/api/inbox/badge-reader/read`, { method: 'POST' });
    assert.equal(anon.status, 401, 'no token is 401');
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('thread read windows replies with limit/offset and reports replies_total', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-reply-window-'));
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
        body: JSON.stringify({ handle: 'window-tester' }),
      }),
    );
    const auth = {
      'content-type': 'application/json',
      authorization: `Bearer ${reg.token}`,
    };
    const forums = await json(
      await fetch(`${base}/api/forums`, { headers: { authorization: auth.authorization } }),
    );
    const forumId = forums.forums[0].id;

    const created = await json(
      await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          forum_id: forumId,
          category: 'discussion',
          title: 'windowed',
          body: 'entry',
        }),
      }),
    );
    const threadId = created.thread.id;
    for (let i = 0; i < 15; i++) {
      const res = await fetch(`${base}/api/threads/${threadId}/replies`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ body: `reply ${i}` }),
      });
      assert.equal(res.status, 201, `reply ${i} created`);
    }

    const read = async (query: string) => {
      const res = await fetch(`${base}/api/threads/${threadId}${query}`, {
        headers: { authorization: auth.authorization },
      });
      return { status: res.status, data: await json(res) };
    };

    // no window: the whole conversation, plus the reply count
    const all = await read('');
    assert.equal(all.status, 200);
    assert.equal(all.data.posts.length, 16);
    assert.equal(all.data.replies_total, 15);

    // head only — the entry lands before the replies
    const head = await read('?replies_limit=0');
    assert.equal(head.data.posts.length, 1);
    assert.equal(head.data.posts[0].body, 'entry');
    assert.equal(head.data.replies_total, 15);

    const newest = await read('?replies_limit=10&replies_offset=5');
    assert.equal(newest.data.posts.length, 11, 'entry + one window');
    assert.equal(newest.data.posts[0].body, 'entry');
    assert.equal(newest.data.posts[1].body, 'reply 5', 'offset counts replies, not the entry');
    assert.equal(newest.data.posts[10].body, 'reply 14');

    const tail = await read('?replies_limit=5&replies_offset=0');
    assert.equal(tail.data.posts.length, 6);
    assert.equal(tail.data.posts[1].body, 'reply 0');

    const past = await read('?replies_limit=10&replies_offset=15');
    assert.equal(past.data.posts.length, 1, 'past the end only the entry remains');

    for (const query of [
      '?replies_limit=-1',
      '?replies_limit=501',
      '?replies_limit=abc',
      '?replies_offset=-1',
      '?replies_offset=x',
    ]) {
      const bad = await read(query);
      assert.equal(bad.status, 400, `${query} rejected with 400`);
      assert.equal(bad.data.error.code, 'bad_request');
    }
  } finally {
    app.server.close();
    app.db.close();
  }
});


test('mention dismiss: DELETE removes only the caller\'s row, journals, and guards', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-mention-delete-'));
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
    const reg = async (handle: string) =>
      json(
        await fetch(`${base}/api/agents`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle }),
        }),
      );

    const owner = await reg('mention-owner');
    const bystander = await reg('mention-bystander');
    const authOwner = {
      'content-type': 'application/json',
      authorization: `Bearer ${owner.token}`,
    };
    const authBystander = {
      'content-type': 'application/json',
      authorization: `Bearer ${bystander.token}`,
    };

    const forums = await json(
      await fetch(`${base}/api/forums`, { headers: { authorization: authOwner.authorization } }),
    );
    const forumId = forums.forums[0].id;

    const made = await json(
      await fetch(`${base}/api/threads`, {
        method: 'POST',
        headers: authBystander,
        body: JSON.stringify({
          forum_id: forumId,
          category: 'discussion',
          title: 'dismiss me',
          body: 'ping',
          mentions: ['mention-owner', 'mention-bystander'],
        }),
      }),
    );
    const threadId = made.thread.id;

    const inbox = async (handle: string, auth: Record<string, string>) =>
      json(await fetch(`${base}/api/inbox/${handle}`, { headers: { authorization: auth.authorization } }));

    const mine = await inbox('mention-owner', authOwner);
    const theirs = await inbox('mention-bystander', authBystander);
    assert.equal(mine.counts.mentions_total, 1);
    assert.equal(theirs.counts.mentions_total, 1);
    const mentionId = mine.mentions[0].mention_id as number;
    const bystanderMentionId = theirs.mentions[0].mention_id as number;
    assert.notEqual(mentionId, bystanderMentionId);

    const del = (handle: string, id: number | string, headers?: Record<string, string>) =>
      fetch(`${base}/api/inbox/${handle}/mentions/${id}`, { method: 'DELETE', headers });

    // 200: self-scoped hard delete of exactly one row
    const ok = await del('mention-owner', mentionId, authOwner);
    assert.equal(ok.status, 200);
    assert.deepEqual(await json(ok), { ok: true, removed: 1 });

    const afterOwner = await inbox('mention-owner', authOwner);
    assert.equal(afterOwner.counts.mentions_total, 0, 'owner row is gone');
    assert.equal(afterOwner.mentions.length, 0);

    // post + thread survive; the other seat's mention on the same post survives
    const thread = await fetch(`${base}/api/threads/${threadId}`, {
      headers: { authorization: authOwner.authorization },
    });
    assert.equal(thread.status, 200, 'thread still readable');
    const afterBystander = await inbox('mention-bystander', authBystander);
    assert.equal(afterBystander.counts.mentions_total, 1, 'other seat mention intact');

    // repeat + cross-seat + unknown rows
    assert.equal((await del('mention-owner', mentionId, authOwner)).status, 404, 'already removed');
    assert.equal(
      (await del('mention-owner', bystanderMentionId, authOwner)).status,
      404,
      "cannot delete another seat's row via own handle",
    );
    assert.equal(
      (await del('mention-owner', bystanderMentionId, authBystander)).status,
      403,
      'another seat cannot target your handle',
    );
    assert.equal((await del('ghost', mentionId, authOwner)).status, 404, 'unknown handle');
    assert.equal((await del('mention-owner', 999999, authOwner)).status, 404, 'unknown mention');
    assert.equal((await del('mention-owner', mentionId)).status, 401, 'no token');

    // journal entry mirrors mention.create's shape
    const event = app.db.get<{ action: string; target: string; payload: string }>(
      "SELECT action, target, payload FROM events WHERE action = 'mention.delete'",
    );
    assert.ok(event, 'mention.delete journaled');
    assert.equal(event!.target, `mention:${mentionId}`);
    assert.deepEqual(JSON.parse(event!.payload), { agent_ids: [owner.id] });
  } finally {
    app.server.close();
    app.db.close();
  }
});

test('inbox mentions filter by unread and a default 15-day window', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-inbox-filter-'));
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
    const reg = async (handle: string) =>
      json(
        await fetch(`${base}/api/agents`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle }),
        }),
      );
    const reader = await reg('filter-reader');
    const author = await reg('filter-author');
    const authR = { 'content-type': 'application/json', authorization: `Bearer ${reader.token}` };
    const authA = { 'content-type': 'application/json', authorization: `Bearer ${author.token}` };

    const forums = await json(
      await fetch(`${base}/api/forums`, { headers: { authorization: authA.authorization } }),
    );
    const forumId = forums.forums[0].id;

    const openThread = async (title: string) =>
      json(
        await fetch(`${base}/api/threads`, {
          method: 'POST',
          headers: authA,
          body: JSON.stringify({
            forum_id: forumId,
            category: 'task',
            title,
            body: 'ping',
            mentions: ['filter-reader'],
          }),
        }),
      );

    const day = 24 * 60 * 60 * 1000;
    const backdate = (postId: number, ageMs: number) =>
      app.db.run(
        'UPDATE posts SET created_at = ? WHERE id = ?',
        new Date(Date.now() - ageMs).toISOString(),
        postId,
      );

    await openThread('recent unread');
    const recentRead = await openThread('recent read');
    const fourteeen = await openThread('fourteen days');
    backdate(fourteeen.post.id, 14 * day);
    const fifteen = await openThread('fifteen days');
    backdate(fifteen.post.id, 15 * day);
    const sixteen = await openThread('sixteen days');
    backdate(sixteen.post.id, 16 * day);

    // Viewing the thread stamps read_at only (the row stays in the inbox).
    const view = await fetch(`${base}/api/threads/${recentRead.thread.id}`, {
      headers: { authorization: authR.authorization },
    });
    assert.equal(view.status, 200, 'viewing marks the mention read');

    const inbox = async (query = '') => {
      const res = await fetch(`${base}/api/inbox/filter-reader${query}`, {
        headers: { authorization: authR.authorization },
      });
      return { status: res.status, data: await json(res) };
    };

    // Default: last 15 days (read + unread), 15-day-old boundary excluded.
    const def = await inbox();
    assert.equal(def.status, 200);
    assert.equal(def.data.window.default, true, 'default window is signalled');
    assert.deepEqual(
      def.data.mentions.map((m: any) => m.thread_title).sort(),
      ['fourteen days', 'recent read', 'recent unread'],
      'the 15- and 16-day-old mentions are hidden',
    );
    assert.equal(def.data.counts.mentions, 4, 'badge stays the global unread count');
    assert.equal(def.data.counts.mentions_total, 3, 'total counts the filtered rows');

    // window=all skips the default 15-day cutoff.
    const all = await inbox('?window=all');
    assert.equal(all.data.window.default, false, 'all-time is not the default window');
    assert.equal(all.data.window.since, null, 'all-time has no lower bound');
    assert.equal(all.data.mentions.length, 5, 'all five mentions are reachable');

    // unread=1 drops the read row, still inside the default window.
    const unread = await inbox('?unread=1');
    assert.deepEqual(
      unread.data.mentions.map((m: any) => m.thread_title).sort(),
      ['fourteen days', 'recent unread'],
    );
    assert.equal(unread.data.counts.mentions, 4, 'badge ignores the read filter');
    assert.equal(unread.data.counts.mentions_total, 2, 'total respects unread + window');

    // An explicit since replaces the default and reaches older history.
    const since17 = new Date(Date.now() - 17 * day).toISOString().slice(0, 10);
    const widened = await inbox(`?since=${since17}`);
    assert.equal(widened.data.window.default, false, 'explicit since disables the default');
    assert.equal(widened.data.mentions.length, 5, 'all five mentions are reachable');

    // since + until + unread combine, with whole-day inclusive boundaries.
    const since14 = new Date(Date.now() - 14 * day).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const combo = await inbox(`?unread=1&since=${since14}&until=${today}`);
    assert.deepEqual(
      combo.data.mentions.map((m: any) => m.thread_title).sort(),
      ['fourteen days', 'recent unread'],
      'combined filters intersect',
    );

    // until-only has no lower bound (the default window is not applied).
    const onlyUntil = await inbox(`?until=${today}`);
    assert.equal(onlyUntil.data.window.since, null, 'until-only has no lower bound');

    // Invalid and inverted ranges are 400s with field detail.
    const bad = await inbox('?since=not-a-date');
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error.code, 'bad_request');
    assert.equal(bad.data.error.field, 'since');

    const inverted = await inbox('?since=2026-02-10&until=2026-02-01');
    assert.equal(inverted.status, 400);
    assert.equal(inverted.data.error.code, 'bad_request');
  } finally {
    app.server.close();
    app.db.close();
  }
});
