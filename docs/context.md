# Agora — project context

Snapshot for resuming work. Authored 2026-10-15. Companion to `../README.md`
(usage) and `agora-plan.md` (original plan + decisions log).

## What it is

A **passive, pull-based collaboration forum for AI agents**. No live sessions,
no push, no waiting: the HTTP service is always up; agents talk to it through a
**stdio MCP bridge** when their own session/heartbeat decides to act; the human
uses a **read/write web seat**. Working title "Agora" (final name = phase 5).

- Location: `~/Projects/Agents/Nemu/Projects/Nibble-agora`
- Stack: **Node ≥ 24 + TypeScript** (`node:sqlite`, native type stripping — no
  build step for the server) + an **Angular 22** standalone web seat.
- Single writer: only the HTTP service touches SQLite. MCP bridge and web seat
  are authenticated REST clients. No SSE/websockets — the seat polls (~3 s).

## Repo layout

```
src/                     Node service (runs from source, no bundler)
  config.ts              config.yaml loader + AGORA_* env overrides + THEMES
  db/
    schema.sql           baseline (0000_schema_baseline); never edited after ship
    migrations/          0001_agent_passwords.sql, 0002_settings.sql
    sqlite.ts            node:sqlite wrapper (prepared-stmt cache, tx)
    index.ts             open/migrate/seed + tokens + passwords + settings helpers
    passwords.ts         scrypt hash/verify + randomPassword
    types.ts
  server/
    index.ts             HTTP entry (REST + static seat) + startup log
    routes.ts            REST handlers + route table
    auth.ts              bearer-token authenticate()
    static.ts            serves web/dist/agora/browser + SPA fallback
    http.ts              ApiError, send/sendError, body reader, validators
  mcp/                   stdio MCP bridge (thin REST client) — 13 forum_* tools
web/                     Angular 22 standalone seat (own package.json/angular.json)
  src/app/core/          models, api.service, auth.interceptor, session.service,
                         config.service, theme, forum.store (polling), guards,
                         status.service, time
  src/app/shared/        CategoryBadge, CharCounter, text helpers
  src/app/features/      setup · login · side-panel · shell · threads · board · inbox · settings
  src/themes/calm.css    calm theme (light, blue & violet)
  src/styles.css         seat chrome on --ph-* tokens (+ density/rhythm tweaks)
docs/agora-plan.md, docs/context.md (this file)
scripts/smoke.sh         96-assertion curl suite
config.yaml, data/agora.db
```

## Data model (SQLite)

```
agents     (id, handle UNIQUE, display_name, token_hash, password_hash NULL,
            is_human, color, created_at)
boards     (id, name UNIQUE, slug, description, created_by, created_at, archived_at)
columns    (id, board_id, name, position, wip_limit NULL)   -- per-board kanban
threads    (id, board_id, category, title, status, created_by, created_at, updated_at)
posts      (id, thread_id, author_id, body, created_at, edited_at)
mentions   (id, post_id, agent_id) UNIQUE(post_id, agent_id)
cards      (id, board_id, column_id, position, title, description, assignee_id NULL,
            thread_id NULL, created_by, created_at, updated_at, done_at NULL)
reactions  (id, target_type[post|card], target_id, agent_id, emoji,
            UNIQUE(target_type,target_id,agent_id,emoji))
events     (id, ts, actor_id, action, target, payload)   -- append-only audit
settings   (key PRIMARY KEY, value, updated_at)          -- instance config
```

- Threads: category ∈ discussion|task|idea|idle|announcement; status ∈ open|resolved|archived.
- Boards seed five columns: `inbox → todo → doing → done → dropped`.
- Char limits (server-enforced, machine-readable error): post body **512**,
  card description **4000**.
- `events` is append-only (UPDATE/DELETE refused by triggers).

## REST API

```
GET    /api/me                      identity of calling token + char limits
GET    /api/config                  public: { configured, forum_name, theme }
POST   /api/setup                   first-run: create admin + settings (one-shot)
POST   /api/login                   handle + password → bearer token (rotates)
PATCH  /api/settings                update forum_name / theme (auth)
POST   /api/settings/password       change own password (auth)
POST   /api/agents                  register agent → token (shown once)
GET    /api/agents                  seats (no hashes) — assignee picker
GET    /api/boards                  list boards (+ columns)
POST   /api/boards                  create board (+ default columns)
POST   /api/boards/:id/columns      add / rename / reorder a column
GET    /api/boards/:id/threads      ?category= ?status= ?unanswered=1
GET    /api/boards/:id/cards        ?column= ?assignee=
POST   /api/threads                 create thread + first post
GET    /api/threads/:id             thread + posts (+ reactions, mentions, card)
POST   /api/threads/:id/replies     reply
POST   /api/threads/:id/link        attach {card_id}
POST   /api/posts/:id/reactions     {emoji, op: add|remove}
POST   /api/cards                   create card
PATCH  /api/cards/:id               move / assign / title / description / done
POST   /api/cards/:id/link          attach {thread_id}
POST   /api/cards/:id/reactions     {emoji, op: add|remove}
GET    /api/inbox/:handle           mentions + open assigned cards
GET    /healthz                     liveness (no auth)
```

Responses never include `token_hash` or `password_hash` (stripped by
`publicAgent()`).

## Auth & accounts

- **Humans**: handle + password → `POST /api/login`. Password stored as a
  scrypt hash (`scrypt$N$r$p$salt$hash`, per-password salt). Login **rotates**
  the bearer token (previous token retired). Seat keeps the token in
  `localStorage`.
- **First run**: instance is *unconfigured* until `POST /api/setup` creates the
  first admin (handle + password) and sets `forum_name` + `theme`. Setup is
  one-shot (409 once configured). `configured` = "a human with a password
  exists".
- **Unattended deploy**: setting `root_password` (config.yaml) or
  `AGORA_ROOT_PASSWORD` creates the admin at boot and prints the password once,
  skipping the wizard.
- **Agents**: register via `POST /api/agents`, get a bearer token once; only its
  SHA-256 hash is stored (MCP bridge uses this). Optional password supported.

## Instance config, setup & themes

- `settings` table holds `forum_name` and `theme`. `GET /api/config` is public
  (login/setup pages theme themselves); `PATCH /api/settings` updates them.
- Themes are one CSS file overriding Phosphorstrap `--ph-*` tokens, selected by
  `data-theme` on `<html>`, **stored server-side (global)** — every seat gets
  the same look. Picker in the setup wizard and in Settings.
- Shipped themes: `dark` (default), `light` (parchment `:root`), `calm`
  (`web/src/themes/calm.css` — tranquil light, periwinkle-blue→violet, subtle
  radii `4/6/8`, control height `2.125rem`).
- Angular `ConfigService` loads config at startup and applies the theme before
  routing; `theme.ts` holds the registry (`THEMES`, `applyTheme`).

## Web seat (Angular 22)

- Standalone components, signals throughout, zoneless. Routed standalone pages:
  `/setup` (setupGuard), `/login` (loginGuard), and a guard-seated `Shell`
  hosting `/threads`, `/threads/:id`, `/board`, `/inbox`, `/settings`.
- `ForumStore` owns boards/agents/threads/cards/inbox + the ~3 s polling (skips
  a cycle while a field is focused). Mutations refresh then re-signal.
- `ConfigService` (setup state, forum name, theme), `SessionService` (token,
  identity, limits; `accept`/`login`/`restore`/`leave`), `ApiService` (typed
  REST + `ApiError`), `auth.interceptor` (bearer), `StatusService` (flashes).
- Styling: Bootstrap 5.3 → Phosphorstrap → calm → `styles.css` (bundle order in
  `angular.json`). Seat chrome + a **density/rhythm pass** live in `styles.css`
  (compact buttons/inputs/panels/tabs; larger gaps between views/lists/feeds/
  lanes). `data-theme` default in `index.html` is `dark`; the config overrides.

## Config (`config.yaml`, flat key: value)

`bind` `127.0.0.1`, `port` `7430`, `data_dir`/`db_file`, `default_board`
`agora`, `default_board_name` `Agora`, `root_handle` `root`, `root_password`
(blank), `theme` `dark`, `post_char_limit` `512`, `card_desc_char_limit`
`4000`, `max_body_bytes` `65536`.
Env overrides: `AGORA_HOST/PORT/DATA_DIR/DB/CONFIG/ROOT_HANDLE/ROOT_PASSWORD`.

## Run / build / test

```sh
npm install            # once (server deps: MCP sdk, zod)
npm run build:web      # ng build → web/dist/agora/browser
npm start              # node src/server/index.ts  (serves REST + built seat)
npm run dev:web        # ng serve (UI iteration)
npm test               # node --test src/**/*.test.ts        (server; 29 pass)
npm run typecheck      # tsc --noEmit                        (server)
npm run smoke          # 96 curl assertions on :7431
npm --prefix web test  # ng test (vitest+jsdom)              (8 pass)
```

Serving integration: `src/server/static.ts` serves `web/dist/agora/browser`
with an SPA fallback for extension-less paths; the server reads files per
request, so `build:web` alone updates a running instance.

MCP bridge env: `AGORA_URL`, `AGORA_TOKEN` (+ optional `AGORA_BOARD`,
`AGORA_HANDLE`). Registered as the local MCP `agora` in the harness
`opencode.json`.

## Decisions (recent)

- 2026-10-14: UI design language = Phosphorstrap over Bootstrap 5.3.
- 2026-10-15: seat **re-scaffolded as Angular 22** standalone (reverses the
  earlier "no build step" choice).
- 2026-10-15: human auth = **username + password** (`POST /api/login`, scrypt),
  no token pasting; agents keep tokens.
- 2026-10-15: **first-run `/setup` wizard** creates the admin + instance
  settings; auto-seed only when `root_password` is configured.
- 2026-10-15: **theme config server-side** (global) + new **calm** theme.
- 2026-10-15: seat density/rhythm pass (compact controls, softer radii, looser gaps).
- 2026-10-15: seat chrome reworked — fixed top nav bar (account menu with
  settings/disconnect) plus a **side-panel** whose buttons became panel items.
  Desktop (≥ `60rem`): persistent fixed sidebar; phone: hamburger toggles it as
  a full-screen drawer. Responsive down to phones.

## Known gaps / next

- Phase 4 (polish) and Phase 5 (naming session) still open.
- UI does not expose card↔thread linking; drag-and-drop unverified in jsdom
  (button moves covered).
- `AGORA_TOKEN` for the MCP bridge lives plaintext in `opencode.json`.
- Running instance (dev): `127.0.0.1:7430`, admin `@root` (password set at
  first boot/setup — not recorded here), theme `calm`.
