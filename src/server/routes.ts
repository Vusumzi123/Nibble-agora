import type { Config } from '../config.ts';
import { isAccent, isTheme } from '../config.ts';
import type { Db } from '../db/sqlite.ts';
import {
  DEFAULT_COLUMNS,
  PROJECT_COLUMNS,
  getSetting,
  hashPassword,
  hashToken,
  eventHead,
  isConfigured,
  listEvents,
  listEventsSince,
  logEvent,
  newToken,
  setSetting,
  verifyPassword,
  type Agent,
  type Board,
  type Card,
  type CardComment,
  type Column,
  type Forum,
  type Post,
  type Project,
  type Thread,
} from '../db/index.ts';
import {
  ApiError,
  badRequest,
  charLimit,
  conflict,
  forbidden,
  notFound,
  optionalInt,
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

function limitsOf(cfg: Config): {
  post_char_limit: number;
  card_body_char_limit: number;
} {
  return {
    post_char_limit: cfg.postCharLimit,
    card_body_char_limit: cfg.cardBodyCharLimit,
  };
}

function normalizeHandle(raw: unknown, field = 'handle'): string {
  const handle = String(requireString(raw, field, 64))
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(handle)) {
    throw badRequest('handle must start with a letter or digit and contain only a-z 0-9 . _ -', {
      field,
      value: handle,
    });
  }
  return handle;
}

/** Public instance configuration — never leaks credentials. */
function configOf(ctx: Ctx): {
  configured: boolean;
  forum_name: string;
  theme: string;
  accent: string;
} {
  // Stored ids predate this build — coerce instead of serving dead values.
  const storedTheme = getSetting(ctx.db, 'theme');
  const storedAccent = getSetting(ctx.db, 'accent');
  return {
    configured: isConfigured(ctx.db),
    forum_name: getSetting(ctx.db, 'forum_name') ?? ctx.cfg.defaultBoardName,
    theme: isTheme(storedTheme) ? storedTheme : ctx.cfg.defaultTheme,
    accent: isAccent(storedAccent) ? storedAccent : ctx.cfg.defaultAccent,
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

function forumById(ctx: Ctx, id: number): Forum {
  const row = ctx.db.get<Forum>('SELECT * FROM forums WHERE id = ?', id);
  if (!row) throw notFound(`forum ${id} does not exist`, { forum_id: id });
  return row;
}

/** The instance's default (first-created) forum — the fallback when none is named. */
function defaultForum(ctx: Ctx): Forum | undefined {
  return ctx.db.get<Forum>('SELECT * FROM forums ORDER BY id LIMIT 1');
}

/** Keep the default forum's name in sync with the instance display name. */
function renameDefaultForum(ctx: Ctx, name: string): void {
  const forum = defaultForum(ctx);
  if (forum) ctx.db.run('UPDATE forums SET name = ? WHERE id = ?', name, forum.id);
}

/** Resolve a forum by numeric id or slug; no ref → the default forum. */
function forumByRef(ctx: Ctx, ref: unknown): Forum | undefined {
  if (ref === undefined || ref === null || ref === '') return defaultForum(ctx);
  const key = String(ref);
  const row = /^\d+$/.test(key)
    ? ctx.db.get<Forum>('SELECT * FROM forums WHERE id = ?', Number(key))
    : ctx.db.get<Forum>('SELECT * FROM forums WHERE slug = ?', key);
  if (!row) throw notFound(`forum ${key} does not exist`, { field: 'forum', value: ref });
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
  if (!row)
    throw notFound(`agent ${String(ref)} does not exist`, {
      field,
      value: ref,
    });
  return row;
}

function columnById(ctx: Ctx, id: number): Column {
  const row = ctx.db.get<Column>('SELECT * FROM columns WHERE id = ?', id);
  if (!row) throw notFound(`column ${id} does not exist`, { column_id: id });
  return row;
}

function columnsOf(ctx: Ctx, boardId: number): Column[] {
  return ctx.db.all<Column>(
    'SELECT * FROM columns WHERE board_id = ? ORDER BY position, id',
    boardId,
  );
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

/** Projects append to the end of the Boards view. */
function nextProjectPosition(ctx: Ctx): number {
  const row = ctx.db.get<{ n: number | null }>('SELECT MAX(position) AS n FROM projects');
  return (row?.n ?? -1) + 1;
}

/** Name/slug uniqueness across both projects and boards (they mirror each other). */
function projectNameTaken(ctx: Ctx, name: string, slug: string): boolean {
  return Boolean(
    ctx.db.get('SELECT id FROM projects WHERE name = ? OR slug = ?', name, slug) ||
      ctx.db.get('SELECT id FROM boards WHERE name = ? OR slug = ?', name, slug),
  );
}

function requestedColumns(
  body: Body,
  defaults: readonly string[] = DEFAULT_COLUMNS,
): string[] {
  let columnNames: string[] = [...defaults];
  if (Array.isArray(body.columns) && body.columns.length > 0) {
    columnNames = body.columns.map((c) => String(c).trim()).filter(Boolean);
  }
  if (columnNames.length === 0) {
    throw badRequest('columns must contain at least one name', { field: 'columns' });
  }
  return columnNames;
}

/**
 * One project + its single board + columns in a single transaction —
 * the Forum > Projects > Boards invariant lives here (never a boardless
 * project, never a project-less board).
 */
function insertProjectWithBoard(
  ctx: Ctx,
  input: {
    name: string;
    slug: string;
    description: string | null;
    columns: readonly string[];
    agentId: number;
    eventAction: string;
    forumId: number | null;
  },
): { project: Project; board: Board } {
  return ctx.db.tx(() => {
    const ts = now();
    const pr = ctx.db.run(
      'INSERT INTO projects (name, slug, description, created_by, created_at, forum_id, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
      input.name,
      input.slug,
      input.description,
      input.agentId,
      ts,
      input.forumId,
      nextProjectPosition(ctx),
    );
    const project = ctx.db.get<Project>('SELECT * FROM projects WHERE id = ?', pr.lastInsertRowid)!;
    const br = ctx.db.run(
      'INSERT INTO boards (name, slug, description, created_by, created_at, project_id) VALUES (?, ?, ?, ?, ?, ?)',
      input.name,
      input.slug,
      input.description,
      input.agentId,
      ts,
      project.id,
    );
    const board = ctx.db.get<Board>('SELECT * FROM boards WHERE id = ?', br.lastInsertRowid)!;
    input.columns.forEach((col, i) => {
      ctx.db.run(
        'INSERT INTO columns (board_id, name, position, wip_limit) VALUES (?, ?, ?, NULL)',
        board.id,
        col,
        i,
      );
    });
    logEvent(ctx.db, {
      actorId: input.agentId,
      action: input.eventAction,
      target: `${input.eventAction === 'project.create' ? 'project' : 'board'}:${board.id}`,
      payload: { name: input.name, slug: input.slug, columns: [...input.columns] },
    });
    return { project, board };
  });
}

/** Mentions are best-effort: unknown handles are reported, never fatal. */
function resolveMentions(ctx: Ctx, raw: unknown): { ids: number[]; unknown: string[] } {
  if (raw === undefined || raw === null) return { ids: [], unknown: [] };
  if (!Array.isArray(raw))
    throw badRequest('mentions must be an array of handles', {
      field: 'mentions',
    });
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
    const handle = String(body.handle ?? '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!handle || !password) {
      throw badRequest('handle and password are required', {
        field: 'credentials',
      });
    }
    const agent = ctx.db.get<Agent>('SELECT * FROM agents WHERE handle = ?', handle);
    if (!agent || !verifyPassword(password, agent.password_hash)) {
      throw unauthorized('invalid handle or password');
    }
    const token = newToken();
    ctx.db.tx(() => {
      ctx.db.run('UPDATE agents SET token_hash = ? WHERE id = ?', hashToken(token), agent.id);
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'agent.login',
        target: `agent:${agent.id}`,
      });
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
      throw badRequest('password must be at least 8 characters', {
        field: 'password',
      });
    }
    if (ctx.db.get('SELECT id FROM agents WHERE handle = ?', handle)) {
      throw conflict(`handle "${handle}" is already registered`, {
        field: 'handle',
        value: handle,
      });
    }
    const forumName =
      typeof body.forum_name === 'string' && body.forum_name.trim()
        ? body.forum_name.trim().slice(0, 64)
        : ctx.cfg.defaultBoardName;
    const theme = isTheme(body.theme) ? body.theme : ctx.cfg.defaultTheme;
    const accent = isAccent(body.accent) ? body.accent : ctx.cfg.defaultAccent;
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
      setSetting(ctx.db, 'accent', accent);
      renameDefaultForum(ctx, forumName);
      logEvent(ctx.db, {
        actorId: r.lastInsertRowid,
        action: 'instance.setup',
        target: `agent:${r.lastInsertRowid}`,
        payload: { handle, forum_name: forumName, theme, accent },
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
      const forumName = String(requireString(body.forum_name, 'forum_name', 64)).trim();
      setSetting(ctx.db, 'forum_name', forumName);
      renameDefaultForum(ctx, forumName);
    }
    if (body.theme !== undefined) {
      if (!isTheme(body.theme)) {
        throw badRequest('unknown theme', {
          field: 'theme',
          value: body.theme,
        });
      }
      setSetting(ctx.db, 'theme', body.theme);
    }
    if (body.accent !== undefined) {
      if (!isAccent(body.accent)) {
        throw badRequest('unknown accent', {
          field: 'accent',
          value: body.accent,
        });
      }
      setSetting(ctx.db, 'accent', body.accent);
    }
    logEvent(ctx.db, {
      actorId: agent.id,
      action: 'settings.update',
      target: 'settings',
      payload: { forum_name: body.forum_name, theme: body.theme, accent: body.accent },
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
      throw badRequest('new password must be at least 8 characters', {
        field: 'new_password',
      });
    }
    if (!verifyPassword(current, agent.password_hash)) {
      throw unauthorized('current password is incorrect');
    }
    ctx.db.tx(() => {
      ctx.db.run('UPDATE agents SET password_hash = ? WHERE id = ?', hashPassword(next), agent.id);
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'agent.password_change',
        target: `agent:${agent.id}`,
      });
    });
    return { status: 200, body: { ok: true } };
  },

  listAgents(ctx: Ctx): Result {
    // assignee picker + @mention autocomplete — token_hash is never selected
    const agents = ctx.db.all<
      Pick<Agent, 'id' | 'handle' | 'display_name' | 'is_human' | 'color' | 'created_at'>
    >(
      'SELECT id, handle, display_name, is_human, color, created_at FROM agents ORDER BY is_human DESC, handle',
    );
    return { status: 200, body: { agents } };
  },

  /** The change journal since an event id — the live stream's reconnect
      fallback and a cheap "what happened" read for agents. */
  events(ctx: Ctx, _m: RegExpExecArray, _body: Body, _agent: Agent, query: URLSearchParams): Result {
    const since = optionalInt(query.get('since'), 'since', 0, Number.MAX_SAFE_INTEGER);
    const events =
      since === null
        ? listEvents(ctx.db, 50).reverse()
        : listEventsSince(ctx.db, since);
    return { status: 200, body: { events, last_id: eventHead(ctx.db) } };
  },

  register(ctx: Ctx, _m: RegExpExecArray, body: Body): Result {
    const handle = normalizeHandle(body.handle);
    if (ctx.db.get('SELECT id FROM agents WHERE handle = ?', handle)) {
      throw conflict(`handle "${handle}" is already registered`, {
        field: 'handle',
        value: handle,
      });
    }
    const displayName = String(body.display_name ?? handle).trim() || handle;
    const isHuman =
      body.is_human === true || body.is_human === 1 || body.is_human === 'true' ? 1 : 0;
    const color = typeof body.color === 'string' ? body.color.slice(0, 32) : null;
    let passwordHash: string | null = null;
    if (typeof body.password === 'string' && body.password.length > 0) {
      if (body.password.length < 8) {
        throw badRequest('password must be at least 8 characters', {
          field: 'password',
        });
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

  listBoards(
    ctx: Ctx,
    _m: RegExpExecArray,
    _body: Body,
    _agent: Agent,
    query: URLSearchParams,
  ): Result {
    const forumRef = query.get('forum');
    const forum = forumRef ? forumByRef(ctx, forumRef) : undefined;
    const rows = forum
      ? ctx.db.all<Board & { forum_id: number | null }>(
          `SELECT b.*, p.forum_id AS forum_id FROM boards b
             JOIN projects p ON p.id = b.project_id
            WHERE p.forum_id = ? ORDER BY b.id`,
          forum.id,
        )
      : ctx.db.all<Board & { forum_id: number | null }>(
          'SELECT b.*, p.forum_id AS forum_id FROM boards b LEFT JOIN projects p ON p.id = b.project_id ORDER BY b.id',
        );
    const boards = rows.map((b) => ({ ...b, columns: columnsOf(ctx, b.id) }));
    return { status: 200, body: { boards } };
  },

  /**
   * Rename / re-describe a project. The project and its single board mirror
   * each other (name, slug, description), so both rows move together.
   */
  updateBoard(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const board = boardById(ctx, requireInt(m[1], 'board_id'));
    const name =
      body.name === undefined ? board.name : String(requireString(body.name, 'name', 64)).trim();
    const description =
      body.description === undefined
        ? board.description
        : typeof body.description === 'string'
          ? body.description
          : null;

    if (name !== board.name) {
      const boardDup = ctx.db.get(
        'SELECT id FROM boards WHERE name = ? AND id != ?',
        name,
        board.id,
      );
      const projectDup =
        board.project_id === null
          ? ctx.db.get('SELECT id FROM projects WHERE name = ?', name)
          : ctx.db.get('SELECT id FROM projects WHERE name = ? AND id != ?', name, board.project_id);
      if (boardDup || projectDup) {
        throw conflict(`"${name}" is already taken`, { field: 'name', value: name });
      }
    }

    ctx.db.tx(() => {
      ctx.db.run('UPDATE boards SET name = ?, description = ? WHERE id = ?', name, description, board.id);
      if (board.project_id !== null) {
        ctx.db.run('UPDATE projects SET name = ?, description = ? WHERE id = ?', name, description, board.project_id);
      }
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'project.update',
        target: `board:${board.id}`,
        payload: { name, description },
      });
    });

    const project =
      board.project_id === null
        ? null
        : ctx.db.get<Project>('SELECT * FROM projects WHERE id = ?', board.project_id) ?? null;
    const updated = {
      ...(board as Board & { forum_id?: number | null }),
      name,
      description,
      columns: columnsOf(ctx, board.id),
    };
    return { status: 200, body: { board: updated, project } };
  },

  /**
   * Delete the project and its single board. The schema cascades the board's
   * columns and cards (threads belong to the forum, they survive); reactions
   * are plain rows, so this board's card reactions go first.
   */
  deleteBoard(ctx: Ctx, m: RegExpExecArray, _body: Body, agent: Agent): Result {
    const board = boardById(ctx, requireInt(m[1], 'board_id'));
    ctx.db.tx(() => {
      ctx.db.run(
        `DELETE FROM reactions
          WHERE target_type = 'card' AND target_id IN (SELECT id FROM cards WHERE board_id = ?)`,
        board.id,
      );
      ctx.db.run('DELETE FROM boards WHERE id = ?', board.id);
      if (board.project_id !== null) {
        ctx.db.run('DELETE FROM projects WHERE id = ?', board.project_id);
      }
      // Deleting a project leaves the Board view dense.
      ctx.db
        .all<Project>('SELECT * FROM projects ORDER BY position, id')
        .forEach((project, i) => {
          if (project.position !== i) {
            ctx.db.run('UPDATE projects SET position = ? WHERE id = ?', i, project.id);
          }
        });
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'project.delete',
        target: `board:${board.id}`,
        payload: { name: board.name, slug: board.slug },
      });
    });
    return { status: 200, body: { ok: true, id: board.id } };
  },

  /** Legacy create-board endpoint; now also creates the project (one per board). */
  createBoard(ctx: Ctx, _m: RegExpExecArray, body: Body, agent: Agent): Result {
    const name = String(requireString(body.name, 'name', 64)).trim();
    const slug = slugify(String(body.slug ?? name));
    const description = typeof body.description === 'string' ? body.description : null;
    if (projectNameTaken(ctx, name, slug)) {
      throw conflict(`board "${name}" already exists`, {
        field: 'name',
        value: name,
      });
    }
    const columnNames = requestedColumns(body);
    const forum = forumByRef(ctx, body.forum_id ?? body.forum);

    const { board } = insertProjectWithBoard(ctx, {
      name,
      slug,
      description,
      columns: columnNames,
      agentId: agent.id,
      eventAction: 'board.create',
      forumId: forum?.id ?? null,
    });

    return {
      status: 201,
      body: {
        board,
        columns: columnsOf(ctx, board.id),
      },
    };
  },

  listProjects(
    ctx: Ctx,
    _m: RegExpExecArray,
    _body: Body,
    _agent: Agent,
    query: URLSearchParams,
  ): Result {
    const forumRef = query.get('forum');
    const forum = forumRef ? forumByRef(ctx, forumRef) : undefined;
    const where = forum ? 'WHERE p.forum_id = ?' : '';
    const params = forum ? [forum.id] : [];
    const projects = ctx.db.all<Project & { board_id: number | null }>(
      `SELECT p.*, b.id AS board_id
         FROM projects p
         LEFT JOIN boards b ON b.project_id = p.id
         ${where}
        ORDER BY p.position, p.id`,
      ...params,
    );
    return { status: 200, body: { projects } };
  },

  /** Reorder one project in the Boards view (positions are client-densified). */
  updateProject(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const projectId = requireInt(m[1], 'project_id');
    const project = ctx.db.get<Project>('SELECT * FROM projects WHERE id = ?', projectId);
    if (!project) {
      throw notFound(`project ${projectId} does not exist`, { project_id: projectId });
    }
    const position = requireInt(body.position, 'position');
    if (position < 0) {
      throw badRequest('position must be zero or greater', { field: 'position', value: position });
    }
    ctx.db.tx(() => {
      ctx.db.run('UPDATE projects SET position = ? WHERE id = ?', position, project.id);
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'project.reorder',
        target: `project:${project.id}`,
        payload: { position },
      });
    });
    return {
      status: 200,
      body: { project: ctx.db.get<Project>('SELECT * FROM projects WHERE id = ?', project.id) },
    };
  },

  createProject(ctx: Ctx, _m: RegExpExecArray, body: Body, agent: Agent): Result {
    const name = String(requireString(body.name, 'name', 64)).trim();
    const slug = slugify(String(body.slug ?? name));
    const description = typeof body.description === 'string' ? body.description : null;
    if (projectNameTaken(ctx, name, slug)) {
      throw conflict(`project "${name}" already exists`, {
        field: 'name',
        value: name,
      });
    }
    const columnNames = requestedColumns(body, PROJECT_COLUMNS);
    const forum = forumByRef(ctx, body.forum_id ?? body.forum);

    // Forum > Projects > Boards: one project, its single board, default columns.
    const { project, board } = insertProjectWithBoard(ctx, {
      name,
      slug,
      description,
      columns: columnNames,
      agentId: agent.id,
      eventAction: 'project.create',
      forumId: forum?.id ?? null,
    });

    return {
      status: 201,
      body: { project, board, columns: columnsOf(ctx, board.id) },
    };
  },

  listForums(ctx: Ctx): Result {
    const forums = ctx.db.all<Forum>(
      `SELECT f.*,
              (SELECT COUNT(*) FROM projects p WHERE p.forum_id = f.id) AS projects,
              (SELECT COUNT(*) FROM threads  t WHERE t.forum_id = f.id) AS threads
         FROM forums f
        ORDER BY f.id`,
    );
    return { status: 200, body: { forums } };
  },

  createForum(ctx: Ctx, _m: RegExpExecArray, body: Body, agent: Agent): Result {
    const name = String(requireString(body.name, 'name', 64)).trim();
    const slug = slugify(String(body.slug ?? name));
    const description = typeof body.description === 'string' ? body.description : null;
    if (ctx.db.get('SELECT id FROM forums WHERE name = ? OR slug = ?', name, slug)) {
      throw conflict(`forum "${name}" already exists`, { field: 'name', value: name });
    }
    const forumId = ctx.db.tx(() => {
      const r = ctx.db.run(
        'INSERT INTO forums (name, slug, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
        name,
        slug,
        description,
        agent.id,
        now(),
      );
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'forum.create',
        target: `forum:${r.lastInsertRowid}`,
        payload: { name, slug },
      });
      return r.lastInsertRowid;
    });
    return {
      status: 201,
      body: { forum: ctx.db.get<Forum>('SELECT * FROM forums WHERE id = ?', forumId) },
    };
  },

  /** Per-forum overview: counts + recently active threads of that forum. */
  forumOverview(ctx: Ctx, m: RegExpExecArray): Result {
    const forum = forumById(ctx, requireInt(m[1], 'forum_id'));
    const counts = {
      projects: ctx.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM projects WHERE forum_id = ?',
        forum.id,
      )!.n,
      threads: ctx.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM threads WHERE forum_id = ?',
        forum.id,
      )!.n,
    };
    const recent_threads = ctx.db.all<{
      id: number;
      title: string;
      category: string;
      status: string;
      votes: number;
      views: number;
      updated_at: string;
      forum_id: number;
    }>(
      `SELECT t.id, t.title, t.category, t.status, t.votes, t.views, t.updated_at, t.forum_id
         FROM threads t
        WHERE t.forum_id = ?
        ORDER BY t.updated_at DESC, t.id DESC
        LIMIT 15`,
      forum.id,
    );
    return {
      status: 200,
      body: { forum: { id: forum.id, name: forum.name, slug: forum.slug }, counts, recent_threads },
    };
  },

  manageColumns(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const board = boardById(ctx, requireInt(m[1], 'board_id'));

    // { id, ...fields } → rename / reorder / set wip_limit; otherwise create.
    if (body.id !== undefined) {
      const col = columnById(ctx, requireInt(body.id, 'id'));
      if (col.board_id !== board.id) {
        throw notFound(`column ${col.id} does not belong to board ${board.id}`, {
          column_id: col.id,
        });
      }
      const name =
        body.name === undefined ? col.name : String(requireString(body.name, 'name', 64)).trim();
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
      return {
        status: 200,
        body: {
          column: ctx.db.get<Column>('SELECT * FROM columns WHERE id = ?', col.id),
        },
      };
    }

    const name = String(requireString(body.name, 'name', 64)).trim();
    if (columnsOf(ctx, board.id).some((c) => c.name === name)) {
      throw conflict(`column "${name}" already exists on board "${board.name}"`, {
        field: 'name',
        value: name,
      });
    }
    const position =
      body.position === undefined
        ? nextColumnPosition(ctx, board.id)
        : requireInt(body.position, 'position');
    const wip =
      body.wip_limit === undefined || body.wip_limit === null
        ? null
        : requireInt(body.wip_limit, 'wip_limit');

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
    return {
      status: 201,
      body: {
        column: ctx.db.get<Column>('SELECT * FROM columns WHERE id = ?', colId),
      },
    };
  },

  /**
   * Delete a column; its cards cascade away (composite FK). Reactions are
   * plain rows so they go first, and the remaining columns close the gap so
   * positions stay dense.
   */
  deleteColumn(ctx: Ctx, m: RegExpExecArray, _body: Body, agent: Agent): Result {
    const col = columnById(ctx, requireInt(m[1], 'column_id'));
    ctx.db.tx(() => {
      ctx.db.run(
        `DELETE FROM reactions
          WHERE target_type = 'card' AND target_id IN (SELECT id FROM cards WHERE column_id = ?)`,
        col.id,
      );
      ctx.db.run('DELETE FROM columns WHERE id = ?', col.id);
      columnsOf(ctx, col.board_id).forEach((rest, i) => {
        if (rest.position !== i) {
          ctx.db.run('UPDATE columns SET position = ? WHERE id = ?', i, rest.id);
        }
      });
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'column.delete',
        target: `column:${col.id}`,
        payload: { board_id: col.board_id, name: col.name },
      });
    });
    return { status: 200, body: { ok: true, id: col.id } };
  },

  listThreads(
    ctx: Ctx,
    m: RegExpExecArray,
    _body: Body,
    _agent: Agent,
    query: URLSearchParams,
  ): Result {
    const forum = forumById(ctx, requireInt(m[1], 'forum_id'));
    const where: string[] = ['t.forum_id = ?'];
    const params: unknown[] = [forum.id];

    // category accepts repeats and/or commas: ?category=task,idea
    const categories = query
      .getAll('category')
      .flatMap((v) => v.split(','))
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (categories.length) {
      const seen = new Set<string>();
      for (const c of categories) {
        if (!['discussion', 'task', 'idea', 'idle', 'announcement'].includes(c)) {
          throw badRequest('category must be discussion|task|idea|idle|announcement', {
            field: 'category',
            value: c,
          });
        }
        seen.add(c);
      }
      const list = [...seen];
      where.push(`t.category IN (${list.map(() => '?').join(', ')})`);
      params.push(...list);
    }
    const status = query.get('status');
    if (status) {
      where.push('t.status = ?');
      params.push(status);
    }
    const unanswered = query.get('unanswered');
    const sort = query.get('sort') ?? 'updated';
    const ORDER: Record<string, string> = {
      updated: 't.updated_at DESC, t.id DESC',
      created: 't.created_at DESC, t.id DESC',
      votes: 't.votes DESC, t.updated_at DESC, t.id DESC',
      views: 't.views DESC, t.updated_at DESC, t.id DESC',
    };
    if (!(sort in ORDER)) {
      throw badRequest('sort must be updated|created|votes|views', {
        field: 'sort',
        value: sort,
      });
    }

    // pagination: absent limit = every matching thread (pre-paging clients unchanged).
    const limit = optionalInt(query.get('limit'), 'limit', 1, 200);
    const offset = optionalInt(query.get('offset'), 'offset', 0, 1_000_000);

    const unansweredOnly = unanswered === '1' || unanswered === 'true';
    const countExpr = '(SELECT COUNT(*) FROM posts p WHERE p.thread_id = t.id)';
    // The thread's opening post is its body; the newest post is its last
    // comment. Both ride the list row so the seat can render a preview card
    // without a second round-trip per thread.
    const bodyExpr = `(SELECT p.body FROM posts p WHERE p.thread_id = t.id ORDER BY p.id ASC LIMIT 1)`;
    const lastBodyExpr = `(SELECT p.body FROM posts p WHERE p.thread_id = t.id ORDER BY p.id DESC LIMIT 1)`;
    const lastAtExpr = `(SELECT p.created_at FROM posts p WHERE p.thread_id = t.id ORDER BY p.id DESC LIMIT 1)`;
    const lastAuthorExpr = `(SELECT a.handle FROM posts p JOIN agents a ON a.id = p.author_id WHERE p.thread_id = t.id ORDER BY p.id DESC LIMIT 1)`;
    const filter = [...where];
    if (unansweredOnly) filter.push(`${countExpr} <= 1`);
    const whereSql = filter.join(' AND ');

    const pageParams = [...params];
    let paging = '';
    if (limit !== null || offset !== null) {
      if (limit !== null) {
        paging = 'LIMIT ?';
        pageParams.push(limit);
      } else {
        paging = 'LIMIT -1'; // sqlite needs a limit before OFFSET
      }
      if (offset !== null) {
        paging += ' OFFSET ?';
        pageParams.push(offset);
      }
    }
    const sql = `
      SELECT t.*, ${countExpr} AS reply_count,
             ${bodyExpr} AS body,
             ${lastBodyExpr} AS last_body,
             ${lastAtExpr} AS last_at,
             ${lastAuthorExpr} AS last_author
        FROM threads t
       WHERE ${whereSql}
       ORDER BY ${ORDER[sort]}
       ${paging}
    `;
    const threads = ctx.db.all<
      Thread & {
        reply_count: number;
        body: string | null;
        last_body: string | null;
        last_at: string | null;
        last_author: string | null;
      }
    >(sql, ...pageParams);
    const total = ctx.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM threads t WHERE ${whereSql}`,
      ...params,
    );
    return {
      status: 200,
      body: { forum_id: forum.id, threads, total: total?.n ?? threads.length },
    };
  },

  createThread(ctx: Ctx, _m: RegExpExecArray, body: Body, agent: Agent): Result {
    const forum = forumByRef(ctx, body.forum_id ?? body.forum);
    if (!forum) {
      throw badRequest('no forum exists yet — create one first', { field: 'forum_id' });
    }
    const category = body.category === undefined ? 'discussion' : String(body.category);
    if (!['discussion', 'task', 'idea', 'idle', 'announcement'].includes(category)) {
      throw badRequest('category must be discussion|task|idea|idle|announcement', {
        field: 'category',
        value: category,
      });
    }
    const title = String(requireString(body.title, 'title', 200)).trim();
    const text = String(requireString(body.body, 'body', ctx.cfg.postCharLimit));
    if (text.length > ctx.cfg.postCharLimit)
      throw charLimit('body', ctx.cfg.postCharLimit, text.length);
    const mentions = resolveMentions(ctx, body.mentions);

    const { threadId, postId } = ctx.db.tx(() => {
      const t = ctx.db.run(
        'INSERT INTO threads (forum_id, category, title, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        forum.id,
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
        payload: {
          forum_id: forum.id,
          category,
          title,
          post_id: p.lastInsertRowid,
        },
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

  getThread(
    ctx: Ctx,
    m: RegExpExecArray,
    _body: Body,
    agent: Agent,
    query: URLSearchParams,
  ): Result {
    const thread = threadById(ctx, requireInt(m[1], 'thread_id'));
    // Optional reply window (`replies_limit`/`replies_offset`): the web reads
    // the head first (limit 0), then the newest page, so the two sections can
    // land independently. No limit = the whole conversation, as before.
    const limit = optionalInt(query.get('replies_limit'), 'replies_limit', 0, 500);
    const offset =
      optionalInt(query.get('replies_offset'), 'replies_offset', 0, 1_000_000) ?? 0;
    const select = `SELECT p.*, a.handle AS author_handle, a.is_human AS author_is_human
         FROM posts p JOIN agents a ON a.id = p.author_id`;
    const withMeta = (p: Post & { author_handle: string; author_is_human: number }) => ({
      ...p,
      reactions: ctx.db.all(
        `SELECT r.emoji, a.handle AS agent FROM reactions r
         JOIN agents a ON a.id = r.agent_id
        WHERE r.target_type = 'post' AND r.target_id = ? ORDER BY r.id`,
        p.id,
      ),
      mentions: ctx.db
        .all<{ handle: string }>(
          'SELECT a.handle FROM mentions m JOIN agents a ON a.id = m.agent_id WHERE m.post_id = ? ORDER BY a.handle',
          p.id,
        )
        .map((r) => r.handle),
    });

    const total =
      ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM posts WHERE thread_id = ?', thread.id)
        ?.n ?? 0;
    const repliesTotal = Math.max(0, total - 1);

    let rows: (Post & { author_handle: string; author_is_human: number })[] = [];
    if (limit === null) {
      rows = ctx.db.all<Post & { author_handle: string; author_is_human: number }>(
        `${select} WHERE p.thread_id = ? ORDER BY p.created_at, p.id`,
        thread.id,
      );
    } else {
      const op = ctx.db.get<Post & { author_handle: string; author_is_human: number }>(
        `${select} WHERE p.thread_id = ? ORDER BY p.created_at, p.id LIMIT 1`,
        thread.id,
      );
      const replies = ctx.db.all<Post & { author_handle: string; author_is_human: number }>(
        `${select} WHERE p.thread_id = ? AND p.id <> ? ORDER BY p.created_at, p.id LIMIT ? OFFSET ?`,
        thread.id,
        op?.id ?? -1,
        limit,
        offset,
      );
      rows = op ? [op, ...replies] : replies;
    }
    const posts = rows.map(withMeta);

    // Reading the thread marks this seat's mentions in it as read — the inbox
    // badge clears without a second call. The web re-fetches this every poll
    // while the thread is open; MCP forum_read lands here too. The
    // read_at IS NULL guard keeps steady-state polls a no-op.
    ctx.db.run(
      `UPDATE mentions SET read_at = ?
         WHERE agent_id = ? AND read_at IS NULL
           AND post_id IN (SELECT id FROM posts WHERE thread_id = ?)`,
      now(),
      agent.id,
      thread.id,
    );

    const voted = !!ctx.db.get(
      'SELECT 1 FROM thread_votes WHERE thread_id = ? AND agent_id = ?',
      thread.id,
      agent.id,
    );
    return { status: 200, body: { thread, posts, voted, replies_total: repliesTotal } };
  },

  /** One view per call — the web seat fires this once per thread open, not per poll. */
  viewThread(ctx: Ctx, m: RegExpExecArray, _body: Body, agent: Agent): Result {
    const thread = threadById(ctx, requireInt(m[1], 'thread_id'));
    ctx.db.tx(() => {
      ctx.db.run('UPDATE threads SET views = views + 1 WHERE id = ?', thread.id);
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'thread.view',
        target: `thread:${thread.id}`,
      });
    });
    return { status: 200, body: { thread: threadById(ctx, thread.id) } };
  },

  /** Toggle-style upvote: one vote per agent; op=up adds, op=remove retracts. */
  voteThread(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const thread = threadById(ctx, requireInt(m[1], 'thread_id'));
    const op = body.op === undefined ? 'up' : String(body.op);
    if (op !== 'up' && op !== 'remove') {
      throw badRequest('op must be "up" or "remove"', {
        field: 'op',
        value: op,
      });
    }
    const existing = ctx.db.get(
      'SELECT 1 FROM thread_votes WHERE thread_id = ? AND agent_id = ?',
      thread.id,
      agent.id,
    );
    if (op === 'up' && existing) {
      throw conflict(`thread ${thread.id} already voted on by ${agent.handle}`, {
        field: 'op',
        value: op,
      });
    }
    if (op === 'remove' && !existing) {
      throw notFound(`thread ${thread.id} has no vote from ${agent.handle}`, {
        field: 'op',
        value: op,
      });
    }
    ctx.db.tx(() => {
      if (op === 'up') {
        ctx.db.run(
          'INSERT INTO thread_votes (thread_id, agent_id) VALUES (?, ?)',
          thread.id,
          agent.id,
        );
        ctx.db.run('UPDATE threads SET votes = votes + 1 WHERE id = ?', thread.id);
      } else {
        ctx.db.run(
          'DELETE FROM thread_votes WHERE thread_id = ? AND agent_id = ?',
          thread.id,
          agent.id,
        );
        ctx.db.run('UPDATE threads SET votes = MAX(votes - 1, 0) WHERE id = ?', thread.id);
      }
      logEvent(ctx.db, {
        actorId: agent.id,
        action: op === 'up' ? 'thread.vote' : 'thread.unvote',
        target: `thread:${thread.id}`,
      });
    });
    const fresh = threadById(ctx, thread.id);
    return {
      status: op === 'up' ? 201 : 200,
      body: { thread_id: fresh.id, votes: fresh.votes, voted: op === 'up' },
    };
  },

  reply(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const thread = threadById(ctx, requireInt(m[1], 'thread_id'));
    const text = String(requireString(body.body, 'body', ctx.cfg.postCharLimit));
    if (text.length > ctx.cfg.postCharLimit)
      throw charLimit('body', ctx.cfg.postCharLimit, text.length);
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

  listCards(
    ctx: Ctx,
    m: RegExpExecArray,
    _body: Body,
    _agent: Agent,
    query: URLSearchParams,
  ): Result {
    const board = boardById(ctx, requireInt(m[1], 'board_id'));
    const where: string[] = ['c.board_id = ?'];
    const params: unknown[] = [board.id];

    const column = query.get('column');
    if (column) {
      const col = /^\d+$/.test(column)
        ? ctx.db.get<Column>('SELECT * FROM columns WHERE id = ?', Number(column))
        : ctx.db.get<Column>(
            'SELECT * FROM columns WHERE board_id = ? AND name = ?',
            board.id,
            column,
          );
      if (!col)
        throw notFound(`column ${column} does not exist on board ${board.id}`, {
          column,
        });
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
      Card & {
        column_name: string;
        assignee_handle: string | null;
        creator_handle: string;
      }
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
    const cardBody = typeof body.body === 'string' ? body.body : '';
    if (cardBody.length > ctx.cfg.cardBodyCharLimit) {
      throw charLimit('body', ctx.cfg.cardBodyCharLimit, cardBody.length);
    }

    const cols = columnsOf(ctx, board.id);
    let column: Column | undefined;
    if (body.column_id !== undefined && body.column_id !== null && body.column_id !== '') {
      column = columnById(ctx, requireInt(body.column_id, 'column_id'));
      if (column.board_id !== board.id) {
        throw badRequest(`column ${column.id} is not on board ${board.id}`, {
          field: 'column_id',
        });
      }
    } else if (typeof body.column === 'string') {
      const byName = ctx.db.get<Column>(
        'SELECT * FROM columns WHERE board_id = ? AND name = ?',
        board.id,
        body.column,
      );
      if (!byName)
        throw notFound(`column "${body.column}" not on board "${board.name}"`, {
          column: body.column,
        });
      column = byName;
    } else {
      column = cols[0];
    }
    if (!column)
      throw badRequest(`board ${board.id} has no columns`, {
        field: 'column_id',
      });

    const assignee = agentByRef(ctx, body.assignee, 'assignee');

    const cardId = ctx.db.tx(() => {
      const position = nextCardPosition(ctx, column!.id);
      const r = ctx.db.run(
        `INSERT INTO cards (board_id, column_id, position, title, body, assignee_id, created_by, created_at, updated_at, done_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        board.id,
        column!.id,
        position,
        title,
        cardBody,
        assignee ? assignee.id : null,
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

    return {
      status: 201,
      body: {
        card: ctx.db.get<Card>('SELECT * FROM cards WHERE id = ?', cardId),
      },
    };
  },

  patchCard(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const card = cardById(ctx, requireInt(m[1], 'card_id'));
    const before = { ...card };

    let columnId = card.column_id;
    let position = card.position;
    let title = card.title;
    let cardBody = card.body;
    let assigneeId = card.assignee_id;
    let doneAt = card.done_at;
    let blockedAt = card.blocked_at;

    const columnChanged =
      body.column_id !== undefined &&
      body.column_id !== null &&
      requireInt(body.column_id, 'column_id') !== card.column_id;

    if (body.column_id !== undefined && body.column_id !== null && body.column_id !== '') {
      const col = columnById(ctx, requireInt(body.column_id, 'column_id'));
      if (col.board_id !== card.board_id) {
        throw badRequest(`column ${col.id} is not on card ${card.id}'s board`, {
          field: 'column_id',
        });
      }
      columnId = col.id;
    }
    if (body.title !== undefined) title = String(requireString(body.title, 'title', 200)).trim();
    if (body.body !== undefined) {
      cardBody = typeof body.body === 'string' ? body.body : '';
      if (cardBody.length > ctx.cfg.cardBodyCharLimit) {
        throw charLimit('body', ctx.cfg.cardBodyCharLimit, cardBody.length);
      }
    }
    if (body.assignee !== undefined) {
      assigneeId =
        body.assignee === null || body.assignee === ''
          ? null
          : (agentByRef(ctx, body.assignee, 'assignee')?.id ?? null);
    }
    if (body.done !== undefined) {
      doneAt = body.done === true || body.done === 1 || body.done === 'true' ? now() : null;
    }
    if (body.blocked !== undefined) {
      const blocked = body.blocked === true || body.blocked === 1 || body.blocked === 'true';
      blockedAt = blocked ? (card.blocked_at ?? now()) : null;
    }
    if (body.position !== undefined && body.position !== null && body.position !== '') {
      position = requireInt(body.position, 'position');
    } else if (columnChanged) {
      position = nextCardPosition(ctx, columnId);
    }

    ctx.db.tx(() => {
      ctx.db.run(
        `UPDATE cards SET column_id = ?, position = ?, title = ?, body = ?,
                          assignee_id = ?, updated_at = ?, done_at = ?, blocked_at = ?
         WHERE id = ?`,
        columnId,
        position,
        title,
        cardBody,
        assigneeId,
        now(),
        doneAt,
        blockedAt,
        card.id,
      );
      if (columnChanged) {
        logEvent(ctx.db, {
          actorId: agent.id,
          action: 'card.move',
          target: `card:${card.id}`,
          payload: {
            from_column: before.column_id,
            to_column: columnId,
            position,
          },
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
      if (blockedAt !== before.blocked_at) {
        logEvent(ctx.db, {
          actorId: agent.id,
          action: blockedAt ? 'card.block' : 'card.unblock',
          target: `card:${card.id}`,
          payload: { blocked_at: blockedAt },
        });
      }
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'card.update',
        target: `card:${card.id}`,
        payload: {
          title,
          done_at: doneAt,
          changed: diffKeys(before, {
            column_id: columnId,
            position,
            title,
            body: cardBody,
            assignee_id: assigneeId,
            done_at: doneAt,
            blocked_at: blockedAt,
          }),
        },
      });
    });

    return {
      status: 200,
      body: {
        card: ctx.db.get<Card>('SELECT * FROM cards WHERE id = ?', card.id),
      },
    };
  },

  /**
   * Delete a card outright. Reactions are plain rows so they go first, and
   * the rest of the column closes the gap so positions stay dense.
   */
  deleteCard(ctx: Ctx, m: RegExpExecArray, _body: Body, agent: Agent): Result {
    const card = cardById(ctx, requireInt(m[1], 'card_id'));
    ctx.db.tx(() => {
      ctx.db.run(`DELETE FROM reactions WHERE target_type = 'card' AND target_id = ?`, card.id);
      ctx.db.run('DELETE FROM cards WHERE id = ?', card.id);
      const rest = ctx.db.all<Card>(
        'SELECT * FROM cards WHERE column_id = ? ORDER BY position',
        card.column_id,
      );
      rest.forEach((c, i) => {
        if (c.position !== i) {
          ctx.db.run('UPDATE cards SET position = ? WHERE id = ?', i, c.id);
        }
      });
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'card.delete',
        target: `card:${card.id}`,
        payload: {
          board_id: card.board_id,
          column_id: card.column_id,
          title: card.title,
        },
      });
    });
    return { status: 200, body: { ok: true, id: card.id } };
  },

  reactToCard(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const card = cardById(ctx, requireInt(m[1], 'card_id'));
    return applyReaction(ctx, 'card', card.id, body, agent);
  },

  /** The card's own conversation — newest last, so the composer sits at the end. */
  listCardComments(ctx: Ctx, m: RegExpExecArray): Result {
    const card = cardById(ctx, requireInt(m[1], 'card_id'));
    const comments = ctx.db.all<CardComment & { author_handle: string; author_is_human: number }>(
      `SELECT c.*, a.handle AS author_handle, a.is_human AS author_is_human
         FROM card_comments c
         JOIN agents a ON a.id = c.author_id
        WHERE c.card_id = ?
        ORDER BY c.created_at, c.id`,
      card.id,
    );
    return { status: 200, body: { card_id: card.id, comments } };
  },

  addCardComment(ctx: Ctx, m: RegExpExecArray, body: Body, agent: Agent): Result {
    const card = cardById(ctx, requireInt(m[1], 'card_id'));
    const text = String(requireString(body.body, 'body', ctx.cfg.postCharLimit));
    if (text.length > ctx.cfg.postCharLimit) {
      throw charLimit('body', ctx.cfg.postCharLimit, text.length);
    }

    const commentId = ctx.db.tx(() => {
      const r = ctx.db.run(
        'INSERT INTO card_comments (card_id, author_id, body, created_at) VALUES (?, ?, ?, ?)',
        card.id,
        agent.id,
        text,
        now(),
      );
      logEvent(ctx.db, {
        actorId: agent.id,
        action: 'comment.create',
        target: `card:${card.id}`,
        payload: { comment_id: r.lastInsertRowid, card_id: card.id },
      });
      return r.lastInsertRowid;
    });

    return {
      status: 201,
      body: {
        comment: ctx.db.get<CardComment & { author_handle: string; author_is_human: number }>(
          `SELECT c.*, a.handle AS author_handle, a.is_human AS author_is_human
             FROM card_comments c
             JOIN agents a ON a.id = c.author_id
            WHERE c.id = ?`,
          commentId,
        ),
      },
    };
  },

  inbox(ctx: Ctx, m: RegExpExecArray, _body: Body, _agent: Agent): Result {
    const ref = decodeURIComponent(m[1]).replace(/^@/, '');
    const agent = ctx.db.get<Agent>(
      'SELECT * FROM agents WHERE handle = ? OR id = ?',
      ref,
      Number(ref) || -1,
    );
    if (!agent) throw notFound(`agent ${ref} does not exist`, { handle: ref });

    const mentions = ctx.db.all(
      `SELECT m.id AS mention_id, m.read_at, p.id AS post_id, p.body, p.created_at,
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
         JOIN boards   b ON b.id  = c.board_id
        WHERE c.assignee_id = ? AND c.done_at IS NULL
        ORDER BY c.updated_at DESC, c.id DESC`,
      agent.id,
    );
    // counts come from COUNT(*), not the LIMIT-100 window
    const tally = ctx.db.get<{ total: number; unread: number }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END), 0) AS unread
         FROM mentions WHERE agent_id = ?`,
      agent.id,
    )!;
    return {
      status: 200,
      body: {
        handle: agent.handle,
        is_human: agent.is_human === 1,
        mentions,
        cards,
        counts: { mentions: tally.unread, mentions_total: tally.total, cards: cards.length },
      },
    };
  },

  /** Clear every unread mention for the caller's own inbox (self-only). */
  readInbox(ctx: Ctx, m: RegExpExecArray, _body: Body, agent: Agent): Result {
    const ref = decodeURIComponent(m[1]).replace(/^@/, '');
    const target = ctx.db.get<Agent>(
      'SELECT * FROM agents WHERE handle = ? OR id = ?',
      ref,
      Number(ref) || -1,
    );
    if (!target) throw notFound(`agent ${ref} does not exist`, { handle: ref });
    if (target.id !== agent.id)
      throw forbidden('you can only mark your own mentions as read', { handle: ref });
    const r = ctx.db.run(
      'UPDATE mentions SET read_at = ? WHERE agent_id = ? AND read_at IS NULL',
      now(),
      agent.id,
    );
    return { status: 200, body: { ok: true, marked: r.changes } };
  },
} satisfies Record<string, Handler>;

function diffKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

function applyReaction(
  ctx: Ctx,
  targetType: 'post' | 'card',
  targetId: number,
  body: Body,
  agent: Agent,
): Result {
  const emoji = String(requireString(body.emoji, 'emoji', 32)).trim();
  const op = body.op === undefined ? 'add' : String(body.op);
  if (op !== 'add' && op !== 'remove') {
    throw badRequest('op must be "add" or "remove"', {
      field: 'op',
      value: op,
    });
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
  return {
    status: op === 'add' ? 201 : 200,
    body: {
      target_type: targetType,
      target_id: targetId,
      op,
      emoji,
      reactions: rows,
    },
  };
}

// ---------------------------------------------------------------------------
// route table (order matters only where prefixes overlap; these do not)
// ---------------------------------------------------------------------------

export const ROUTES: Route[] = [
  { method: 'GET', re: /^\/api\/me$/, auth: true, h: handlers.me },
  { method: 'POST', re: /^\/api\/login$/, auth: false, h: handlers.login },
  { method: 'GET', re: /^\/api\/config$/, auth: false, h: handlers.config },
  { method: 'POST', re: /^\/api\/setup$/, auth: false, h: handlers.setup },
  {
    method: 'PATCH',
    re: /^\/api\/settings$/,
    auth: true,
    h: handlers.patchSettings,
  },
  {
    method: 'POST',
    re: /^\/api\/settings\/password$/,
    auth: true,
    h: handlers.changePassword,
  },
  { method: 'POST', re: /^\/api\/agents$/, auth: false, h: handlers.register },
  { method: 'GET', re: /^\/api\/agents$/, auth: true, h: handlers.listAgents },
  { method: 'GET', re: /^\/api\/events$/, auth: true, h: handlers.events },

  { method: 'GET', re: /^\/api\/boards$/, auth: true, h: handlers.listBoards },
  {
    method: 'PATCH',
    re: /^\/api\/boards\/(\d+)$/,
    auth: true,
    h: handlers.updateBoard,
  },
  {
    method: 'DELETE',
    re: /^\/api\/boards\/(\d+)$/,
    auth: true,
    h: handlers.deleteBoard,
  },
  {
    method: 'POST',
    re: /^\/api\/boards$/,
    auth: true,
    h: handlers.createBoard,
  },

  { method: 'GET', re: /^\/api\/forums$/, auth: true, h: handlers.listForums },
  {
    method: 'POST',
    re: /^\/api\/forums$/,
    auth: true,
    h: handlers.createForum,
  },
  {
    method: 'GET',
    re: /^\/api\/forums\/(\d+)\/overview$/,
    auth: true,
    h: handlers.forumOverview,
  },
  {
    method: 'GET',
    re: /^\/api\/forums\/(\d+)\/threads$/,
    auth: true,
    h: handlers.listThreads,
  },

  { method: 'GET', re: /^\/api\/projects$/, auth: true, h: handlers.listProjects },
  {
    method: 'PATCH',
    re: /^\/api\/projects\/(\d+)$/,
    auth: true,
    h: handlers.updateProject,
  },
  {
    method: 'POST',
    re: /^\/api\/projects$/,
    auth: true,
    h: handlers.createProject,
  },

  {
    method: 'POST',
    re: /^\/api\/boards\/(\d+)\/columns$/,
    auth: true,
    h: handlers.manageColumns,
  },
  {
    method: 'DELETE',
    re: /^\/api\/columns\/(\d+)$/,
    auth: true,
    h: handlers.deleteColumn,
  },
  {
    method: 'GET',
    re: /^\/api\/boards\/(\d+)\/cards$/,
    auth: true,
    h: handlers.listCards,
  },

  {
    method: 'POST',
    re: /^\/api\/threads$/,
    auth: true,
    h: handlers.createThread,
  },
  {
    method: 'GET',
    re: /^\/api\/threads\/(\d+)$/,
    auth: true,
    h: handlers.getThread,
  },
  {
    method: 'POST',
    re: /^\/api\/threads\/(\d+)\/view$/,
    auth: true,
    h: handlers.viewThread,
  },
  {
    method: 'POST',
    re: /^\/api\/threads\/(\d+)\/vote$/,
    auth: true,
    h: handlers.voteThread,
  },
  {
    method: 'POST',
    re: /^\/api\/threads\/(\d+)\/replies$/,
    auth: true,
    h: handlers.reply,
  },

  {
    method: 'POST',
    re: /^\/api\/posts\/(\d+)\/reactions$/,
    auth: true,
    h: handlers.reactToPost,
  },

  { method: 'POST', re: /^\/api\/cards$/, auth: true, h: handlers.createCard },
  {
    method: 'PATCH',
    re: /^\/api\/cards\/(\d+)$/,
    auth: true,
    h: handlers.patchCard,
  },
  {
    method: 'DELETE',
    re: /^\/api\/cards\/(\d+)$/,
    auth: true,
    h: handlers.deleteCard,
  },
  {
    method: 'POST',
    re: /^\/api\/cards\/(\d+)\/reactions$/,
    auth: true,
    h: handlers.reactToCard,
  },
  {
    method: 'GET',
    re: /^\/api\/cards\/(\d+)\/comments$/,
    auth: true,
    h: handlers.listCardComments,
  },
  {
    method: 'POST',
    re: /^\/api\/cards\/(\d+)\/comments$/,
    auth: true,
    h: handlers.addCardComment,
  },

  {
    method: 'GET',
    re: /^\/api\/inbox\/([^/]+)$/,
    auth: true,
    h: handlers.inbox,
  },

  {
    method: 'POST',
    re: /^\/api\/inbox\/([^/]+)\/read$/,
    auth: true,
    h: handlers.readInbox,
  },
];
