import type { Config } from '../config.ts';
import { isTheme } from '../config.ts';
import type { Db } from '../db/sqlite.ts';
import {
  DEFAULT_COLUMNS,
  getSetting,
  hashPassword,
  hashToken,
  isConfigured,
  logEvent,
  newToken,
  setSetting,
  verifyPassword,
  type Agent,
  type Board,
  type Card,
  type Column,
  type Post,
  type Thread,
} from '../db/index.ts';
import {
  ApiError,
  badRequest,
  charLimit,
  conflict,
  notFound,
  requireInt,
  requireString,
  unauthorized,
} from './http.ts';

export interface Ctx {
  db: Db;
  cfg: Config;
}

export interface Result {
  status: number;
  body: unknown;
}

type Body = Record<string, unknown>;

type Handler = (
  ctx: Ctx,
  m: RegExpExecArray,
  body: Body,
  agent: Agent,
  query: URLSearchParams,
) => Result;

export interface Route {
  method: string;
  re: RegExp;
  /** false = unauthenticated (registration only) */
  auth: boolean;
  h: Handler;
}

const now = (): string => new Date().toISOString();

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'board';

/** Identity shape that never carries credentials (token or password hashes). */
function publicAgent(agent: Agent): Omit<Agent, 'token_hash' | 'password_hash'> {
  const { token_hash: _token, password_hash: _password, ...identity } = agent;
  return identity;
}

function limitsOf(cfg: Config): { post_char_limit: number; card_desc_char_limit: number } {
  return {
    post_char_limit: cfg.postCharLimit,
    card_desc_char_limit: cfg.cardDescCharLimit,
  };
}

function normalizeHandle(raw: unknown, field = 'handle'): string {
  const handle = String(requireString(raw, field, 64)).trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(handle)) {
    throw badRequest('handle must start with a letter or digit and contain only a-z 0-9 . _ -', {
      field,
      value: handle,
    });
  }
  return handle;
}

/** Public instance configuration — never leaks credentials. */
function configOf(ctx: Ctx): { configured: boolean; forum_name: string; theme: string } {
  return {
    configured: isConfigured(ctx.db),
    forum_name: getSetting(ctx.db, 'forum_name') ?? ctx.cfg.defaultBoardName,
    theme: getSetting(ctx.db, 'theme') ?? ctx.cfg.defaultTheme,
  };
}

// ---------------------------------------------------------------------------
// lookups
// ---------------------------------------------------------------------------

function boardById(ctx: Ctx, id: number): Board {
  const row = ctx.db.get<Board>('SELECT * FROM boards WHERE id = ?', id);
  if (!row) throw notFound(`board ${id} does not exist`, { board_id: id });
  return row;
}

function threadById(ctx: Ctx, id: number): Thread {
  const row = ctx.db.get<Thread>('SELECT * FROM threads WHERE id = ?', id);
  if (!row) throw notFound(`thread ${id} does not exist`, { thread_id: id });
  return row;
}

function cardById(ctx: Ctx, id: number): Card {
  const row = ctx.db.get<Card>('SELECT * FROM cards WHERE id = ?', id);
  if (!row) throw notFound(`card ${id} does not exist`, { card_id: id });
  return row;
}

function postById(ctx: Ctx, id: number): Post {
  const row = ctx.db.get<Post>('SELECT * FROM posts WHERE id = ?', id);
  if (!row) throw notFound(`post ${id} does not exist`, { post_id: id });
  return row;
}

function agentByRef(ctx: Ctx, ref: unknown, field = 'assignee'): Agent | undefined {
  if (ref === undefined || ref === null || ref === '') return undefined;
  const row =
    typeof ref === 'number'
      ? ctx.db.get<Agent>('SELECT * FROM agents WHERE id = ?', ref)
      : ctx.db.get<Agent>('SELECT * FROM agents WHERE handle = ?', String(ref));
  if (!row) throw notFound(`agent ${String(ref)} does not exist`, { field, value: ref });
  return row;
}

function columnById(ctx: Ctx, id: number): Column {
  const row = ctx.db.get<Column>('SELECT * FROM columns WHERE id = ?', id);
  if (!row) throw notFound(`column ${id} does not exist`, { column_id: id });
  return row;
}

function columnsOf(ctx: Ctx, boardId: number): Column[] {
  return ctx.db.all<Column>('SELECT * FROM columns WHERE board_id = ? ORDER BY position, id', boardId);
}

function nextColumnPosition(ctx: Ctx, boardId: number): number {
  const row = ctx.db.get<{ n: number | null }>(
    'SELECT MAX(position) AS n FROM columns WHERE board_id = ?',
    boardId,
  );
  return (row?.n ?? -1) + 1;
}

function nextCardPosition(ctx: Ctx, columnId: number): number {
  const row = ctx.db.get<{ n: number | null }>(
    'SELECT MAX(position) AS n FROM cards WHERE column_id = ?',
    columnId,
  );
  return (row?.n ?? -1) + 1;
}

/** Mentions are best-effort: unknown handles are reported, never fatal. */
function resolveMentions(ctx: Ctx, raw: unknown): { ids: number[]; unknown: string[] } {
  if (raw === undefined || raw === null) return { ids: [], unknown: [] };
  if (!Array.isArray(raw)) throw badRequest('mentions must be an array of handles', { field: 'mentions' });
  const ids: number[] = [];
  const unknown: string[] = [];
  for (const entry of raw) {
    const handle = String(entry).trim().replace(/^@/, '');
    if (!handle) continue;
    const row = ctx.db.get<Agent>('SELECT id FROM agents WHERE handle = ?', handle);
    if (row) {
      if (!ids.includes(row.id)) ids.push(row.id);
    } else {
      unknown.push(handle);
    }
  }
  return { ids, unknown };
}

function insertMentions(ctx: Ctx, postId: number, ids: number[]): number {
  for (const id of ids) {
    ctx.db.run('INSERT OR IGNORE INTO mentions (post_id, agent_id) VALUES (?, ?)', postId, id);
  }
  return ids.length;
}

// ---------------------------------------------------------------------------
// handlers — REST surface from plan §REST API
// ---------------------------------------------------------------------------

const handlers = {
  me(ctx: Ctx, _m: RegExpExecArray, _body: Body, agent: Agent): Result {
    // token → identity; the MCP bridge's forum_whoami is this route
    return {
      status: 200,
      body: {
        agent: publicAgent(agent),
        // the web UI reads its counters from here instead of hard-coding
        limits: limitsOf(ctx.cfg),
      },
    };
  },

  login(ctx: Ctx, _m: RegExpExecArray, body: Body): Result {
    // Human seats log in with handle + password; the response carries a freshly
    // rotated bearer token so the rest of the API stays token-based.
    const handle = String(body.handle ?? '').trim().replace(/^@/, '').toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!handle || !password) {
      throw badRequest('handle and password are required', { field: 'credentials' });
    }
    const agent = ctx.db.get<Agent>('SELECT * FROM agents WHERE handle = ?', handle);
    if (!agent || !verifyPassword(password, agent.password_hash)) {
      throw unauthorized('invalid handle or password');
    }
    const token = newToken();
    ctx.db.tx(() => {
      ctx.db.run('UPDATE agents SET token_hash = ? WHERE id = ?', hashToken(token), agent.id);
      logEvent(ctx.db, { actorId: agent.id, action: 'agent.login', target: `agent:${agent.id}` });
    });
    return {
      status: 200,
      body: { agent: publicAgent(agent), token, limits: limitsOf(ctx.cfg) },
    };
  },

  config(ctx: Ctx): Result {
    // public: lets the login/setup pages theme themselves before any session
    return { status: 200, body: configOf(ctx) };
  },

  setup(ctx: Ctx, _m: RegExpExecArray, body: Body): Result {
    // First-run: create the admin human + instance settings. Disabled forever
    // after the first admin exists.
    if (isConfigured(ctx.db)) {
      throw conflict('this instance is already set up', { field: 'setup' });
    }
    const handle = normalizeHandle(body.handle ?? ctx.cfg.rootHandle);
    const password = String(requireString(body.password, 'password', 200));
    if (password.length < 8) {
      throw badRequest('password must be at least 8 characters', { field: 'password' });
    }
    if (ctx.db.get('SELECT id FROM agents WHERE handle = ?', handle)) {
      throw conflict(`handle "${handle}" is already registered`, { field: 'handle', value: handle });
    }
    const forumName =
      typeof body.forum_name === 'string' && body.forum_name.trim()
        ? body.forum_name.trim().slice(0, 64)
        : ctx.cfg.defaultBoardName;
    const theme = isTheme(body.theme) ? body.theme : ctx.cfg.defaultTheme;
    const token = newToken();

    const agentId = ctx.db.tx(() => {
      const r = ctx.db.run(
        'INSERT INTO agents (handle, display_name, token_hash, password_hash, is_human, color, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
        handle,
        forumName,
        hashToken(token),
        hashPassword(password),
        '#6b7bd6',
        now(),
      );
      setSetting(ctx.db, 'forum_name', forumName);
      setSetting(ctx.db, 'theme', theme);
      logEvent(ctx.db, {
        actorId: r.lastInsertRowid,
        action: 'instance.setup',
        target: `agent:${r.lastInsertRowid}`,
        payload: { handle, forum_name: forumName, theme },
      });
      return r.lastInsertRowid;
    });

    const agent = ctx.db.get<Agent>('SELECT * FROM agents WHERE id = ?', agentId)!;
    return {
      status: 201,
      body: {
        agent: publicAgent(agent),
        token,
        limits: limitsOf(ctx.cfg),
        config: configOf(ctx),
      },
    };
  },

  patchSettings(ctx: Ctx, _m: RegExpExecArray, body: Body, agent: Agent): Result {
    if (body.forum_name !== undefined) {
      setSetting(ctx.db, 'forum_name', String(requireString(body.forum_name, 'forum_name', 64)).trim());
    }
    if (body.theme !== undefined) {
      if (!isTheme(body.theme)) {
        throw badRequest('unknown theme', { field: 'theme', value: body.theme });
      }
      setSetting(ctx.db, 'theme', body.theme);
    }
    logEvent(ctx.db, {
      actorId: agent.id,
      action: 'settings.update',
      target: 'settings',
      payload: { forum_name: body.forum_name, theme: body.theme },
    });
    return { status: 200, body: configOf(ctx) };
  },

  changePassword(ctx: Ctx, _m: RegExpExecArray, body: Body, agent: Agent): Result {
    if (agent.is_human !== 1) {
      throw badRequest('only human seats carry passwords', { field: 'agent' });
    }
    const current = typeof body.current_password === 'string' ? body.current_password : '';
    const next = typeof body.new_password === 'string' ? body.new_password : '';
    if (next.length < 8) {
      throw badRequest('new password must be at least 8 characters', { field: 'new_password' });
    }
    if (!verifyPassword(current, agent.password_hash)) {
      throw unauthorized('current password is incorrect');
    }
    ctx.db.tx(() => {
      ctx.db.run('UPDATE agents SET password_hash = ? WHERE id = ?', hashPassword(next), agent.id);
      logEvent(ctx.db, { actorId: agent.id, action: 'agent.password_change', target: `agent:${agent.id}` });
    });
    return { status: 200, body: { ok: true } };
  },

  listAgents(ctx: Ctx): Result {
    // assignee picker + @mention autocomplete — token_hash is never selected
    const agents = ctx.db.all<Pick<Agent, 'id' | 'handle' | 'display_name' | 'is_human' | 'color' | 'created_at'>>(
      'SELECT id, handle, display_name, is_human, color, created_at FROM agents ORDER BY is_human DESC, handle',
    );
    return { status: 200, body: { agents } };
  },

  register(ctx: Ctx, _m: RegExpExecArray, body: Body): Result {
    const handle = normalizeHandle(body.handle);
    if (ctx.db.get('SELECT id FROM agents WHERE handle = ?', handle)) {
      throw conflict(`handle "${handle}" is already registered`, { field: 'handle', value: handle });
    }
    const displayName = String(body.display_name ?? handle).trim() || handle;
    const isHuman = body.is_human === true || body.is_human === 1 || body.is_human === 'true' ? 1 : 0;
    const color = typeof body.color === 'string' ? body.color.slice(0, 32) : null;
    let passwordHash: string | null = null;
    if (typeof body.password === 'string' && body.password.length > 0) {
      if (body.password.length < 8) {
        throw badRequest('password must be at least 8 characters', { field: 'password' });
      }
      passwordHash = hashPassword(body.password);
    }
    const token = newToken();

    const agentId = ctx.db.tx(() => {
      const r = ctx.db.run(
        'INSERT INTO agents (handle, display_name, token_hash, password_hash, is_human, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        handle,
        displayName,
        hashToken(token),
        passwordHash,
        isHuman,
        color,
        now(),
      );
      logEvent(ctx.db, {
        actorId: r.lastInsertRowid,
        action: 'agent.register',
        target: `agent:${r.lastInsertRowid}`,
        payload: { handle, is_human: isHuman },
      });
      return r.lastInsertRowid;
    });

    const row = ctx.db.get<Agent>('SELECT * FROM agents WHERE id = ?', agentId)!;
    return {
      status: 201,
      // token is shown exactly once — only its hash is persisted
      body: { ...publicAgent(row), token },
    };
  },

  listBoards(ctx: Ctx, _m: RegExpExecArray, _body: Body, _agent: Agent): Result {
    const boards = ctx.db.all<Board>('SELECT * FROM boards ORDER BY id').map((b) => ({
      ...b,
      columns: columnsOf(ctx, b.id),
    }));
    return { status: 200, body: { boards } };
  },

  createBoard(ctx: Ctx, _m: RegExpExecArray, body: Body, agent: Agent): Result {
    const name = String(requireString(body.name, 'name', 64)).trim();
    const slug = slugify(String(body.slug ?? name));
    const description = typeof body.description === 'string' ? body.description : null;
    if (ctx.db.get('SELECT id FROM boards WHERE name = ? OR slug = ?', name, slug)) {
      throw conflict(`board "${name}" already exists`, { field: 'name', value: name });
    }
    let columnNames: string[] = [...DEFAULT_COLUMNS];
    if (Array.isArray(body.columns) && body.columns.length > 0) {
      columnNames = body.columns.map((c) => String(c).trim()).filter(Boolean);
    }
    if (columnNames.length === 0) {
      throw badRequest('columns must contain at least one name', { field: 'columns' });
    }

    const boardId = ctx.db.tx(() => {
      const r = ctx.db.run(
        'INSERT INTO boards (name, slug, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
        name,
        slug,
        description,
        agent.id,
        now(),
      );
      columnNames.forEach((col, i) => {
        ctx.db.run(
          'INSERT INTO columns (board_id, name, position, wip_limit) VALUES (?, ?, ?, NULL)',
          r.lastInsertRowid,
          col,
          i,
        );
      });
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'board.create',
        target: `board:${r.lastInsertRowid}`,
        payload: { name, slug, columns: columnNames },
      });
      return r.lastInsertRowid;
    });

    return {
      status: 201,
      body: {
        board: ctx.db.get<Board>('SELECT * FROM boards WHERE id = ?', boardId),
        columns: columnsOf(ctx, boardId),
      },
    };
  },

  manageColumns(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const board = boardById(ctx, requireInt(m[1], 'board_id'));

    // { id, ...fields } → rename / reorder / set wip_limit; otherwise create.
    if (body.id !== undefined) {
      const col = columnById(ctx, requireInt(body.id, 'id'));
      if (col.board_id !== board.id) {
        throw notFound(`column ${col.id} does not belong to board ${board.id}`, { column_id: col.id });
      }
      const name = body.name === undefined ? col.name : String(requireString(body.name, 'name', 64)).trim();
      const position =
        body.position === undefined ? col.position : requireInt(body.position, 'position');
      const wip =
        body.wip_limit === undefined
          ? col.wip_limit
          : body.wip_limit === null
            ? null
            : requireInt(body.wip_limit, 'wip_limit');
      ctx.db.tx(() => {
        ctx.db.run(
          'UPDATE columns SET name = ?, position = ?, wip_limit = ? WHERE id = ?',
          name,
          position,
          wip,
          col.id,
        );
        logEvent(ctx.db, {
          actorId: agent.id,
          action: 'column.update',
          target: `column:${col.id}`,
          payload: { name, position, wip_limit: wip },
        });
      });
      return { status: 200, body: { column: ctx.db.get<Column>('SELECT * FROM columns WHERE id = ?', col.id) } };
    }

    const name = String(requireString(body.name, 'name', 64)).trim();
    if (columnsOf(ctx, board.id).some((c) => c.name === name)) {
      throw conflict(`column "${name}" already exists on board "${board.name}"`, { field: 'name', value: name });
    }
    const position =
      body.position === undefined ? nextColumnPosition(ctx, board.id) : requireInt(body.position, 'position');
    const wip = body.wip_limit === undefined || body.wip_limit === null ? null : requireInt(body.wip_limit, 'wip_limit');

    const colId = ctx.db.tx(() => {
      const r = ctx.db.run(
        'INSERT INTO columns (board_id, name, position, wip_limit) VALUES (?, ?, ?, ?)',
        board.id,
        name,
        position,
        wip,
      );
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'column.create',
        target: `column:${r.lastInsertRowid}`,
        payload: { board_id: board.id, name, position },
      });
      return r.lastInsertRowid;
    });
    return { status: 201, body: { column: ctx.db.get<Column>('SELECT * FROM columns WHERE id = ?', colId) } };
  },

  listThreads(ctx: Ctx, m: RegExpExecArray, _body: Body, _agent: Agent, query: URLSearchParams): Result {
    const board = boardById(ctx, requireInt(m[1], 'board_id'));
    const where: string[] = ['t.board_id = ?'];
    const params: unknown[] = [board.id];

    const category = query.get('category');
    if (category) {
      where.push('t.category = ?');
      params.push(category);
    }
    const status = query.get('status');
    if (status) {
      where.push('t.status = ?');
      params.push(status);
    }
    const unanswered = query.get('unanswered');

    const countExpr = '(SELECT COUNT(*) FROM posts p WHERE p.thread_id = t.id)';
    const sql = `
      SELECT t.*, ${countExpr} AS reply_count
        FROM threads t
       WHERE ${where.join(' AND ')}
         ${unanswered === '1' || unanswered === 'true' ? `AND ${countExpr} <= 1` : ''}
       ORDER BY t.updated_at DESC, t.id DESC
    `;
    const threads = ctx.db.all<Thread & { reply_count: number }>(sql, ...params);
    return { status: 200, body: { board_id: board.id, threads } };
  },

  createThread(ctx: Ctx, _m: RegExpExecArray, body: Body, agent: Agent): Result {
    const board = boardById(ctx, requireInt(body.board_id, 'board_id'));
    const category = body.category === undefined ? 'discussion' : String(body.category);
    if (!['discussion', 'task', 'idea', 'idle', 'announcement'].includes(category)) {
      throw badRequest('category must be discussion|task|idea|idle|announcement', {
        field: 'category',
        value: category,
      });
    }
    const title = String(requireString(body.title, 'title', 200)).trim();
    const text = String(requireString(body.body, 'body', ctx.cfg.postCharLimit));
    if (text.length > ctx.cfg.postCharLimit) throw charLimit('body', ctx.cfg.postCharLimit, text.length);
    const mentions = resolveMentions(ctx, body.mentions);

    const { threadId, postId } = ctx.db.tx(() => {
      const t = ctx.db.run(
        'INSERT INTO threads (board_id, category, title, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        board.id,
        category,
        title,
        'open',
        agent.id,
        now(),
        now(),
      );
      const p = ctx.db.run(
        'INSERT INTO posts (thread_id, author_id, body, created_at) VALUES (?, ?, ?, ?)',
        t.lastInsertRowid,
        agent.id,
        text,
        now(),
      );
      insertMentions(ctx, p.lastInsertRowid, mentions.ids);
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'thread.create',
        target: `thread:${t.lastInsertRowid}`,
        payload: { board_id: board.id, category, title, post_id: p.lastInsertRowid },
      });
      if (mentions.ids.length) {
        logEvent(ctx.db, {
          actorId: agent.id,
          action: 'mention.create',
          target: `post:${p.lastInsertRowid}`,
          payload: { agent_ids: mentions.ids },
        });
      }
      return { threadId: t.lastInsertRowid, postId: p.lastInsertRowid };
    });

    return {
      status: 201,
      body: {
        thread: ctx.db.get<Thread>('SELECT * FROM threads WHERE id = ?', threadId),
        post: ctx.db.get<Post>('SELECT * FROM posts WHERE id = ?', postId),
        mentions: mentions.ids,
        unknown_mentions: mentions.unknown,
      },
    };
  },

  getThread(ctx: Ctx, m: RegExpExecArray, _body: Body, _agent: Agent): Result {
    const thread = threadById(ctx, requireInt(m[1], 'thread_id'));
    const posts = ctx.db.all<Post & { author_handle: string; author_is_human: number }>(
      `SELECT p.*, a.handle AS author_handle, a.is_human AS author_is_human
         FROM posts p JOIN agents a ON a.id = p.author_id
        WHERE p.thread_id = ? ORDER BY p.created_at, p.id`,
      thread.id,
    ).map((p) => ({
      ...p,
      reactions: ctx.db.all(
        `SELECT r.emoji, a.handle AS agent FROM reactions r
           JOIN agents a ON a.id = r.agent_id
          WHERE r.target_type = 'post' AND r.target_id = ? ORDER BY r.id`,
        p.id,
      ),
      mentions: ctx.db.all<{ handle: string }>(
        'SELECT a.handle FROM mentions m JOIN agents a ON a.id = m.agent_id WHERE m.post_id = ? ORDER BY a.handle',
        p.id,
      ).map((r) => r.handle),
    }));
    const card = ctx.db.get<Card>('SELECT * FROM cards WHERE thread_id = ?', thread.id) ?? null;
    return { status: 200, body: { thread, posts, card } };
  },

  reply(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const thread = threadById(ctx, requireInt(m[1], 'thread_id'));
    const text = String(requireString(body.body, 'body', ctx.cfg.postCharLimit));
    if (text.length > ctx.cfg.postCharLimit) throw charLimit('body', ctx.cfg.postCharLimit, text.length);
    const mentions = resolveMentions(ctx, body.mentions);

    const postId = ctx.db.tx(() => {
      const r = ctx.db.run(
        'INSERT INTO posts (thread_id, author_id, body, created_at) VALUES (?, ?, ?, ?)',
        thread.id,
        agent.id,
        text,
        now(),
      );
      insertMentions(ctx, r.lastInsertRowid, mentions.ids);
      ctx.db.run('UPDATE threads SET updated_at = ? WHERE id = ?', now(), thread.id);
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'post.reply',
        target: `thread:${thread.id}`,
        payload: { post_id: r.lastInsertRowid, thread_id: thread.id },
      });
      if (mentions.ids.length) {
        logEvent(ctx.db, {
          actorId: agent.id,
          action: 'mention.create',
          target: `post:${r.lastInsertRowid}`,
          payload: { agent_ids: mentions.ids },
        });
      }
      return r.lastInsertRowid;
    });

    return {
      status: 201,
      body: {
        post: ctx.db.get<Post>('SELECT * FROM posts WHERE id = ?', postId),
        mentions: mentions.ids,
        unknown_mentions: mentions.unknown,
      },
    };
  },

  reactToPost(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const post = postById(ctx, requireInt(m[1], 'post_id'));
    return applyReaction(ctx, 'post', post.id, body, agent);
  },

  listCards(ctx: Ctx, m: RegExpExecArray, _body: Body, _agent: Agent, query: URLSearchParams): Result {
    const board = boardById(ctx, requireInt(m[1], 'board_id'));
    const where: string[] = ['c.board_id = ?'];
    const params: unknown[] = [board.id];

    const column = query.get('column');
    if (column) {
      const col = /^\d+$/.test(column)
        ? ctx.db.get<Column>('SELECT * FROM columns WHERE id = ?', Number(column))
        : ctx.db.get<Column>('SELECT * FROM columns WHERE board_id = ? AND name = ?', board.id, column);
      if (!col) throw notFound(`column ${column} does not exist on board ${board.id}`, { column });
      where.push('c.column_id = ?');
      params.push(col.id);
    }
    const assignee = query.get('assignee');
    if (assignee) {
      const a = agentByRef(ctx, assignee, 'assignee');
      where.push('c.assignee_id = ?');
      params.push(a ? a.id : -1);
    }

    const cards = ctx.db.all<
      Card & { column_name: string; assignee_handle: string | null; creator_handle: string }
    >(
      `SELECT c.*, col.name AS column_name,
              ag.handle AS assignee_handle, cr.handle AS creator_handle
         FROM cards c
         JOIN columns col ON col.id = c.column_id
         JOIN agents   cr ON cr.id = c.created_by
         LEFT JOIN agents ag ON ag.id = c.assignee_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.column_id, c.position, c.id`,
      ...params,
    );
    return { status: 200, body: { board_id: board.id, cards } };
  },

  createCard(ctx: Ctx, _m: RegExpExecArray, body: Body, agent: Agent): Result {
    const board = boardById(ctx, requireInt(body.board_id, 'board_id'));
    const title = String(requireString(body.title, 'title', 200)).trim();
    const description = typeof body.description === 'string' ? body.description : '';
    if (description.length > ctx.cfg.cardDescCharLimit) {
      throw charLimit('description', ctx.cfg.cardDescCharLimit, description.length);
    }

    const cols = columnsOf(ctx, board.id);
    let column: Column | undefined;
    if (body.column_id !== undefined && body.column_id !== null && body.column_id !== '') {
      column = columnById(ctx, requireInt(body.column_id, 'column_id'));
      if (column.board_id !== board.id) {
        throw badRequest(`column ${column.id} is not on board ${board.id}`, { field: 'column_id' });
      }
    } else if (typeof body.column === 'string') {
      const byName = ctx.db.get<Column>(
        'SELECT * FROM columns WHERE board_id = ? AND name = ?',
        board.id,
        body.column,
      );
      if (!byName) throw notFound(`column "${body.column}" not on board "${board.name}"`, { column: body.column });
      column = byName;
    } else {
      column = cols[0];
    }
    if (!column) throw badRequest(`board ${board.id} has no columns`, { field: 'column_id' });

    const assignee = agentByRef(ctx, body.assignee, 'assignee');
    let threadId: number | null = null;
    if (body.thread_id !== undefined && body.thread_id !== null && body.thread_id !== '') {
      const th = threadById(ctx, requireInt(body.thread_id, 'thread_id'));
      threadId = th.id;
    }

    const cardId = ctx.db.tx(() => {
      const position = nextCardPosition(ctx, column!.id);
      const r = ctx.db.run(
        `INSERT INTO cards (board_id, column_id, position, title, description, assignee_id, thread_id, created_by, created_at, updated_at, done_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        board.id,
        column!.id,
        position,
        title,
        description,
        assignee ? assignee.id : null,
        threadId,
        agent.id,
        now(),
        now(),
      );
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'card.create',
        target: `card:${r.lastInsertRowid}`,
        payload: { board_id: board.id, column_id: column!.id, position, title },
      });
      return r.lastInsertRowid;
    });

    return { status: 201, body: { card: ctx.db.get<Card>('SELECT * FROM cards WHERE id = ?', cardId) } };
  },

  patchCard(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const card = cardById(ctx, requireInt(m[1], 'card_id'));
    const before = { ...card };

    let columnId = card.column_id;
    let position = card.position;
    let title = card.title;
    let description = card.description;
    let assigneeId = card.assignee_id;
    let doneAt = card.done_at;

    const columnChanged =
      body.column_id !== undefined && body.column_id !== null && requireInt(body.column_id, 'column_id') !== card.column_id;

    if (body.column_id !== undefined && body.column_id !== null && body.column_id !== '') {
      const col = columnById(ctx, requireInt(body.column_id, 'column_id'));
      if (col.board_id !== card.board_id) {
        throw badRequest(`column ${col.id} is not on card ${card.id}'s board`, { field: 'column_id' });
      }
      columnId = col.id;
    }
    if (body.title !== undefined) title = String(requireString(body.title, 'title', 200)).trim();
    if (body.description !== undefined) {
      description = typeof body.description === 'string' ? body.description : '';
      if (description.length > ctx.cfg.cardDescCharLimit) {
        throw charLimit('description', ctx.cfg.cardDescCharLimit, description.length);
      }
    }
    if (body.assignee !== undefined) {
      assigneeId = body.assignee === null || body.assignee === '' ? null : (agentByRef(ctx, body.assignee, 'assignee')?.id ?? null);
    }
    if (body.done !== undefined) {
      doneAt = body.done === true || body.done === 1 || body.done === 'true' ? now() : null;
    }
    if (body.position !== undefined && body.position !== null && body.position !== '') {
      position = requireInt(body.position, 'position');
    } else if (columnChanged) {
      position = nextCardPosition(ctx, columnId);
    }

    ctx.db.tx(() => {
      ctx.db.run(
        `UPDATE cards SET column_id = ?, position = ?, title = ?, description = ?,
                          assignee_id = ?, updated_at = ?, done_at = ? WHERE id = ?`,
        columnId,
        position,
        title,
        description,
        assigneeId,
        now(),
        doneAt,
        card.id,
      );
      if (columnChanged) {
        logEvent(ctx.db, {
          actorId: agent.id,
          action: 'card.move',
          target: `card:${card.id}`,
          payload: { from_column: before.column_id, to_column: columnId, position },
        });
      }
      if (assigneeId !== before.assignee_id) {
        logEvent(ctx.db, {
          actorId: agent.id,
          action: 'card.assign',
          target: `card:${card.id}`,
          payload: { from: before.assignee_id, to: assigneeId },
        });
      }
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'card.update',
        target: `card:${card.id}`,
        payload: { title, done_at: doneAt, changed: diffKeys(before, { column_id: columnId, position, title, description, assignee_id: assigneeId, done_at: doneAt }) },
      });
    });

    return { status: 200, body: { card: ctx.db.get<Card>('SELECT * FROM cards WHERE id = ?', card.id) } };
  },

  linkCard(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const card = cardById(ctx, requireInt(m[1], 'card_id'));
    const thread = threadById(ctx, requireInt(body.thread_id, 'thread_id'));
    ctx.db.tx(() => {
      ctx.db.run('UPDATE cards SET thread_id = ?, updated_at = ? WHERE id = ?', thread.id, now(), card.id);
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'card.link',
        target: `card:${card.id}`,
        payload: { thread_id: thread.id },
      });
    });
    return { status: 200, body: { card: ctx.db.get<Card>('SELECT * FROM cards WHERE id = ?', card.id) } };
  },

  linkThread(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const thread = threadById(ctx, requireInt(m[1], 'thread_id'));
    const card = cardById(ctx, requireInt(body.card_id, 'card_id'));
    ctx.db.tx(() => {
      ctx.db.run('UPDATE cards SET thread_id = ?, updated_at = ? WHERE id = ?', thread.id, now(), card.id);
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'card.link',
        target: `card:${card.id}`,
        payload: { thread_id: thread.id, via: 'thread' },
      });
    });
    return { status: 200, body: { card: ctx.db.get<Card>('SELECT * FROM cards WHERE id = ?', card.id) } };
  },

  reactToCard(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const card = cardById(ctx, requireInt(m[1], 'card_id'));
    return applyReaction(ctx, 'card', card.id, body, agent);
  },

  inbox(ctx: Ctx, m: RegExpExecArray, _body: Body, _agent: Agent): Result {
    const ref = decodeURIComponent(m[1]).replace(/^@/, '');
    const agent = ctx.db.get<Agent>('SELECT * FROM agents WHERE handle = ? OR id = ?', ref, Number(ref) || -1);
    if (!agent) throw notFound(`agent ${ref} does not exist`, { handle: ref });

    const mentions = ctx.db.all(
      `SELECT m.id AS mention_id, p.id AS post_id, p.body, p.created_at,
              t.id AS thread_id, t.title AS thread_title, t.status AS thread_status,
              a.handle AS author
         FROM mentions m
         JOIN posts   p ON p.id = m.post_id
         JOIN threads t ON t.id = p.thread_id
         JOIN agents  a ON a.id = p.author_id
        WHERE m.agent_id = ?
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 100`,
      agent.id,
    );
    const cards = ctx.db.all(
      `SELECT c.*, col.name AS column_name, b.name AS board_name
         FROM cards c
         JOIN columns col ON col.id = c.column_id
         JOIN boards   b  ON b.id  = c.board_id
        WHERE c.assignee_id = ? AND c.done_at IS NULL
        ORDER BY c.updated_at DESC, c.id DESC`,
      agent.id,
    );
    return {
      status: 200,
      body: {
        handle: agent.handle,
        is_human: agent.is_human === 1,
        mentions,
        cards,
        counts: { mentions: mentions.length, cards: cards.length },
      },
    };
  },
} satisfies Record<string, Handler>;

function diffKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

function applyReaction(ctx: Ctx, targetType: 'post' | 'card', targetId: number, body: Body, agent: Agent): Result {
  const emoji = String(requireString(body.emoji, 'emoji', 32)).trim();
  const op = body.op === undefined ? 'add' : String(body.op);
  if (op !== 'add' && op !== 'remove') {
    throw badRequest('op must be "add" or "remove"', { field: 'op', value: op });
  }
  const existing = ctx.db.get<{ id: number }>(
    'SELECT id FROM reactions WHERE target_type = ? AND target_id = ? AND agent_id = ? AND emoji = ?',
    targetType,
    targetId,
    agent.id,
    emoji,
  );

  if (op === 'add') {
    if (existing) {
      throw conflict(`${emoji} reaction already present on ${targetType} ${targetId}`, {
        field: 'emoji',
        value: emoji,
      });
    }
    ctx.db.tx(() => {
      ctx.db.run(
        'INSERT INTO reactions (target_type, target_id, agent_id, emoji) VALUES (?, ?, ?, ?)',
        targetType,
        targetId,
        agent.id,
        emoji,
      );
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'reaction.add',
        target: `${targetType}:${targetId}`,
        payload: { emoji },
      });
    });
  } else {
    if (!existing) {
      throw notFound(`${emoji} reaction not present on ${targetType} ${targetId}`, {
        field: 'emoji',
        value: emoji,
      });
    }
    ctx.db.tx(() => {
      ctx.db.run(
        'DELETE FROM reactions WHERE target_type = ? AND target_id = ? AND agent_id = ? AND emoji = ?',
        targetType,
        targetId,
        agent.id,
        emoji,
      );
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'reaction.remove',
        target: `${targetType}:${targetId}`,
        payload: { emoji },
      });
    });
  }

  const rows = ctx.db.all(
    `SELECT r.emoji, a.handle AS agent FROM reactions r
       JOIN agents a ON a.id = r.agent_id
      WHERE r.target_type = ? AND r.target_id = ? ORDER BY r.id`,
    targetType,
    targetId,
  );
  return { status: op === 'add' ? 201 : 200, body: { target_type: targetType, target_id: targetId, op, emoji, reactions: rows } };
}

// ---------------------------------------------------------------------------
// route table (order matters only where prefixes overlap; these do not)
// ---------------------------------------------------------------------------

export const ROUTES: Route[] = [
  { method: 'GET', re: /^\/api\/me$/, auth: true, h: handlers.me },
  { method: 'POST', re: /^\/api\/login$/, auth: false, h: handlers.login },
  { method: 'GET', re: /^\/api\/config$/, auth: false, h: handlers.config },
  { method: 'POST', re: /^\/api\/setup$/, auth: false, h: handlers.setup },
  { method: 'PATCH', re: /^\/api\/settings$/, auth: true, h: handlers.patchSettings },
  { method: 'POST', re: /^\/api\/settings\/password$/, auth: true, h: handlers.changePassword },
  { method: 'POST', re: /^\/api\/agents$/, auth: false, h: handlers.register },
  { method: 'GET', re: /^\/api\/agents$/, auth: true, h: handlers.listAgents },

  { method: 'GET', re: /^\/api\/boards$/, auth: true, h: handlers.listBoards },
  { method: 'POST', re: /^\/api\/boards$/, auth: true, h: handlers.createBoard },
  { method: 'POST', re: /^\/api\/boards\/(\d+)\/columns$/, auth: true, h: handlers.manageColumns },
  { method: 'GET', re: /^\/api\/boards\/(\d+)\/threads$/, auth: true, h: handlers.listThreads },
  { method: 'GET', re: /^\/api\/boards\/(\d+)\/cards$/, auth: true, h: handlers.listCards },

  { method: 'POST', re: /^\/api\/threads$/, auth: true, h: handlers.createThread },
  { method: 'GET', re: /^\/api\/threads\/(\d+)$/, auth: true, h: handlers.getThread },
  { method: 'POST', re: /^\/api\/threads\/(\d+)\/replies$/, auth: true, h: handlers.reply },
  { method: 'POST', re: /^\/api\/threads\/(\d+)\/link$/, auth: true, h: handlers.linkThread },

  { method: 'POST', re: /^\/api\/posts\/(\d+)\/reactions$/, auth: true, h: handlers.reactToPost },

  { method: 'POST', re: /^\/api\/cards$/, auth: true, h: handlers.createCard },
  { method: 'PATCH', re: /^\/api\/cards\/(\d+)$/, auth: true, h: handlers.patchCard },
  { method: 'POST', re: /^\/api\/cards\/(\d+)\/link$/, auth: true, h: handlers.linkCard },
  { method: 'POST', re: /^\/api\/cards\/(\d+)\/reactions$/, auth: true, h: handlers.reactToCard },

  { method: 'GET', re: /^\/api\/inbox\/([^/]+)$/, auth: true, h: handlers.inbox },
];
