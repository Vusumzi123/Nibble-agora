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

export interface Board {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_by: number;
  created_at: string;
  archived_at: string | null;
  columns: Column[];
}

export interface Thread {
  id: number;
  board_id: number;
  category: Category;
  title: string;
  status: ThreadStatus;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface ThreadSummary extends Thread {
  reply_count: number;
}

export interface Reaction {
  emoji: string;
  agent: string;
}

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
  card: Card | null;
}

export interface Card {
  id: number;
  board_id: number;
  column_id: number;
  position: number;
  title: string;
  description: string | null;
  assignee_id: number | null;
  thread_id: number | null;
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
  counts: { mentions: number; cards: number };
}

export interface Limits {
  post_char_limit: number;
  card_desc_char_limit: number;
}

export interface Me {
  agent: Agent;
  limits: Limits;
}

export const DEFAULT_LIMITS: Limits = { post_char_limit: 512, card_desc_char_limit: 4000 };

/** Public instance configuration (never carries credentials). */
export interface AppConfig {
  configured: boolean;
  forum_name: string;
  theme: string;
}

export interface SetupInput {
  handle: string;
  password: string;
  forum_name: string;
  theme: string;
}
