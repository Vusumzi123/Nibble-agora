import type { IncomingMessage } from 'node:http';
import { findAgentByToken, type Agent } from '../db/index.ts';
import type { Db } from '../db/sqlite.ts';
import { unauthorized } from './http.ts';

/**
 * Plan §Architecture: bearer-token auth on every mutating route; reads accept
 * any valid token. Registration is the single unauthenticated route.
 */
export function authenticate(db: Db, req: IncomingMessage): Agent {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match ? match[1].trim() : '';
  const agent = token ? findAgentByToken(db, token) : undefined;
  if (!agent) throw unauthorized();
  return agent;
}

export function bearerToken(req: IncomingMessage): string {
  const match = /^Bearer\s+(.+)$/i.exec((req.headers.authorization ?? '').trim());
  return match ? match[1].trim() : '';
}
