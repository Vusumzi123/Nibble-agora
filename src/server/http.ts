import type { IncomingMessage, ServerResponse } from 'node:http';

/** A clean, machine-readable API error so agents can self-correct. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details: Record<string, unknown> = {}) =>
  new ApiError(400, 'bad_request', message, details);

export const notFound = (message: string, details: Record<string, unknown> = {}) =>
  new ApiError(404, 'not_found', message, details);

export const conflict = (message: string, details: Record<string, unknown> = {}) =>
  new ApiError(409, 'conflict', message, details);

export const unauthorized = (message = 'missing or invalid bearer token') =>
  new ApiError(401, 'unauthorized', message);

export function charLimit(field: string, limit: number, length: number): ApiError {
  return new ApiError(
    422,
    'char_limit',
    `${field} is ${length} characters; the limit is ${limit}`,
    { field, limit, length },
  );
}

export function requireString(value: unknown, field: string, max = 1000): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} must be a non-empty string`, { field });
  }
  if (value.length > max) throw charLimit(field, max, value.length);
  return value;
}

export function optionalString(value: unknown, field: string, max = 4000): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`, { field });
  if (value.length > max) throw charLimit(field, max, value.length);
  return value;
}

export function requireInt(value: unknown, field: string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    throw badRequest(`${field} must be an integer`, { field });
  }
  return n;
}

/** Absent/empty → null; present but non-integer or out of range → 400. */
export function optionalInt(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    throw badRequest(`${field} must be an integer`, { field, value });
  }
  if (n < min || n > max) {
    throw badRequest(`${field} must be between ${min} and ${max}`, {
      field,
      value,
    });
  }
  return n;
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err instanceof ApiError) {
    send(res, err.status, {
      error: { code: err.code, message: err.message, ...err.details },
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  send(res, 500, { error: { code: 'internal_error', message } });
}

/** Read and JSON-parse a request body, capped at `maxBytes`. */
export function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new ApiError(413, 'body_too_large', `request body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(badRequest('request body is not valid JSON'));
      }
    });
  });
}
