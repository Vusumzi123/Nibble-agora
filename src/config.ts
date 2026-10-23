import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  bind: string;
  port: number;
  dataDir: string;
  dbFile: string;
  dbPath: string;
  defaultBoard: string;
  defaultBoardName: string;
  defaultBoardDescription: string;
  rootHandle: string;
  rootPassword: string;
  defaultTheme: string;
  defaultAccent: string;
  defaultLocale: string;
  postCharLimit: number;
  cardBodyCharLimit: number;
  maxBodyBytes: number;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** Themes the seat ships with — light mode + its dark face (data-theme). */
export const THEMES = ['nibble', 'nibble-dark'] as const;
export type ThemeId = (typeof THEMES)[number];
export const isTheme = (value: unknown): value is ThemeId =>
  typeof value === 'string' && (THEMES as readonly string[]).includes(value);

/** Accent choices — re-points --ph-primary via data-accent (see web/src/themes/accents.css). */
export const ACCENTS = ['violet', 'ocean', 'teal', 'green', 'amber', 'rose'] as const;
export type AccentId = (typeof ACCENTS)[number];
export const isAccent = (value: unknown): value is AccentId =>
  typeof value === 'string' && (ACCENTS as readonly string[]).includes(value);

/** Locales the app can render. The second catalog lands with the i18n conversion. */
export const LOCALES = ['en'] as const;
export type LocaleId = (typeof LOCALES)[number];
export const isLocale = (value: unknown): value is LocaleId =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

const DEFAULTS: Record<string, string> = {
  bind: '127.0.0.1',
  port: '7430',
  data_dir: 'data',
  db_file: 'agora.db',
  default_board: 'agora',
  default_board_name: 'Agora',
  default_board_description: '',
  root_handle: 'root',
  root_password: '',
  theme: 'nibble',
  accent: 'violet',
  locale: 'en',
  post_char_limit: '512',
  card_body_char_limit: '4000',
  max_body_bytes: '65536',
};

/** Flat `key: value` subset of YAML — deliberately minimal, no dependency. */
export function parseFlatYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line || line.trimStart().startsWith('#')) continue;
    const m = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let value = m[2].trim();
    if (value.startsWith('#')) value = '';
    if (value.length >= 2) {
      const q = value[0];
      if ((q === '"' || q === "'") && value.endsWith(q)) value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

function int(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`config: ${name} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return n;
}

export interface LoadOptions {
  configPath?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
}

/** Load `config.yaml`, then apply `AGORA_*` env overrides. */
export function loadConfig(opts: LoadOptions = {}): Config {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? ROOT;
  const configPath = env.AGORA_CONFIG ?? opts.configPath ?? path.join(cwd, 'config.yaml');

  const raw: Record<string, string> = { ...DEFAULTS };
  try {
    Object.assign(raw, parseFlatYaml(readFileSync(configPath, 'utf8')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || opts.configPath) {
      throw new Error(`config: cannot read ${configPath}: ${String(err)}`);
    }
  }

  const dataDir = env.AGORA_DATA_DIR ?? raw.data_dir;
  const dbFile = env.AGORA_DB ?? raw.db_file;

  return {
    bind: env.AGORA_HOST ?? raw.bind,
    port: int(env.AGORA_PORT, int(raw.port, 7430, 'port'), 'port'),
    dataDir,
    dbFile,
    dbPath: path.isAbsolute(dataDir)
      ? path.join(dataDir, dbFile)
      : path.resolve(cwd, dataDir, dbFile),
    defaultBoard: raw.default_board,
    defaultBoardName: raw.default_board_name,
    defaultBoardDescription: raw.default_board_description,
    rootHandle: env.AGORA_ROOT_HANDLE ?? raw.root_handle,
    rootPassword: env.AGORA_ROOT_PASSWORD ?? raw.root_password,
    defaultTheme: isTheme(raw.theme) ? raw.theme : 'nibble',
    defaultAccent: isAccent(raw.accent) ? raw.accent : 'violet',
    defaultLocale: isLocale(raw.locale) ? raw.locale : 'en',
    postCharLimit: int(raw.post_char_limit, 512, 'post_char_limit'),
    cardBodyCharLimit: int(raw.card_body_char_limit, 4000, 'card_body_char_limit'),
    maxBodyBytes: int(raw.max_body_bytes, 65536, 'max_body_bytes'),
  };
}
