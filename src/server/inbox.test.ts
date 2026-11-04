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

test('mention dismiss hides the inbox row but keeps the pill; undismiss restores it', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-mention-dismiss-'));
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

    const owner = await reg('dismiss-owner');
    const bystander = await reg('dismiss-bystander');
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
          title: 'dismiss keep pill',
          body: 'ping',
          mentions: ['dismiss-owner', 'dismiss-bystander'],
        }),
      }),
    );
    const threadId = made.thread.id as number;

    const inbox = async (handle: string, auth: Record<string, string>) =>
      json(
        await fetch(`${base}/api/inbox/${handle}`, {
          headers: { authorization: auth.authorization },
        }),
      );
    const post = (handle: string, id: number | string, action: string, headers?: Record<string, string>) =>
      fetch(`${base}/api/inbox/${handle}/mentions/${id}/${action}`, { method: 'POST', headers });

    const mine = await inbox('dismiss-owner', authOwner);
    assert.equal(mine.counts.mentions_total, 1);
    const mentionId = mine.mentions[0].mention_id as number;

    // 1) dismiss hides the notification but not the mention
    const ok = await post('dismiss-owner', mentionId, 'dismiss', authOwner);
    assert.equal(ok.status, 200);
    assert.deepEqual(await json(ok), { ok: true, dismissed: 1 });

    const hidden = await inbox('dismiss-owner', authOwner);
    assert.equal(hidden.mentions.length, 0, 'dismissed row is hidden');
    assert.equal(hidden.counts.mentions_total, 0, 'filtered count drops');
    assert.equal(hidden.counts.mentions, 0, 'unread badge drops');

    const thread = await json(
      await fetch(`${base}/api/threads/${threadId}`, {
        headers: { authorization: authOwner.authorization },
      }),
    );
    assert.ok(
      (thread.posts[0].mentions as string[]).includes('dismiss-owner'),
      'the post still shows the pill after dismiss',
    );

    // 2) reading the thread stamps read_at but never clears dismissed_at
    const stillHidden = await inbox('dismiss-owner', authOwner);
    assert.equal(stillHidden.mentions.length, 0, 'thread open does not restore the row');

    // 3) idempotent dismiss
    const again = await post('dismiss-owner', mentionId, 'dismiss', authOwner);
    assert.deepEqual(await json(again), { ok: true, dismissed: 1 }, 'second dismiss is a no-op 200');

    // 4) guards: self-only, unknown id/handle, no token
    assert.equal(
      (await post('dismiss-owner', mentionId, 'dismiss', authBystander)).status,
      403,
      'another seat cannot target your handle',
    );
    assert.equal(
      (await post('dismiss-owner', 999999, 'dismiss', authOwner)).status,
      404,
      'unknown mention',
    );
    assert.equal(
      (await post('ghost', mentionId, 'dismiss', authOwner)).status,
      404,
      'unknown handle',
    );
    assert.equal((await post('dismiss-owner', mentionId, 'dismiss')).status, 401, 'no token');

    // 5) journal
    const event = app.db.get<{ target: string; payload: string }>(
      "SELECT target, payload FROM events WHERE action = 'mention.dismiss'",
    );
    assert.ok(event, 'mention.dismiss journaled');
    assert.equal(event!.target, `mention:${mentionId}`);
    assert.deepEqual(JSON.parse(event!.payload), { agent_ids: [owner.id] });

    // 6) undismiss restores the row (read_at survives)
    const restored = await post('dismiss-owner', mentionId, 'undismiss', authOwner);
    assert.deepEqual(await json(restored), { ok: true, dismissed: 0 });
    const back = await inbox('dismiss-owner', authOwner);
    assert.equal(back.mentions.length, 1, 'undismiss restores the row');
    assert.ok(back.mentions[0].read_at, 'read_at is preserved across dismiss/undismiss');
    assert.deepEqual(
      await json(await post('dismiss-owner', mentionId, 'undismiss', authOwner)),
      { ok: true, dismissed: 0 },
      'second undismiss is a no-op 200',
    );
    assert.ok(
      app.db.get("SELECT 1 FROM events WHERE action = 'mention.undismiss'"),
      'mention.undismiss journaled',
    );

    // 7) other seat is untouched; DELETE still hard-removes the row
    const theirs = await inbox('dismiss-bystander', authBystander);
    assert.equal(theirs.counts.mentions_total, 1, 'other seat mention intact');
    const del = await fetch(`${base}/api/inbox/dismiss-owner/mentions/${mentionId}`, {
      method: 'DELETE',
      headers: authOwner,
    });
    assert.deepEqual(await json(del), { ok: true, removed: 1 });
    const gone = await inbox('dismiss-owner', authOwner);
    assert.equal(gone.counts.mentions_total, 0, 'DELETE still removes the row');
  } finally {
    app.server.close();
    app.db.close();
  }
});
