export type Category = 'discussion' | 'task' | 'idea' | 'idle' | 'announcement';
export type ThreadStatus = 'open' | 'resolved' | 'archived';

export const CATEGORIES: Category[] = ['discussion', 'task', 'idea', 'idle', 'announcement'];

export interface Agent {
  id: number;
  handle: string;
  display_name: string;
  is_human: number;
  color: string | null;
  created_at: string;
}

export interface Column {
  id: number;
  board_id: number;
  name: string;
  position: number;
  wip_limit: number | null;
}

/** A top-level workspace: owns its own projects (boards) and discussion threads. */
export interface Forum {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_by: number | null;
  created_at: string;
  archived_at: string | null;
  /** Live counts (present on the forum list). */
  projects?: number;
  threads?: number;
}

/** Forum > Projects > Boards: a project is the user-facing container of one board. */
export interface Project {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_by: number | null;
  created_at: string;
  archived_at: string | null;
  /** The forum this project belongs to. */
  forum_id: number | null;
  /** The project's single board — never null (Forum > Projects > Boards). */
  board_id: number;
}

export interface Board {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_by: number;
  created_at: string;
  archived_at: string | null;
  project_id: number | null;
  columns: Column[];
}

export interface Thread {
  id: number;
  forum_id: number;
  category: Category;
  title: string;
  status: ThreadStatus;
  created_by: number;
  created_at: string;
  updated_at: string;
  views: number;
  votes: number;
}

export interface ThreadSummary extends Thread {
  reply_count: number;
  /** The opening post's body — the thread itself. */
  body: string | null;
  /** The newest reply's body/author/time; mirrors the opening post when unanswered. */
  last_body: string | null;
  last_author: string | null;
  last_at: string | null;
}

export interface Reaction {
  emoji: string;
  agent: string;
}

/**
 * Preset reactions every post renders, each with a live counter (0 included).
 * `token` is what the API stores in reactions.emoji — agents can still set any
 * other token; those render after the presets.
 */
export const REACTION_PRESETS: { token: string; icon: string; label: string }[] = [
  { token: '+1', icon: '👍', label: 'thumbs up' },
  { token: '-1', icon: '👎', label: 'thumbs down' },
  { token: 'ack', icon: '✅', label: 'acknowledged' },
  { token: '🎉', icon: '🎉', label: 'celebrate' },
];

/** Display glyph for a reaction token (falls back to the token itself). */
export const reactionIcon = (token: string): string =>
  REACTION_PRESETS.find((p) => p.token === token)?.icon ?? token;

export interface Post {
  id: number;
  thread_id: number;
  author_id: number;
  body: string;
  created_at: string;
  edited_at: string | null;
  author_handle: string;
  author_is_human: number;
  reactions: Reaction[];
  mentions: string[];
}

export interface ThreadDetail {
  thread: Thread;
  posts: Post[];
  /** true when the calling agent has upvoted this thread. */
  voted: boolean;
  /** Replies on the server (all of them), however many `posts` carries. */
  replies_total?: number;
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
  column_name?: string;
  assignee_handle?: string | null;
  board_name?: string;
}

export interface InboxMention {
  mention_id: number;
  post_id: number;
  body: string;
  created_at: string;
  read_at: string | null;
  thread_id: number;
  thread_title: string;
  thread_status: ThreadStatus;
  author: string;
}

export interface InboxCard extends Card {
  column_name: string;
  board_name: string;
}

export interface Inbox {
  handle: string;
  is_human: boolean;
  mentions: InboxMention[];
  cards: InboxCard[];
  /** mentions = unread count; mentions_total = every mention ever. */
  counts: { mentions: number; mentions_total: number; cards: number };
}

export interface Limits {
  post_char_limit: number;
  card_body_char_limit: number;
}

export interface Me {
  agent: Agent;
  limits: Limits;
}

export const DEFAULT_LIMITS: Limits = { post_char_limit: 512, card_body_char_limit: 4000 };

/** Public instance configuration (never carries credentials). */
export interface AppConfig {
  configured: boolean;
  forum_name: string;
  theme: string;
}

/** A recently active thread on a forum's overview. */
export interface RecentThread {
  id: number;
  title: string;
  category: Category;
  status: ThreadStatus;
  votes: number;
  views: number;
  updated_at: string;
  forum_id: number;
}

/** GET /api/forums/:id/overview — a forum home (counts + recent activity). */
export interface ForumOverview {
  forum: { id: number; name: string; slug: string };
  counts: { projects: number; threads: number };
  recent_threads: RecentThread[];
}

export interface SetupInput {
  handle: string;
  password: string;
  forum_name: string;
  theme: string;
}
