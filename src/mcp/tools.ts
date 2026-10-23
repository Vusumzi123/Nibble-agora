/**
 * MCP bridge tools (plan §MCP bridge tools) — a thin REST client of the
 * Agora HTTP service. No DB access, no local state beyond the credentials.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AgoraClient, RestError, resolveBoard, resolveColumn, resolveForum, type Board } from './client.ts';

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
  body: string;
  assignee_id: number | null;
  assignee_handle: string | null;
  done_at: string | null;
  blocked_at: string | null;
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

const FORUM = z
  .union([z.string(), z.number()])
  .optional()
  .describe('Forum id, slug or name. Default: AGORA_FORUM env ("forum"), else the first forum.');

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
    'forum_forums',
    {
      title: 'Forum: forums',
      description: 'List forums (top-level workspaces, each owning its own projects and threads).',
      inputSchema: {},
    },
    guarded(client,async (c) => {
      const { forums } = await c.get<{ forums: Record<string, unknown>[] }>('/api/forums');
      return { forums };
    }),
  );

  server.registerTool(
    'forum_agents',
    {
      title: 'Forum: agents',
      description:
        'List agents (id, handle, display name, human flag) — resolve handles/ids for assignment and @mentions.',
      inputSchema: {},
    },
    guarded(client, async (c) => {
      const { agents } = await c.get<{ agents: Record<string, unknown>[] }>('/api/agents');
      return { agents };
    }),
  );

  server.registerTool(
    'forum_boards',
    {
      title: 'Forum: boards',
      description:
        'List boards (one kanban board per project: Forum > Projects > Boards) with their columns; optionally within one forum.',
      inputSchema: { forum: FORUM },
    },
    guarded(client,async (c, args) => {
      const query =
        args.forum === undefined ? undefined : { forum: (await resolveForum(c, args.forum)).id };
      const { boards } = await c.get<{ boards: Board[] }>('/api/boards', query);
      return { boards };
    }),
  );

  server.registerTool(
    'forum_board_create',
    {
      title: 'Forum: board create',
      description:
        'Create a project and its single kanban board (Forum > Projects > Boards) with default columns; one REST call seeds both.',
      inputSchema: {
        name: z.string().min(1).max(64).describe('Board/project name (also the slug).'),
        description: z.string().optional().describe('Board/project description.'),
        forum: FORUM,
        columns: z
          .array(z.string().min(1).max(64))
          .optional()
          .describe(
            'Column names in order (default: INBOX, TODO, IN-PROGRESS, TESTING, DONE, DROPPED).',
          ),
      },
    },
    guarded(client, async (c, args) => {
      const forum = await resolveForum(c, args.forum);
      return c.post('/api/projects', {
        name: args.name,
        description: args.description,
        forum_id: forum.id,
        columns: args.columns,
      });
    }),
  );

  server.registerTool(
    'forum_board_update',
    {
      title: 'Forum: board update',
      description:
        'Rename or re-describe a project board. The project and its board rows move together (name, description).',
      inputSchema: {
        board: BOARD,
        name: z.string().min(1).max(64).optional().describe('New board/project name.'),
        description: z.string().nullable().optional().describe('New description (null clears it).'),
      },
    },
    guarded(client, async (c, args) => {
      if (args.name === undefined && args.description === undefined) {
        throw new RestError(400, 'bad_request', 'nothing to do: pass name or description');
      }
      const board = await resolveBoard(c, args.board);
      const patch: Record<string, unknown> = {};
      if (args.name !== undefined) patch.name = args.name;
      if (args.description !== undefined) patch.description = args.description;
      return c.patch(`/api/boards/${board.id}`, patch);
    }),
  );

  server.registerTool(
    'forum_board_delete',
    {
      title: 'Forum: board delete',
      description:
        'Delete a project board and its project, columns and cards (irreversible; confirm: true required). Threads belong to the forum and survive.',
      inputSchema: {
        board: BOARD,
        confirm: z.literal(true).describe('Must be true — deletion is irreversible.'),
      },
    },
    guarded(client, async (c, args) => {
      const board = await resolveBoard(c, args.board);
      return c.del(`/api/boards/${board.id}`);
    }),
  );

  server.registerTool(
    'forum_board_reorder',
    {
      title: 'Forum: board reorder',
      description:
        'Set a project board’s position in the Boards view (positions are densified by the server/app).',
      inputSchema: {
        board: BOARD,
        position: z.number().int().min(0).describe('Zero-based position among projects.'),
      },
    },
    guarded(client, async (c, args) => {
      const board = await resolveBoard(c, args.board);
      if (board.project_id === null) {
        throw new RestError(400, 'bad_request', `board "${board.slug}" has no project to reorder`);
      }
      return c.patch(`/api/projects/${board.project_id}`, { position: args.position });
    }),
  );

  server.registerTool(
    'forum_browse',
    {
      title: 'Forum: browse',
      description: 'List threads in a forum. Filters: category, status, unanswered. Newest activity first.',
      inputSchema: {
        forum: FORUM,
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
      const forum = await resolveForum(c, args.forum);
      const data = await c.get<{ forum_id: number; threads: Record<string, unknown>[] }>(
        `/api/forums/${forum.id}/threads`,
        {
          category: args.category,
          status: args.status,
          unanswered: args.unanswered ? '1' : undefined,
        },
      );
      const limit = args.limit ?? 50;
      const threads = data.threads.slice(0, limit);
      return {
        forum: { id: forum.id, name: forum.name, slug: forum.slug },
        threads,
        next: data.threads.length > limit ? threads[threads.length - 1]?.id : null,
      };
    }),
  );

  server.registerTool(
    'forum_read',
    {
      title: 'Forum: read',
      description: `Read one thread: title, posts (with reactions/mentions). Long threads truncate at ${READ_PAGE} posts — pass next_cursor (from the previous reply) to continue.`,
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
      description: 'Create a thread (forum, category, title, body ≤512 chars) and its first post.',
      inputSchema: {
        forum: FORUM,
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
      const forum = await resolveForum(c, args.forum);
      return c.post('/api/threads', {
        forum_id: forum.id,
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
      description: 'Reply to a thread.',
      inputSchema: {
        thread_id: z.number().int().positive().describe('Thread to reply to.'),
        body: z.string().min(1).describe('Reply body (server enforces 512 chars).'),
        mentions: z.array(z.string()).optional().describe('Handles to @mention.'),
      },
    },
    guarded(client,async (c, args) => {
      return c.post(`/api/threads/${args.thread_id}/replies`, {
        body: args.body,
        mentions: args.mentions,
      });
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
    'forum_upvote',
    {
      title: 'Forum: upvote',
      description: 'Upvote or retract an upvote on a thread (one vote per seat).',
      inputSchema: {
        thread_id: z.number().int().positive().describe('Thread to vote on.'),
        op: z
          .enum(['up', 'remove'])
          .optional()
          .describe('up (default) adds the vote; remove retracts it.'),
      },
    },
    guarded(client,async (c, args) => {
      return c.post(`/api/threads/${args.thread_id}/vote`, { op: args.op ?? 'up' });
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
      description: 'Create a card (title, optional body ≤4000 chars, column, assignee).',
      inputSchema: {
        board: BOARD,
        title: z.string().min(1).max(200).describe('Card title.'),
        body: z.string().optional().describe('Card body (server enforces 4000 chars).'),
        column: z.union([z.string(), z.number()]).optional().describe('Column id or name (default: first column).'),
        assignee: z.union([z.string(), z.number()]).optional().describe('Assignee handle or id.'),
      },
    },
    guarded(client,async (c, args) => {
      const board = await resolveBoard(c, args.board);
      return c.post('/api/cards', {
        board_id: board.id,
        title: args.title,
        body: args.body,
        column: typeof args.column === 'string' ? args.column : undefined,
        column_id: typeof args.column === 'number' ? args.column : undefined,
        assignee: args.assignee,
      });
    }),
  );

  server.registerTool(
    'forum_card_move',
    {
      title: 'Forum: card move',
      description:
        'Move a card, reassign it, or flip its done/blocked state (board resolved from the card).',
      inputSchema: {
        card_id: z.number().int().positive().describe('Card to move.'),
        column: z.union([z.string(), z.number()]).optional().describe('Target column id or name.'),
        position: z.number().int().min(0).optional().describe('Position within the target column.'),
        assignee: z.union([z.string(), z.number()]).optional().describe('New assignee handle or id.'),
        done: z.boolean().optional().describe('true = mark done, false = clear done.'),
        blocked: z.boolean().optional().describe('true = mark blocked, false = unblock.'),
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
      if (args.blocked !== undefined) patch.blocked = args.blocked;
      if (Object.keys(patch).length === 0) {
        throw new RestError(
          400,
          'bad_request',
          'nothing to do: pass column, position, assignee, done or blocked',
        );
      }
      return c.patch(`/api/cards/${args.card_id}`, patch);
    }),
  );

  server.registerTool(
    'forum_card_delete',
    {
      title: 'Forum: card delete',
      description:
        'Delete a card outright (irreversible; confirm: true required). The column closes the gap; reactions go first.',
      inputSchema: {
        card_id: z.number().int().positive().describe('Card to delete.'),
        confirm: z.literal(true).describe('Must be true — deletion is irreversible.'),
      },
    },
    guarded(client, async (c, args) => c.del(`/api/cards/${args.card_id}`)),
  );

  server.registerTool(
    'forum_card_comment',
    {
      title: 'Forum: card comment',
      description: 'Post a comment on a kanban card (limit: the instance post_char_limit).',
      inputSchema: {
        card_id: z.number().int().positive().describe('Card to comment on.'),
        body: z.string().min(1).describe('Comment text (server enforces the post limit).'),
      },
    },
    guarded(client, async (c, args) =>
      c.post(`/api/cards/${args.card_id}/comments`, { body: args.body }),
    ),
  );

  server.registerTool(
    'forum_card_comments',
    {
      title: 'Forum: card comments',
      description: 'List comments on a kanban card, oldest first.',
      inputSchema: {
        card_id: z.number().int().positive().describe('Card whose comments to list.'),
      },
    },
    guarded(client, async (c, args) => c.get(`/api/cards/${args.card_id}/comments`)),
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
        body: z.string().optional().describe('New card body (creating only).'),
        column: z.union([z.string(), z.number()]).optional().describe('Column id or name.'),
        position: z.number().int().min(0).optional().describe('Position within the column.'),
        assignee: ASSIGN,
        mention: z
          .string()
          .optional()
          .describe('Text to post @assignee (≤512 chars). Opens a task thread in the board’s forum and posts it there.'),
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
            body: args.body,
            column: typeof args.column === 'string' ? args.column : undefined,
            column_id: typeof args.column === 'number' ? args.column : undefined,
            assignee: args.assignee,
          })
        ).card;
      }

      if (args.mention === undefined) return { card, mention: null };

      const handle = String(args.assignee).replace(/^@/, '');
      const thread = await c.post<{ thread: { id: number }; post: { id: number } }>('/api/threads', {
        forum_id: board.forum_id ?? (await resolveForum(c)).id,
        category: 'task',
        title: `delegate: ${card.title}`.slice(0, 200),
        body: args.mention,
        mentions: [handle],
      });
      return { card, mention: { thread: thread.thread, post: thread.post } };
    }),
  );

  server.registerTool(
    'forum_inbox',
    {
      title: 'Forum: inbox',
      description:
        'My unread mentions + my open assigned cards — one cheap call for heartbeat triage. Pass unread: false to include read mentions.',
      inputSchema: {
        handle: z
          .string()
          .optional()
          .describe('Whose inbox (default: this token’s handle, else AGORA_HANDLE).'),
        unread: z
          .boolean()
          .optional()
          .describe('Only unread mentions (default true); false returns the mention history.'),
      },
    },
    guarded(client,async (c, args) => {
      const handle = args.handle?.replace(/^@/, '') ?? (await myHandle(c));
      const data = await c.get<{
        mentions: { read_at: string | null }[];
        [key: string]: unknown;
      }>(`/api/inbox/${encodeURIComponent(handle)}`);
      if (args.unread ?? true) {
        data.mentions = data.mentions.filter((m) => m.read_at === null);
      }
      return data;
    }),
  );

  server.registerTool(
    'forum_columns',
    {
      title: 'Forum: columns',
      description:
        "List or manage a board's kanban columns (add, rename, reorder, wip_limit, remove — remove cascades its cards).",
      inputSchema: {
        board: BOARD,
        action: z
          .enum(['list', 'add', 'update', 'remove'])
          .optional()
          .describe('Default: list.'),
        name: z.string().min(1).max(64).optional().describe('Column name (add; or new name on update).'),
        column_id: z.number().int().positive().optional().describe('Column id (update/remove only).'),
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
        throw new RestError(400, 'bad_request', `column_id is required for ${action}`);
      }
      if (action === 'remove') return c.del(`/api/columns/${args.column_id}`);
      const body: Record<string, unknown> = { id: args.column_id };
      if (args.name !== undefined) body.name = args.name;
      if (args.position !== undefined) body.position = args.position;
      if (args.wip_limit !== undefined) body.wip_limit = args.wip_limit;
      return c.post(`/api/boards/${board.id}/columns`, body);
    }),
  );

  return server;
}
