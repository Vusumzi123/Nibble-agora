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
  'forum_agents',
  'forum_boards',
  'forum_board_create',
  'forum_board_update',
  'forum_board_reorder',
  'forum_board_delete',
  'forum_browse',
  'forum_read',
  'forum_post',
  'forum_reply',
  'forum_react',
  'forum_upvote',
  'forum_cards',
  'forum_card_create',
  'forum_card_move',
  'forum_card_delete',
  'forum_card_comment',
  'forum_card_comments',
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

test('mcp bridge end-to-end: all 23 tools over stdio', { timeout: 60000 }, async () => {
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
  assert.deepEqual(names, [...ALL_TOOLS].sort(), 'all 23 forum_* tools are registered');
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

  const agents = await call('forum_agents');
  assert.ok(
    agents.agents.some((a: any) => a.handle === 'nemu-test'),
    'agent directory lists the caller',
  );

  // board CRUD: create seeds project + board + columns, update mirrors both rows
  const madeBoard = await call('forum_board_create', {
    name: 'bridge-board',
    description: 'made over the bridge',
    forum: 'forum',
  });
  assert.equal(madeBoard.project.name, 'bridge-board');
  assert.equal(madeBoard.board.name, 'bridge-board', 'project and board mirror each other');
  assert.ok(
    madeBoard.columns.some((c: any) => c.name === 'INBOX'),
    'project default columns are seeded',
  );
  const newBoardId = madeBoard.board.id;

  const reordered = await call('forum_board_reorder', { board: newBoardId, position: 0 });
  assert.equal(reordered.project.position, 0, 'project position updated');

  const renamedBoard = await call('forum_board_update', {
    board: newBoardId,
    name: 'bridge-board-2',
    description: 'renamed over the bridge',
  });
  assert.equal(renamedBoard.board.name, 'bridge-board-2');
  assert.equal(renamedBoard.project.name, 'bridge-board-2', 'project follows the board rename');

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

  // thread upvote: up increments and flags voted, remove retracts
  const beforeVotes = read.thread.votes;
  const voted = await call('forum_upvote', { thread_id: threadId });
  assert.equal(voted.voted, true, 'upvote recorded');
  assert.equal(voted.votes, beforeVotes + 1, 'vote count increments');
  const retracted = await call('forum_upvote', { thread_id: threadId, op: 'remove' });
  assert.equal(retracted.voted, false, 'upvote retracted');
  assert.equal(retracted.votes, beforeVotes, 'vote count restored');

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

  const blocked = await call('forum_card_move', { card_id: cardId, blocked: true });
  assert.ok(blocked.card.blocked_at, 'card marked blocked');
  const unblocked = await call('forum_card_move', { card_id: cardId, blocked: false });
  assert.equal(unblocked.card.blocked_at, null, 'card unblocked');

  const comment = await call('forum_card_comment', {
    card_id: cardId,
    body: 'a comment over the bridge',
  });
  assert.equal(comment.comment.body, 'a comment over the bridge');
  const comments = await call('forum_card_comments', { card_id: cardId });
  assert.ok(
    comments.comments.some((c: any) => c.id === comment.comment.id),
    'card comment is listed',
  );

  const doomed = await call('forum_card_create', {
    board: 'agora',
    title: 'delete me',
    column: 'inbox',
  });
  const deletedCard = await call('forum_card_delete', { card_id: doomed.card.id, confirm: true });
  assert.equal(deletedCard.ok, true, 'card deleted');

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
  assert.ok(inbox.counts.mentions >= 1, 'mention is unread and counted');
  assert.ok(
    inbox.mentions.every((m: any) => m.read_at === null),
    'inbox hides read mentions by default',
  );
  const inboxHistory = await call('forum_inbox', { unread: false });
  assert.ok(
    inboxHistory.mentions.length >= inbox.mentions.length,
    'unread:false returns the mention history',
  );

  // reading the delegate thread clears the badge (forum_read marks mentions read)
  await call('forum_read', { thread_id: delegated.mention.thread.id });
  const afterRead = await call('forum_inbox');
  assert.equal(afterRead.counts.mentions, 0, 'reading the thread clears the unread count');
  assert.equal(afterRead.mentions.length, 0, 'read mentions leave the default inbox view');
  assert.equal(
    afterRead.counts.mentions_total,
    inbox.counts.mentions_total,
    'the mention still exists, just read',
  );

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

  const scratch = await call('forum_columns', {
    board: newBoardId,
    action: 'add',
    name: 'scratch',
  });
  const removedColumn = await call('forum_columns', {
    board: newBoardId,
    action: 'remove',
    column_id: scratch.column.id,
  });
  assert.equal(removedColumn.ok, true, 'column removed');

  const deletedBoard = await call('forum_board_delete', { board: newBoardId, confirm: true });
  assert.equal(deletedBoard.ok, true, 'board + project deleted');

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
