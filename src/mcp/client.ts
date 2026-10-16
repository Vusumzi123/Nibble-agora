/**
 * Thin authenticated REST client — the MCP bridge never touches the DB
 * (plan §Architecture: single writer, the HTTP service only).
 */
export interface RestErrorInfo {
  status: number;
  code: string;
  message: string;
}

export class RestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'RestError';
    this.status = status;
    this.code = code;
  }
}

export type Query = Record<string, string | number | boolean | undefined>;

export class AgoraClient {
  private readonly base: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    query?: Query,
  ): Promise<T> {
    const url = new URL(this.base + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
      }
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new RestError(0, 'unreachable', `agora service unreachable at ${this.base}: ${String(err)}`);
    }

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const err = (parsed as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new RestError(
        res.status,
        err?.code ?? `http_${res.status}`,
        err?.message ?? text ?? `HTTP ${res.status}`,
      );
    }
    return parsed as T;
  }

  get<T = Record<string, unknown>>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  post<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body ?? {});
  }

  patch<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body ?? {});
  }
}

export interface Column {
  id: number;
  board_id: number;
  name: string;
  position: number;
  wip_limit: number | null;
}

export interface Board {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  project_id: number | null;
  forum_id: number | null;
  columns: Column[];
}

export interface Forum {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  projects?: number;
  threads?: number;
}

/**
 * Resolve a forum by id, slug or name; no ref → AGORA_FORUM (default "forum"),
 * then the first forum that exists.
 */
export async function resolveForum(
  client: AgoraClient,
  ref?: string | number,
  defaultRef = process.env.AGORA_FORUM ?? 'forum',
): Promise<Forum> {
  const { forums } = await client.get<{ forums: Forum[] }>('/api/forums');
  if (forums.length === 0) {
    throw new RestError(404, 'not_found', 'no forums exist yet — create one first');
  }
  const key = String(ref ?? defaultRef).trim().toLowerCase();
  const forum =
    forums.find(
      (f) => String(f.id) === key || f.slug.toLowerCase() === key || f.name.toLowerCase() === key,
    ) ?? (ref === undefined ? forums[0] : undefined);
  if (!forum) {
    throw new RestError(
      404,
      'not_found',
      `forum "${key}" not found (available: ${forums.map((f) => f.slug).join(', ')})`,
    );
  }
  return forum;
}

/**
 * Resolve a board by id, slug or name; no ref → AGORA_BOARD (default "agora"),
 * mirroring the server-side default-board config (plan: "a default board in
 * config so simple calls stay short").
 */
export async function resolveBoard(
  client: AgoraClient,
  ref?: string | number,
  defaultRef = process.env.AGORA_BOARD ?? 'agora',
): Promise<Board> {
  const { boards } = await client.get<{ boards: Board[] }>('/api/boards');
  const key = String(ref ?? defaultRef).trim().toLowerCase();
  const board = boards.find(
    (b) => String(b.id) === key || b.slug.toLowerCase() === key || b.name.toLowerCase() === key,
  );
  if (!board) {
    throw new RestError(
      404,
      'not_found',
      `board "${key}" not found (available: ${boards.map((b) => b.slug).join(', ')})`,
    );
  }
  return board;
}

/** Resolve a column within a board by id or name. */
export function resolveColumn(board: Board, ref: string | number): Column {
  const key = String(ref).trim().toLowerCase();
  const col = board.columns.find(
    (c) => String(c.id) === key || c.name.toLowerCase() === key,
  );
  if (!col) {
    throw new RestError(
      404,
      'not_found',
      `column "${ref}" not found on board "${board.name}" (available: ${board.columns
        .map((c) => c.name)
        .join(', ')})`,
    );
  }
  return col;
}
