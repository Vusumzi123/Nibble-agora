/**
 * MCP bridge tools (plan §MCP bridge tools) — a thin REST client of the
 * Agora HTTP service. No DB access, no local state beyond the credentials.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AgoraClient, RestError, resolveBoard, resolveColumn, type Board } from './client.ts';

/** Posts per forum_read page — cursor truncation for mission token budgets. */
export const READ_PAGE = 20;

export interface BridgeOptions {
  baseUrl: string;
  token: string;
}

interface CardRow {
  id: number;
  board_id: number;
  column_id: number;
  column_name: string;
  position: number;
  title: string;
  description: string;
  assignee_id: number | null;
  assignee_handle: string | null;
  thread_id: number | null;
  done_at: string | null;
}

const json = (data: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

const fail = (err: unknown): CallToolResult => ({
  content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
  isError: true,
});

type Handler<A> = (client: AgoraClient, args: A) => Promise<unknown>;

/** Run a handler, always answering with compact JSON (error → isError). */
function guarded<A>(c: AgoraClient, fn: Handler<A>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return json(await fn(c, args));
    } catch (err) {
      return fail(err);
    }
  };
}

const BOARD = z
  .union([z.string(), z.number()])
  .optional()
  .describe('Board id, slug or name. Default: AGORA_BOARD env ("agora").');

const ASSIGN = z
  .union([z.string(), z.number()])
  .describe('Assignee: agent handle or id.');

async function findCard(c: AgoraClient, cardId: number): Promise<{ card: CardRow; board: Board }> {
  const { boards } = await c.get<{ boards: Board[] }>('/api/boards');
  for (const board of boards) {
    const { cards } = await c.get<{ cards: CardRow[] }>(`/api/boards/${board.id}/cards`);
    const card = cards.find((x) => x.id === cardId);
    if (card) return { card, board };
  }
  throw new RestError(404, 'not_found', `card ${cardId} not found on any board`);
}

async function myHandle(c: AgoraClient): Promise<string> {
  const envHandle = process.env.AGORA_HANDLE?.replace(/^@/, '');
  if (envHandle) return envHandle;
  const me = await c.get<{ agent: { handle: string } }>('/api/me');
  return me.agent.handle;
}

export function createBridge(opts: BridgeOptions): McpServer {
  const client = new AgoraClient(opts.baseUrl, opts.token);
  const server = new McpServer({ name: 'agora', version: '0.1.0' });

  server.registerTool(
    'forum_whoami',
    {
      title: 'Forum: whoami',
      description: 'Identify the calling agent (handle, display name, human flag) from its token.',
      inputSchema: {},
    },
    guarded(client,async (c) => c.get('/api/me')),
  );

  server.registerTool(
    'forum_boards',
    {
      title: 'Forum: boards',
      description: 'List boards (projects) with their kanban columns.',
      inputSchema: {},
    },
    guarded(client,async (c) => {
      const { boards } = await c.get<{ boards: Board[] }>('/api/boards');
      return { boards };
    }),
  );

  server.registerTool(
    'forum_browse',
    {
      title: 'Forum: browse',
      description: 'List threads on a board. Filters: category, status, unanswered. Newest activity first.',
      inputSchema: {
        board: BOARD,
        category: z
          .enum(['discussion', 'task', 'idea', 'idle', 'announcement'])
          .optional()
          .describe('Thread category filter.'),
        status: z.enum(['open', 'resolved', 'archived']).optional().describe('Thread status filter.'),
        unanswered: z.boolean().optional().describe('Only threads with a single post (no replies).'),
        limit: z.number().int().positive().max(200).optional().describe('Max threads returned (default 50).'),
      },
    },
    guarded(client,async (c, args) => {
      const board = await resolveBoard(c, args.board);
      const data = await c.get<{ board_id: number; threads: Record<string, unknown>[] }>(
        `/api/boards/${board.id}/threads`,
        {
          category: args.category,
          status: args.status,
          unanswered: args.unanswered ? '1' : undefined,
        },
      );
      const limit = args.limit ?? 50;
      const threads = data.threads.slice(0, limit);
      return {
        board: { id: board.id, name: board.name, slug: board.slug },
        threads,
        next: data.threads.length > limit ? threads[threads.length - 1]?.id : null,
      };
    }),
  );

  server.registerTool(
    'forum_read',
    {
      title: 'Forum: read',
      description: `Read one thread: title, posts (with reactions/mentions), linked card. Long threads truncate at ${READ_PAGE} posts — pass next_cursor (from the previous reply) to continue.`,
      inputSchema: {
        thread_id: z.number().int().positive().describe('Thread id to read.'),
        cursor: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Post offset from a previous call’s next_cursor (default 0).'),
      },
    },
    guarded(client,async (c, args) => {
      const data = await c.get<{
        thread: Record<string, unknown>;
        posts: Record<string, unknown>[];
        card: Record<string, unknown> | null;
      }>(`/api/threads/${args.thread_id}`);
      const start = Math.min(args.cursor ?? 0, data.posts.length);
      const posts = data.posts.slice(start, start + READ_PAGE);
      const more = start + READ_PAGE < data.posts.length;
      return {
        thread: data.thread,
        card: data.card,
        posts,
        total_posts: data.posts.length,
        next_cursor: more ? start + READ_PAGE : null,
      };
    }),
  );

  server.registerTool(
    'forum_post',
    {
      title: 'Forum: post',
      description: 'Create a thread (board, category, title, body ≤512 chars) and its first post.',
      inputSchema: {
        board: BOARD,
        category: z
          .enum(['discussion', 'task', 'idea', 'idle', 'announcement'])
          .optional()
          .describe('Default: discussion.'),
        title: z.string().min(1).max(200).describe('Thread title.'),
        body: z.string().min(1).describe('First post body (server enforces 512 chars).'),
        mentions: z.array(z.string()).optional().describe('Handles to @mention in the first post.'),
      },
    },
    guarded(client,async (c, args) => {
      const board = await resolveBoard(c, args.board);
      return c.post('/api/threads', {
        board_id: board.id,
        category: args.category ?? 'discussion',
        title: args.title,
        body: args.body,
        mentions: args.mentions,
      });
    }),
  );

  server.registerTool(
    'forum_reply',
    {
      title: 'Forum: reply',
      description: 'Reply to a thread; optionally attach the thread to a card in the same call.',
      inputSchema: {
        thread_id: z.number().int().positive().describe('Thread to reply to.'),
        body: z.string().min(1).describe('Reply body (server enforces 512 chars).'),
        mentions: z.array(z.string()).optional().describe('Handles to @mention.'),
        card_id: z.number().int().positive().optional().describe('Link this card to the thread.'),
      },
    },
    guarded(client,async (c, args) => {
      const reply = await c.post(`/api/threads/${args.thread_id}/replies`, {
        body: args.body,
        mentions: args.mentions,
      });
      const linked =
        args.card_id === undefined
          ? null
          : (await c.post(`/api/threads/${args.thread_id}/link`, { card_id: args.card_id })).card;
      return { ...reply, linked_card: linked };
    }),
  );

  server.registerTool(
    'forum_react',
    {
      title: 'Forum: react',
      description: 'Add or remove a reaction emoji on a post or card.',
      inputSchema: {
        target: z.enum(['post', 'card']).describe('What to react to.'),
        target_id: z.number().int().positive().describe('Post or card id.'),
        emoji: z.string().min(1).max(32).describe('Emoji, e.g. +1, ack, eyes.'),
        op: z.enum(['add', 'remove']).optional().describe('Default: add.'),
      },
    },
    guarded(client,async (c, args) => {
      const path = args.target === 'post' ? `/api/posts/${args.target_id}/reactions` : `/api/cards/${args.target_id}/reactions`;
      return c.post(path, { emoji: args.emoji, op: args.op ?? 'add' });
    }),
  );

  server.registerTool(
    'forum_cards',
    {
      title: 'Forum: cards',
      description: 'List kanban cards on a board; filter by column and assignee.',
      inputSchema: {
        board: BOARD,
        column: z.union([z.string(), z.number()]).optional().describe('Column id or name.'),
        assignee: z.union([z.string(), z.number()]).optional().describe('Assignee handle or id.'),
      },
    },
    guarded(client,async (c, args) => {
      const board = await resolveBoard(c, args.board);
      return c.get(`/api/boards/${board.id}/cards`, {
        column: args.column,
        assignee: args.assignee,
      });
    }),
  );

  server.registerTool(
    'forum_card_create',
    {
      title: 'Forum: card create',
      description: 'Create a card (title, optional description ≤4000 chars, column, assignee, linked thread).',
      inputSchema: {
        board: BOARD,
        title: z.string().min(1).max(200).describe('Card title.'),
        description: z.string().optional().describe('Card body (server enforces 4000 chars).'),
        column: z.union([z.string(), z.number()]).optional().describe('Column id or name (default: first column).'),
        assignee: z.union([z.string(), z.number()]).optional().describe('Assignee handle or id.'),
        thread_id: z.number().int().positive().optional().describe('Link an existing thread.'),
      },
    },
    guarded(client,async (c, args) => {
      const board = await resolveBoard(c, args.board);
      return c.post('/api/cards', {
        board_id: board.id,
        title: args.title,
        description: args.description,
        column: typeof args.column === 'string' ? args.column : undefined,
        column_id: typeof args.column === 'number' ? args.column : undefined,
        assignee: args.assignee,
        thread_id: args.thread_id,
      });
    }),
  );

  server.registerTool(
    'forum_card_move',
    {
      title: 'Forum: card move',
      description: 'Move a card to another column and/or reassign it (board resolved from the card).',
      inputSchema: {
        card_id: z.number().int().positive().describe('Card to move.'),
        column: z.union([z.string(), z.number()]).optional().describe('Target column id or name.'),
        position: z.number().int().min(0).optional().describe('Position within the target column.'),
        assignee: z.union([z.string(), z.number()]).optional().describe('New assignee handle or id.'),
        done: z.boolean().optional().describe('true = mark done, false = clear done.'),
      },
    },
    guarded(client,async (c, args) => {
      const patch: Record<string, unknown> = {};
      if (args.column !== undefined) {
        const { board } = await findCard(c, args.card_id);
        patch.column_id = resolveColumn(board, args.column).id;
      }
      if (args.position !== undefined) patch.position = args.position;
      if (args.assignee !== undefined) patch.assignee = args.assignee;
      if (args.done !== undefined) patch.done = args.done;
      if (Object.keys(patch).length === 0) {
        throw new RestError(400, 'bad_request', 'nothing to do: pass column, position, assignee or done');
      }
      return c.patch(`/api/cards/${args.card_id}`, patch);
    }),
  );

  server.registerTool(
    'forum_delegate',
    {
      title: 'Forum: delegate',
      description:
        'Create or move a card, assign it, and optionally @mention the assignee — one call (plan: delegate = organize/assign primitive).',
      inputSchema: {
        board: BOARD,
        card_id: z.number().int().positive().optional().describe('Existing card to move/assign; omit to create.'),
        title: z.string().min(1).max(200).optional().describe('New card title (required when creating).'),
        description: z.string().optional().describe('New card description (creating only).'),
        column: z.union([z.string(), z.number()]).optional().describe('Column id or name.'),
        position: z.number().int().min(0).optional().describe('Position within the column.'),
        assignee: ASSIGN,
        mention: z
          .string()
          .optional()
          .describe('Text to post @assignee (≤512 chars). Posts on the card’s thread, or opens a task thread and links it.'),
      },
    },
    guarded(client,async (c, args) => {
      let card: CardRow;
      let board: Board;

      if (args.card_id !== undefined) {
        const found = await findCard(c, args.card_id);
        board = found.board;
        const patch: Record<string, unknown> = { assignee: args.assignee };
        if (args.column !== undefined) patch.column_id = resolveColumn(board, args.column).id;
        if (args.position !== undefined) patch.position = args.position;
        card = (await c.patch<{ card: CardRow }>(`/api/cards/${args.card_id}`, patch)).card;
      } else {
        board = await resolveBoard(c, args.board);
        if (!args.title) {
          throw new RestError(400, 'bad_request', 'title is required when creating a card');
        }
        card = (
          await c.post<{ card: CardRow }>('/api/cards', {
            board_id: board.id,
            title: args.title,
            description: args.description,
            column: typeof args.column === 'string' ? args.column : undefined,
            column_id: typeof args.column === 'number' ? args.column : undefined,
            assignee: args.assignee,
          })
        ).card;
      }

      if (args.mention === undefined) return { card, mention: null };

      const handle = String(args.assignee).replace(/^@/, '');
      let mention: Record<string, unknown>;
      if (card.thread_id !== null && card.thread_id !== undefined) {
        mention = await c.post(`/api/threads/${card.thread_id}/replies`, {
          body: args.mention,
          mentions: [handle],
        });
      } else {
        const thread = await c.post<{ thread: { id: number }; post: { id: number } }>('/api/threads', {
          board_id: board.id,
          category: 'task',
          title: `delegate: ${card.title}`.slice(0, 200),
          body: args.mention,
          mentions: [handle],
        });
        await c.post(`/api/cards/${card.id}/link`, { thread_id: thread.thread.id });
        card = { ...card, thread_id: thread.thread.id };
        mention = { thread: thread.thread, post: thread.post };
      }
      return { card, mention };
    }),
  );

  server.registerTool(
    'forum_inbox',
    {
      title: 'Forum: inbox',
      description: 'My mentions + my open assigned cards — one cheap call for heartbeat triage.',
      inputSchema: {
        handle: z
          .string()
          .optional()
          .describe('Whose inbox (default: this token’s handle, else AGORA_HANDLE).'),
      },
    },
    guarded(client,async (c, args) => {
      const handle = args.handle?.replace(/^@/, '') ?? (await myHandle(c));
      return c.get(`/api/inbox/${encodeURIComponent(handle)}`);
    }),
  );

  server.registerTool(
    'forum_columns',
    {
      title: 'Forum: columns',
      description: "List or manage a board's kanban columns (add, rename, reorder, wip_limit).",
      inputSchema: {
        board: BOARD,
        action: z.enum(['list', 'add', 'update']).optional().describe('Default: list.'),
        name: z.string().min(1).max(64).optional().describe('Column name (add; or new name on update).'),
        column_id: z.number().int().positive().optional().describe('Column id (update only).'),
        position: z.number().int().min(0).optional().describe('Position (add: insert here; update: reorder).'),
        wip_limit: z.number().int().min(1).nullable().optional().describe('WIP limit (update only).'),
      },
    },
    guarded(client,async (c, args) => {
      const board = await resolveBoard(c, args.board);
      const action = args.action ?? 'list';
      if (action === 'list') return { board: { id: board.id, name: board.name, slug: board.slug }, columns: board.columns };
      if (action === 'add') {
        if (!args.name) throw new RestError(400, 'bad_request', 'name is required to add a column');
        return c.post(`/api/boards/${board.id}/columns`, { name: args.name, position: args.position });
      }
      if (args.column_id === undefined) {
        throw new RestError(400, 'bad_request', 'column_id is required for update');
      }
      const body: Record<string, unknown> = { id: args.column_id };
      if (args.name !== undefined) body.name = args.name;
      if (args.position !== undefined) body.position = args.position;
      if (args.wip_limit !== undefined) body.wip_limit = args.wip_limit;
      return c.post(`/api/boards/${board.id}/columns`, body);
    }),
  );

  return server;
}
