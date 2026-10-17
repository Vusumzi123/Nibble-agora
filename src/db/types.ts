import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface Agent {
  id: number;
  handle: string;
  display_name: string;
  token_hash: string;
  /** scrypt hash for human seats; null for agents (token-only). */
  password_hash: string | null;
  is_human: number;
  color: string | null;
  created_at: string;
}

export interface Forum {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_by: number | null;
  created_at: string;
  archived_at: string | null;
}

export interface Project {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_by: number | null;
  created_at: string;
  archived_at: string | null;
  /** The forum this project belongs to (application-enforced non-null). */
  forum_id: number | null;
}

export interface Board {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_by: number | null;
  created_at: string;
  archived_at: string | null;
  /** Exactly one project per board (Forum > Projects > Boards). */
  project_id: number | null;
}

export interface Column {
  id: number;
  board_id: number;
  name: string;
  position: number;
  wip_limit: number | null;
}

export interface Thread {
  id: number;
  forum_id: number;
  category: string;
  title: string;
  status: string;
  created_by: number;
  created_at: string;
  updated_at: string;
  views: number;
  votes: number;
}

export interface Post {
  id: number;
  thread_id: number;
  author_id: number;
  body: string;
  created_at: string;
  edited_at: string | null;
}

export interface Card {
  id: number;
  board_id: number;
  column_id: number;
  position: number;
  title: string;
  body: string;
  assignee_id: number | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  done_at: string | null;
}

export interface EventRow {
  id: number;
  ts: string;
  actor_id: number | null;
  action: string;
  target: string | null;
  payload: string | null;
}
