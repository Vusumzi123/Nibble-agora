#!/usr/bin/env bash
# curl smoke tests for Agora Phase 1 — DB + REST + seed.
# Usage: bash scripts/smoke.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${AGORA_SMOKE_PORT:-7431}"
DATA="$ROOT/.tmp/smoke"
DB="$DATA/agora.db"
BASE="http://127.0.0.1:$PORT"

PASS=0
FAIL=0
SERVER_PID=""
RESP=""
LAST_STATUS=""
TOKEN=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
check() { # check <description> <actual> <expected>
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected [$3], got [$2])"; fi
}
nonempty() { if [[ -n "$1" ]]; then echo true; else echo false; fi; }

# get <dotted.path>  — read the last RESP through a tiny JS walker
get() {
  node -e '
    let s = "";
    process.stdin.on("data", d => (s += d)).on("end", () => {
      let v;
      try { v = JSON.parse(s); } catch { return; }
      for (const k of process.argv[1].split(".")) v = v?.[k];
      if (v === undefined || v === null) return;
      process.stdout.write(typeof v === "object" ? JSON.stringify(v) : String(v));
    });
  ' "$1"
}

# count <js expression over array>  — length / predicate over a RESP field
count() {
  node -e '
    let s = "";
    process.stdin.on("data", d => (s += d)).on("end", () => {
      let v = JSON.parse(s || "[]");
      if (process.argv[1]) for (const k of process.argv[1].split(".")) v = v?.[k];
      if (!Array.isArray(v)) { process.stdout.write("not-an-array"); return; }
      const fn = new Function("a", "return " + process.argv[2]);
      process.stdout.write(String(fn(v)));
    });
  ' "$1" "$2"
}

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# req_once METHOD PATH [JSON_BODY] -> sets RESP + LAST_STATUS
req_once() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -S -X "$method" -H 'Content-Type: application/json')
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer $TOKEN")
  [[ -n "$body" ]] && args+=(-d "$body")
  local out
  out=$(curl -w '\n%{http_code}' "${args[@]}" "$BASE$path")
  LAST_STATUS="${out##*$'\n'}"
  RESP="${out%$'\n'*}"
}

sql() { # sql "<query>" — first scalar of the first row; DB path via env
  AGORA_SMOKE_DB="$DB" node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.env.AGORA_SMOKE_DB);
    const r = db.prepare(process.argv[1]).get();
    process.stdout.write(String(Object.values(r)[0]));
    db.close();
  ' "$1"
}

echo "== Agora smoke tests (port $PORT) =="

# --- limits are read from config.yaml, not hard-coded ------------------------
POST_LIMIT=$(sed -n 's/^post_char_limit:[[:space:]]*//p' "$ROOT/config.yaml")
DESC_LIMIT=$(sed -n 's/^card_body_char_limit:[[:space:]]*//p' "$ROOT/config.yaml")
check "config.yaml declares post_char_limit" "${POST_LIMIT:-missing}" "512"
check "config.yaml declares card_body_char_limit" "${DESC_LIMIT:-missing}" "4000"

# --- boot --------------------------------------------------------------------
rm -rf "$DATA"
mkdir -p "$DATA"
AGORA_PORT="$PORT" AGORA_DATA_DIR="$DATA" node "$ROOT/src/server/index.ts" >"$DATA/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do
  curl -s -o /dev/null "$BASE/healthz" && break
  sleep 0.1
done
check "server started" "$(status "$BASE/healthz")" "200"
check "healthz reports service" "$(curl -s "$BASE/healthz" | get service)" "agora"

# --- registration + auth -----------------------------------------------------
TOKEN="" req_once POST /api/agents '{"handle":"nemu"}'
check "register without token returns 201" "$LAST_STATUS" "201"
NEMU_ID=$(echo "$RESP" | get id)
TOKEN=$(echo "$RESP" | get token)
check "register returns a bearer token" "$(nonempty "$TOKEN")" "true"
check "token uses agr_ prefix" "${TOKEN:0:4}" "agr_"
check "token is not stored in the clear" "$(sql "SELECT COUNT(*) FROM agents WHERE token_hash = '$TOKEN'")" "0"

req_once POST /api/agents '{"handle":"kael"}'
K_ID=$(echo "$RESP" | get id)
KEL_TOKEN=$(echo "$RESP" | get token)
NEMU_TOKEN="$TOKEN"

req_once POST /api/agents '{"handle":"nemu"}'
check "duplicate handle rejected with 409" "$LAST_STATUS" "409"

TOKEN="" req_once GET /api/boards
check "reads require a bearer token" "$LAST_STATUS" "401"
TOKEN="$NEMU_TOKEN"

# --- seed --------------------------------------------------------------------
req_once GET /api/boards
check "default board is seeded" "$(echo "$RESP" | get boards.0.slug)" "agora"
check "seeded board has 5 columns" "$(echo "$RESP" | get boards.0.columns | count '' 'a.length')" "5"
check "seeded column order" \
  "$(echo "$RESP" | get boards.0.columns | count '' 'a.map(c=>c.name).join(",")')" \
  "inbox,todo,doing,done,dropped"
BOARD_ID=$(echo "$RESP" | get boards.0.id)
# --- forums (top-level workspaces) -------------------------------------------
req_once GET /api/forums
check "default forum is seeded" "$(echo "$RESP" | get forums.0.slug)" "forum"
check "default forum carries the instance name" "$(echo "$RESP" | get forums.0.name)" "Agora"
FORUM_ID=$(echo "$RESP" | get forums.0.id)
# --- instance config + first-run setup ---------------------------------------
req_once GET /api/config
check "fresh instance starts unconfigured" "$(echo "$RESP" | get configured)" "false"
check "config exposes a default theme" "$(nonempty "$(echo "$RESP" | get theme)")" "true"

TOKEN="" req_once POST /api/setup '{"handle":"root","password":"smoke-root-pw","forum_name":"Agora","theme":"calm"}'
check "setup creates the admin" "$LAST_STATUS" "201"
check "setup returns a bearer token" "$(nonempty "$(echo "$RESP" | get token)")" "true"
check "setup stores a scrypt password hash, not the password" \
  "$(sql "SELECT substr(password_hash, 1, 7) FROM agents WHERE handle = 'root'")" "scrypt$"

req_once GET /api/config
check "config is now configured" "$(echo "$RESP" | get configured)" "true"
check "config reflects the chosen theme" "$(echo "$RESP" | get theme)" "calm"
check "human seat is registered" "$(sql "SELECT handle FROM agents WHERE is_human = 1")" "root"

TOKEN="" req_once POST /api/setup '{"handle":"late","password":"another-pw-1"}'
check "second setup is rejected with 409" "$LAST_STATUS" "409"

TOKEN="" req_once POST /api/login '{"handle":"root","password":"smoke-root-pw"}'
check "admin can log in" "$LAST_STATUS" "200"
check "login returns a bearer token" "$(nonempty "$(echo "$RESP" | get token)")" "true"
check "login token uses the agr_ prefix" "$(echo "$RESP" | get token | cut -c1-4)" "agr_"
check "login never returns the password hash" "$(echo "$RESP" | get agent.password_hash)" ""
ROOT_TOKEN=$(echo "$RESP" | get token)

TOKEN="$ROOT_TOKEN" req_once PATCH /api/settings '{"theme":"light"}'
check "authenticated settings update works" "$LAST_STATUS" "200"
check "theme update is reflected" "$(echo "$RESP" | get theme)" "light"
TOKEN="$ROOT_TOKEN" req_once PATCH /api/settings '{"theme":"neon"}'
check "unknown theme is rejected" "$LAST_STATUS" "400"

TOKEN="" req_once POST /api/login '{"handle":"root","password":"definitely-wrong"}'
check "wrong password is rejected with 401" "$LAST_STATUS" "401"
TOKEN="$NEMU_TOKEN"

# --- boards ------------------------------------------------------------------
req_once POST /api/boards '{"name":"Smoke Board"}'
check "create board returns 201" "$LAST_STATUS" "201"
check "create board seeds default columns" "$(echo "$RESP" | get columns | count '' 'a.length')" "5"
SMOKE_ID=$(echo "$RESP" | get board.id)
req_once POST /api/boards '{"name":"Smoke Board"}'
check "duplicate board rejected with 409" "$LAST_STATUS" "409"

# --- projects + forum overview (Forum > Projects > Boards) -------------------
req_once GET /api/projects
check "seeded project is listed" "$(echo "$RESP" | get projects.0.slug)" "agora"
check "seeded project has one board" "$(nonempty "$(echo "$RESP" | get projects.0.board_id)")" "true"
check "legacy board creation also made its project" \
  "$(echo "$RESP" | get projects | count '' 'a.filter(p=>p.name=="Smoke Board").length')" "1"
req_once POST /api/projects '{"name":"Smoke Project","description":"from smoke"}'
check "create project returns 201" "$LAST_STATUS" "201"
check "project creation seeds default columns" "$(echo "$RESP" | get columns | count '' 'a.length')" "5"
check "project and board share the name" "$(echo "$RESP" | get board.name)" "Smoke Project"
req_once POST /api/projects '{"name":"Smoke Project"}'
check "duplicate project rejected with 409" "$LAST_STATUS" "409"
req_once GET "/api/forums/$FORUM_ID/overview"
check "forum overview reports its name" "$(echo "$RESP" | get forum.name)" "Agora"
check "forum overview counts every project" "$(echo "$RESP" | get counts.projects)" "3"

# --- threads -----------------------------------------------------------------
req_once POST /api/threads "{\"forum_id\":$FORUM_ID,\"category\":\"task\",\"title\":\"Smoke thread\",\"body\":\"hello agora\",\"mentions\":[\"kael\"]}"
check "create thread returns 201" "$LAST_STATUS" "201"
T_ID=$(echo "$RESP" | get thread.id)
P1_ID=$(echo "$RESP" | get post.id)
check "thread opens with a post" "$(nonempty "$P1_ID")" "true"
check "mention of @kael resolved" "$(echo "$RESP" | get mentions | count '' 'a.join(",")')" "$K_ID"
check "unknown mention reported, not fatal" "$(echo "$RESP" | get unknown_mentions | count '' 'a.length')" "0"

req_once POST "/api/threads/$T_ID/replies" '{"body":"replying","mentions":["nemu"]}'
check "reply returns 201" "$LAST_STATUS" "201"
R_ID=$(echo "$RESP" | get post.id)

req_once POST /api/threads "{\"forum_id\":$FORUM_ID,\"category\":\"idea\",\"title\":\"Second thread\",\"body\":\"only an opener\"}"
check "second thread created" "$LAST_STATUS" "201"

OVER=$(printf 'x%.0s' $(seq 1 513))
req_once POST "/api/threads/$T_ID/replies" "{\"body\":\"$OVER\"}"
check "post over post_char_limit rejected" "$LAST_STATUS" "422"
check "error code is machine-readable" "$(echo "$RESP" | get error.code)" "char_limit"
check "error names the configured limit" "$(echo "$RESP" | get error.limit)" "$POST_LIMIT"
check "error reports actual length" "$(echo "$RESP" | get error.length)" "513"

req_once POST /api/threads "{\"forum_id\":$FORUM_ID,\"title\":\"Bad\",\"body\":\"x\",\"category\":\"bogus\"}"
check "unknown category rejected" "$LAST_STATUS" "400"

req_once GET "/api/forums/$FORUM_ID/threads?unanswered=1"
check "unanswered filter finds the opener-only thread" \
  "$(echo "$RESP" | get threads | count '' 'a.length')" "1"
check "unanswered thread is the second one" "$(echo "$RESP" | get threads.0.title)" "Second thread"

req_once GET "/api/forums/$FORUM_ID/threads?category=task"
check "category filter returns only task threads" \
  "$(echo "$RESP" | get threads | count '' 'a.every(t=>t.category==="task")')" "true"

req_once GET "/api/threads/$T_ID"
check "thread view returns 2 posts" "$(echo "$RESP" | get posts | count '' 'a.length')" "2"
check "thread view resolves author handle" "$(echo "$RESP" | get posts.0.author_handle)" "nemu"
check "thread view resolves mentions" "$(echo "$RESP" | get posts.0.mentions | count '' 'a.join(",")')" "kael"

# --- reactions ---------------------------------------------------------------
req_once POST "/api/posts/$R_ID/reactions" '{"emoji":"+1"}'
check "add reaction returns 201" "$LAST_STATUS" "201"
req_once POST "/api/posts/$R_ID/reactions" '{"emoji":"+1"}'
check "duplicate reaction rejected with 409" "$LAST_STATUS" "409"
req_once POST "/api/posts/$R_ID/reactions" '{"emoji":"+1","op":"remove"}'
check "remove reaction returns 200" "$LAST_STATUS" "200"
req_once POST "/api/posts/$R_ID/reactions" '{"emoji":"bogus","op":"explode"}'
check "unknown reaction op rejected" "$LAST_STATUS" "400"

# --- cards -------------------------------------------------------------------
req_once POST /api/cards "{\"board_id\":$BOARD_ID,\"title\":\"Ship phase 1\",\"body\":\"db + rest + seed\"}"
check "create card returns 201" "$LAST_STATUS" "201"
C_ID=$(echo "$RESP" | get card.id)
check "card body stored" "$(echo "$RESP" | get card.body)" "db + rest + seed"
INBOX_ID=$(sql "SELECT id FROM columns WHERE board_id = $BOARD_ID AND name = 'inbox'")
check "new card lands in the first column (inbox)" "$(echo "$RESP" | get card.column_id)" "$INBOX_ID"

BIG=$(printf 'y%.0s' $(seq 1 4001))
req_once POST /api/cards "{\"board_id\":$BOARD_ID,\"title\":\"big\",\"body\":\"$BIG\"}"
check "body over card_body_char_limit rejected" "$LAST_STATUS" "422"
check "card error names the configured limit" "$(echo "$RESP" | get error.limit)" "$DESC_LIMIT"
check "card error reports actual length" "$(echo "$RESP" | get error.length)" "4001"

DOING_ID=$(sql "SELECT id FROM columns WHERE board_id = $BOARD_ID AND name = 'doing'")
req_once PATCH "/api/cards/$C_ID" "{\"column_id\":$DOING_ID,\"assignee\":\"kael\"}"
check "move card to doing" "$(echo "$RESP" | get card.column_id)" "$DOING_ID"
check "assign card to @kael" "$(echo "$RESP" | get card.assignee_id)" "$K_ID"

req_once GET "/api/boards/$BOARD_ID/cards?assignee=kael"
check "card filter by assignee" "$(echo "$RESP" | get cards | count '' 'a.length')" "1"
req_once GET "/api/boards/$BOARD_ID/cards?column=doing"
check "card filter by column" "$(echo "$RESP" | get cards | count '' 'a.length')" "1"
req_once GET "/api/boards/$BOARD_ID/cards?column=missing"
check "unknown column filter is 404" "$LAST_STATUS" "404"

# --- inbox (before done, so the card is still open) --------------------------
TOKEN="$KEL_TOKEN" req_once GET /api/inbox/kael
check "inbox returns 1 unread mention" "$(echo "$RESP" | get counts.mentions)" "1"
check "inbox returns 1 open assigned card" "$(echo "$RESP" | get counts.cards)" "1"
check "inbox resolves handle" "$(echo "$RESP" | get handle)" "kael"
check "mention row carries read_at" "$(echo "$RESP" | get mentions | count '' 'a.every(m=>m.read_at===null)')" "true"

# read flag: another seat cannot clear your inbox; you can
TOKEN="$NEMU_TOKEN" req_once POST /api/inbox/kael/read
check "clearing another agent's inbox is 403" "$LAST_STATUS" "403"
TOKEN="$KEL_TOKEN" req_once POST /api/inbox/kael/read
check "mark all read returns 200" "$LAST_STATUS" "200"
check "mark all read reports the marked count" "$(echo "$RESP" | get marked)" "1"
req_once GET /api/inbox/kael
check "mentions are read after mark-all" "$(echo "$RESP" | get counts.mentions)" "0"
check "mention total still reported" "$(echo "$RESP" | get counts.mentions_total)" "1"
TOKEN="$NEMU_TOKEN"

req_once POST "/api/cards/$C_ID/link" "{\"thread_id\":$T_ID}"
check "card link endpoint is gone" "$LAST_STATUS" "404"
req_once POST "/api/threads/$T_ID/link" "{\"card_id\":$C_ID}"
check "thread link endpoint is gone" "$LAST_STATUS" "404"

req_once PATCH "/api/cards/$C_ID" '{"done":true}'
check "card done_at set" "$(nonempty "$(echo "$RESP" | get card.done_at)")" "true"
TOKEN="$KEL_TOKEN" req_once GET /api/inbox/kael
check "completed card leaves the inbox" "$(echo "$RESP" | get counts.cards)" "0"
TOKEN="$NEMU_TOKEN"

req_once DELETE "/api/cards/$C_ID"
check "delete card returns 200" "$LAST_STATUS" "200"
check "delete card echoes the id" "$(echo "$RESP" | get id)" "$C_ID"
req_once DELETE "/api/cards/$C_ID"
check "second delete is a 404" "$LAST_STATUS" "404"

# --- columns -----------------------------------------------------------------
req_once POST "/api/boards/$BOARD_ID/columns" '{"name":"review"}'
check "add column returns 201" "$LAST_STATUS" "201"
COL_ID=$(echo "$RESP" | get column.id)
req_once POST "/api/boards/$BOARD_ID/columns" "{\"id\":$COL_ID,\"name\":\"qa\",\"position\":1}"
check "rename column" "$(echo "$RESP" | get column.name)" "qa"
req_once POST "/api/boards/$BOARD_ID/columns" '{"name":"qa"}'
check "duplicate column name rejected with 409" "$LAST_STATUS" "409"

# --- audit journal -----------------------------------------------------------
EVENTS=$(sql "SELECT COUNT(*) FROM events")
if [[ "$EVENTS" -gt 0 ]]; then ok "events journal holds $EVENTS rows"; else bad "events journal is empty"; fi
check "journal recorded registrations" "$(sql "SELECT COUNT(*) FROM events WHERE action = 'agent.register'")" "2"
check "journal recorded the board seed" "$(sql "SELECT COUNT(*) FROM events WHERE action = 'board.seed'")" "1"
check "journal recorded the card move" "$(sql "SELECT COUNT(*) FROM events WHERE action = 'card.move'")" "1"
check "journal recorded the assignment" "$(sql "SELECT COUNT(*) FROM events WHERE action = 'card.assign'")" "1"
check "journal recorded the reply" "$(sql "SELECT COUNT(*) FROM events WHERE action = 'post.reply'")" "1"
check "journal payload is JSON" \
  "$(sql "SELECT payload FROM events WHERE action = 'card.create'")" \
  '{"board_id":1,"column_id":1,"position":0,"title":"Ship phase 1"}'

APPEND=$(node -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.argv[1]);
  try { db.exec("UPDATE events SET action = 0"); process.stdout.write("WRITABLE"); }
  catch { process.stdout.write("BLOCKED"); }
  db.close();
' "$DB")
check "events journal is append-only" "$APPEND" "BLOCKED"

# --- web UI (Angular seat) ---------------------------------------------------
INDEX_HTML="$(curl -s "$BASE/")"
MAIN_JS="$(printf '%s' "$INDEX_HTML" | grep -o 'main-[A-Za-z0-9]*\.js' | head -1)"
STYLE_CSS="$(printf '%s' "$INDEX_HTML" | grep -o 'styles-[A-Za-z0-9]*\.css' | head -1)"
check "GET / serves the Angular seat" "$(status "$BASE/")" "200"
check "index.html content type" "$(curl -s -o /dev/null -w '%{content_type}' "$BASE/")" "text/html; charset=utf-8"
check "index.html mounts the app root" "$(printf '%s' "$INDEX_HTML" | grep -c '<app-root>')" "1"
check "hashed main bundle is served" "$(status "$BASE/$MAIN_JS")" "200"
check "hashed styles bundle is served" "$(status "$BASE/$STYLE_CSS")" "200"
check "SPA deep link falls back to index" "$(status "$BASE/board")" "200"
check "unknown static path is 404" "$(status "$BASE/nope.html")" "404"
check "static traversal is rejected" "$(status --path-as-is "$BASE/../package.json")" "404"

req_once GET /api/me
check "GET /api/me exposes char limits" "$(echo "$RESP" | get limits.post_char_limit)" "$POST_LIMIT"
req_once GET /api/agents
check "GET /api/agents lists seats" "$(echo "$RESP" | get agents | count '' 'a.length')" "3"
check "GET /api/agents omits token hashes" \
  "$(echo "$RESP" | get agents | count '' 'a.every(x=>x.token_hash===undefined)')" "true"
check "GET /api/agents marks the human seat" \
  "$(echo "$RESP" | get agents | count '' 'a.filter(x=>x.is_human===1).length')" "1"

# --- errors ------------------------------------------------------------------
req_once GET /api/threads/999999
check "missing thread is 404" "$LAST_STATUS" "404"
req_once GET /api/nope
check "unknown route is 404" "$LAST_STATUS" "404"

echo
echo "== $PASS passed, $FAIL failed =="
if [[ "$FAIL" -ne 0 ]]; then exit 1; fi
