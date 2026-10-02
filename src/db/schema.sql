-- MealConvene schema. SQLite via node:sqlite; kept portable to Postgres.
-- Money is integer cents everywhere.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- The people who run orders. Students never get an account.
CREATE TABLE IF NOT EXISTS organizer (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  pw_hash     TEXT NOT NULL,
  pw_salt     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  token         TEXT PRIMARY KEY,
  organizer_id  TEXT NOT NULL REFERENCES organizer(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

-- The roster: students and coaches alike. Everyone on an order gets the same limit.
-- A name is the only thing kept about a person, on purpose.
CREATE TABLE IF NOT EXISTS person (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  -- Set when TeamConvene owns this person, so a later sync matches instead of duplicating.
  external_id TEXT,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS person_external ON person (external_id) WHERE external_id IS NOT NULL;

-- A restaurant the team orders from, with its saved menu text. Editing it only
-- changes FUTURE orders: each order parses its own copy of the menu.
CREATE TABLE IF NOT EXISTS restaurant (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  -- Which cart-fill adapter knows this site. 'subway' | 'other'.
  kind         TEXT NOT NULL DEFAULT 'other',
  store_label  TEXT,
  menu_text    TEXT NOT NULL,
  -- Subway's online ordering has no free-text instructions, so a note would
  -- be promised to a student and silently dropped. Off for Subway.
  allow_notes  INTEGER NOT NULL DEFAULT 1,
  -- A template's prices are guesses. No order can be opened until an organizer
  -- says they checked them, because the limit is only as true as the prices.
  prices_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meal_order (
  id             TEXT PRIMARY KEY,
  restaurant_id  TEXT NOT NULL REFERENCES restaurant(id),
  title          TEXT NOT NULL,
  -- Snapshotted from the restaurant so a later rename can't rewrite history.
  restaurant_name TEXT NOT NULL,
  restaurant_kind TEXT NOT NULL,
  allow_notes    INTEGER NOT NULL,
  limit_cents    INTEGER NOT NULL CHECK (limit_cents > 0),
  -- 1: subtotal plus cushion counts against the limit. 0: item prices only.
  count_cushion  INTEGER NOT NULL DEFAULT 1,
  cushion_pct    INTEGER NOT NULL DEFAULT 10 CHECK (cushion_pct BETWEEN 0 AND 50),
  deadline       TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- The cart-fill extension's credential. Read-only, revocable, never a session.
  fill_token     TEXT NOT NULL UNIQUE,
  -- The one link posted in team chat. Each person taps their name ONCE; after
  -- that the name is theirs and the team link can't reopen it.
  team_token     TEXT NOT NULL UNIQUE,
  -- 1: the team link also lets someone type their own name onto the order.
  allow_join     INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT REFERENCES organizer(id),
  created_at     TEXT NOT NULL
);

-- The order's own copy of the menu.
CREATE TABLE IF NOT EXISTS menu_item (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES meal_order(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  category     TEXT,
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS option_group (
  id            TEXT PRIMARY KEY,
  menu_item_id  TEXT NOT NULL REFERENCES menu_item(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  min_select    INTEGER NOT NULL DEFAULT 1,
  max_select    INTEGER NOT NULL DEFAULT 1,
  position      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_option (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL REFERENCES option_group(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  price_cents  INTEGER NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0
);

-- One row per person on an order. The token IS their identity for this order:
-- nobody types a name, so nobody can order as someone else or claim a second limit.
CREATE TABLE IF NOT EXISTS invite (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES meal_order(id) ON DELETE CASCADE,
  person_id     TEXT NOT NULL REFERENCES person(id),
  person_name   TEXT NOT NULL,
  token         TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ordered', 'skipped')),
  submitted_at  TEXT,
  -- Set the first time this personal link is opened, by either door.
  claimed_at    TEXT,
  -- 1: they typed their own name on the team link. Flagged to the coach, who
  -- is the check against one person joining twice for two limits.
  self_joined   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (order_id, person_id)
);

CREATE TABLE IF NOT EXISTS cart_line (
  id            TEXT PRIMARY KEY,
  invite_id     TEXT NOT NULL REFERENCES invite(id) ON DELETE CASCADE,
  menu_item_id  TEXT NOT NULL REFERENCES menu_item(id) ON DELETE CASCADE,
  option_ids    TEXT NOT NULL DEFAULT '[]',
  qty           INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 20),
  note          TEXT,
  position      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS cart_line_invite ON cart_line (invite_id);
CREATE INDEX IF NOT EXISTS invite_order ON invite (order_id);
CREATE INDEX IF NOT EXISTS menu_item_order ON menu_item (order_id);
