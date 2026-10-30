import { readFileSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Angular build output (`web/` project) — produced by `npm run build:web`. */
const WEB_ROOT = path.resolve(HERE, '..', '..', 'web', 'dist', 'agora', 'browser');
const INDEX = path.join(WEB_ROOT, 'index.html');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function isFile(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

/** Resolve a URL path to a file inside WEB_ROOT, or null on traversal. */
function resolveWeb(pathname: string): string | null {
  const rel = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (rel.includes('\0')) return null;
  const abs = path.resolve(WEB_ROOT, rel);
  // Traversal guard: the resolved path must stay inside the build output.
  if (abs !== WEB_ROOT && !abs.startsWith(WEB_ROOT + path.sep)) return null;
  return abs;
}

function sendFile(res: ServerResponse, abs: string): boolean {
  const type = CONTENT_TYPES[path.extname(abs)] ?? 'application/octet-stream';
  try {
    const body = readFileSync(abs);
    res.writeHead(200, {
      'content-type': type,
      'content-length': body.byteLength,
      // The Angular entry document must never be cached across rebuilds.
      'cache-control': 'no-store',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serve a GET for the built Angular seat. Falls back to `index.html` for
 * client-side routes (deep links such as `/board` or `/threads/12`).
 * Returns true when the response was written; false = caller decides (404).
 */
export function serveStatic(res: ServerResponse, pathname: string): boolean {
  const abs = resolveWeb(pathname);
  if (abs && abs !== WEB_ROOT && isFile(abs)) return sendFile(res, abs);

  // SPA fallback — only for extension-less paths, never for missing assets.
  if (!path.extname(pathname) && isFile(INDEX)) return sendFile(res, INDEX);
  return false;
}
