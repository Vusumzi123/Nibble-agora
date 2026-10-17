import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadConfig } from '../config.ts';
import { start, type App } from '../server/index.ts';
import { READ_PAGE } from './tools.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ALL_TOOLS = [
  'forum_whoami',
  'forum_forums',
  'forum_boards',
  'forum_browse',
  'forum_read',
  'forum_post',
  'forum_reply',
  'forum_react',
  'forum_cards',
  'forum_card_create',
  'forum_card_move',
  'forum_delegate',
  'forum_inbox',
  'forum_columns',
];

let app: App;
let client: Client;
const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-mcp-'));

after(async () => {
  await client?.close().catch(() => undefined);
  app?.server.close();
  app?.db.close();
  rmSync(dir, { recursive: true, force: true });
});

const json = (r: Response) => r.json() as Promise<Record<string, any>>;

async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content?: { type: string; text: string }[];
    isError?: boolean;
  };
  assert.ok(!res.isError, `${name} returned isError: ${res.content?.[0]?.text}`);
  const text = res.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

test('mcp bridge end-to-end: all 14 tools over stdio', { timeout: 60000 }, async () => {
  // ── boot the service on an ephemeral port with a throwaway DB ──
  mkdirSync(path.join(dir, 'data'));
  const configPath = path.join(dir, 'config.yaml');
  writeFileSync(configPath, 'bind: 127.0.0.1\nport: 0\ndata_dir: data\ndb_file: agora.db\n');
  const cfg = loadConfig({ configPath, cwd: dir, env: { AGORA_PORT: '0' } });
  app = await start(cfg);

  // ── register a test agent (token shown once) ──
  const reg = await json(
    await fetch(`${app.url}/api/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'nemu-test', display_name: 'Nemu Test' }),
    }),
  );
  assert.ok(reg.token, 'registration returns a token');
  assert.equal(reg.handle, 'nemu-test');

  // ── spawn the bridge exactly like a harness would (stdio) ──
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'src', 'mcp', 'index.ts')],
    cwd: ROOT,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
      ),
      AGORA_URL: app.url,
      AGORA_TOKEN: reg.token,
    },
  });
  client = new Client({ name: 'agora-e2e', version: '0.0.0' });
  await client.connect(transport);

  // ── tool surface ──
  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...ALL_TOOLS].sort(), 'all 14 forum_* tools are registered');
  for (const tool of listed.tools) {
    assert.ok(tool.description, `${tool.name} has a description`);
  }

  // ── exercise every tool against the live REST service ──
  const who = await call('forum_whoami');
  assert.equal(who.agent.handle, 'nemu-test');

  const boards = await call('forum_boards');
  const agora = boards.boards.find((b: any) => b.slug === 'agora');
  assert.ok(agora, 'seeded board exists');
  assert.ok(agora.columns.length >= 5, 'seeded columns exist');

  const forums = await call('forum_forums');
  assert.ok(
    forums.forums.some((f: any) => f.slug === 'forum'),
    'seeded forum is listed',
  );

  const posted = await call('forum_post', {
    forum: 'forum',
    category: 'task',
    title: 'wire the bridge',
    body: 'phase 2: 12+1 tools over REST',
    mentions: ['root'],
  });
  assert.equal(posted.thread.title, 'wire the bridge');
  const threadId = posted.thread.id;
  const postId = posted.post.id;

  const browsed = await call('forum_browse', { forum: 'forum', category: 'task' });
  assert.ok(
    browsed.threads.some((t: any) => t.id === threadId),
    'new thread appears in browse',
  );

  const reply = await call('forum_reply', { thread_id: threadId, body: 'first reply' });
  assert.ok(reply.post.id, 'reply created');

  const read = await call('forum_read', { thread_id: threadId });
  assert.equal(read.posts.length, 2, 'thread + reply');
  assert.equal(read.next_cursor, null, 'short thread has no cursor');

  const reacted = await call('forum_react', { target: 'post', target_id: postId, emoji: '+1' });
  assert.ok(
    reacted.reactions.some((r: any) => r.emoji === '+1' && r.agent === 'nemu-test'),
    'reaction recorded',
  );

  const created = await call('forum_card_create', {
    board: 'agora',
    title: 'bridge card',
    body: 'made via forum_card_create',
    column: 'todo',
    assignee: 'nemu-test',
  });
  const cardId = created.card.id;
  const todoId = agora.columns.find((c: any) => c.name === 'todo').id;
  const doingId = agora.columns.find((c: any) => c.name === 'doing').id;
  assert.equal(created.card.column_id, todoId, 'card lands in "todo"');
  assert.equal(created.card.assignee_id, reg.id);
  assert.equal(created.card.body, 'made via forum_card_create', 'card body round-trips');

  const cards = await call('forum_cards', { board: 'agora', column: 'todo', assignee: 'nemu-test' });
  assert.ok(cards.cards.some((c: any) => c.id === cardId), 'filters find the card');

  const moved = await call('forum_card_move', { card_id: cardId, column: 'doing' });
  assert.equal(moved.card.column_id, doingId, 'card moved by column name');

  const delegated = await call('forum_delegate', {
    board: 'agora',
    title: 'delegated work',
    column: 'inbox',
    assignee: 'nemu-test',
    mention: '@nemu-test please pick this up',
  });
  assert.equal(delegated.card.assignee_id, reg.id);
  assert.ok(
    delegated.mention?.thread?.id,
    'mention opens a task thread in the forum (no card link)',
  );
  assert.equal(delegated.card.thread_id, undefined, 'cards carry no thread link');

  const inbox = await call('forum_inbox');
  assert.equal(inbox.handle, 'nemu-test');
  assert.ok(
    inbox.cards.some((c: any) => c.id === delegated.card.id),
    'assigned card in inbox',
  );
  assert.ok(inbox.mentions.length >= 1, 'mention in inbox');

  const cols = await call('forum_columns', { board: 'agora' });
  const baseCount = cols.columns.length;
  const added = await call('forum_columns', { board: 'agora', action: 'add', name: 'review' });
  assert.equal(added.column.name, 'review');
  const updated = await call('forum_columns', {
    board: 'agora',
    action: 'update',
    column_id: added.column.id,
    name: 'reviewed',
  });
  assert.equal(updated.column.name, 'reviewed');
  const listedCols = await call('forum_columns', { board: 'agora' });
  assert.equal(listedCols.columns.length, baseCount + 1, 'new column persists');

  // ── cursor truncation on long threads (plan §MCP tools) ──
  for (let i = 0; i < READ_PAGE + 2; i++) {
    await call('forum_reply', { thread_id: threadId, body: `burst ${i}` });
  }
  const page1 = await call('forum_read', { thread_id: threadId });
  assert.equal(page1.posts.length, READ_PAGE);
  assert.equal(page1.total_posts, 2 + READ_PAGE + 2);
  assert.equal(page1.next_cursor, READ_PAGE);
  const page2 = await call('forum_read', { thread_id: threadId, cursor: page1.next_cursor });
  assert.equal(page2.posts.length, 4);
  assert.equal(page2.next_cursor, null, 'last page announces no cursor');

  // ── errors come back as tool errors, not crashes ──
  const bad = (await client.callTool({ name: 'forum_read', arguments: { thread_id: 999999 } })) as {
    isError?: boolean;
  };
  assert.equal(bad.isError, true, 'missing thread surfaces as isError');
});
