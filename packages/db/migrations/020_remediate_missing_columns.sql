-- Migration 020: Remediate schema gaps from migrations 001-017 (never applied to remote DB)
-- The remote DB was initialized from schema.sql directly.
-- 018 and 019 are already applied.
-- Execute order: CREATE TABLE first, then ALTER TABLE.

-- ============================================================
-- Missing tables (from migrations 003, 006, 007, 016)
-- Columns from later migrations (010, 014, 017) included here.
-- ============================================================

-- 003: entry_routes
CREATE TABLE IF NOT EXISTS entry_routes (
  id           TEXT PRIMARY KEY,
  ref_code     TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  tag_id       TEXT REFERENCES tags (id) ON DELETE SET NULL,
  scenario_id  TEXT REFERENCES scenarios (id) ON DELETE SET NULL,
  redirect_url TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_entry_routes_ref ON entry_routes (ref_code);

-- 003 + 010: ref_tracking (includes ad columns from 010)
CREATE TABLE IF NOT EXISTS ref_tracking (
  id             TEXT PRIMARY KEY,
  ref_code       TEXT NOT NULL,
  friend_id      TEXT REFERENCES friends (id) ON DELETE CASCADE,
  entry_route_id TEXT REFERENCES entry_routes (id) ON DELETE SET NULL,
  source_url     TEXT,
  fbclid         TEXT,
  gclid          TEXT,
  twclid         TEXT,
  ttclid         TEXT,
  utm_source     TEXT,
  utm_medium     TEXT,
  utm_campaign   TEXT,
  user_agent     TEXT,
  ip_address     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_ref_tracking_ref    ON ref_tracking (ref_code);
CREATE INDEX IF NOT EXISTS idx_ref_tracking_friend ON ref_tracking (friend_id);

-- 006: tracked_links
CREATE TABLE IF NOT EXISTS tracked_links (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  original_url TEXT NOT NULL,
  tag_id       TEXT REFERENCES tags (id) ON DELETE SET NULL,
  scenario_id  TEXT REFERENCES scenarios (id) ON DELETE SET NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  click_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 006: link_clicks
CREATE TABLE IF NOT EXISTS link_clicks (
  id              TEXT PRIMARY KEY,
  tracked_link_id TEXT NOT NULL REFERENCES tracked_links (id) ON DELETE CASCADE,
  friend_id       TEXT REFERENCES friends (id) ON DELETE SET NULL,
  clicked_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_link_clicks_link   ON link_clicks (tracked_link_id);
CREATE INDEX IF NOT EXISTS idx_link_clicks_friend ON link_clicks (friend_id);

-- 007 + 014 + 017: forms (includes submit message and webhook columns)
CREATE TABLE IF NOT EXISTS forms (
  id                           TEXT PRIMARY KEY,
  name                         TEXT NOT NULL,
  description                  TEXT,
  fields                       TEXT NOT NULL DEFAULT '[]',
  on_submit_tag_id             TEXT REFERENCES tags (id) ON DELETE SET NULL,
  on_submit_scenario_id        TEXT REFERENCES scenarios (id) ON DELETE SET NULL,
  save_to_metadata             INTEGER NOT NULL DEFAULT 1,
  is_active                    INTEGER NOT NULL DEFAULT 1,
  submit_count                 INTEGER NOT NULL DEFAULT 0,
  on_submit_message_type       TEXT CHECK (on_submit_message_type IN ('text', 'flex')) DEFAULT NULL,
  on_submit_message_content    TEXT DEFAULT NULL,
  on_submit_webhook_url        TEXT,
  on_submit_webhook_headers    TEXT,
  on_submit_webhook_fail_message TEXT,
  created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 007: form_submissions
CREATE TABLE IF NOT EXISTS form_submissions (
  id         TEXT PRIMARY KEY,
  form_id    TEXT NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  friend_id  TEXT REFERENCES friends (id) ON DELETE SET NULL,
  data       TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_form_submissions_form   ON form_submissions (form_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_friend ON form_submissions (friend_id);

-- 016: traffic_pools
CREATE TABLE IF NOT EXISTS traffic_pools (
  id                TEXT PRIMARY KEY,
  slug              TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  active_account_id TEXT NOT NULL REFERENCES line_accounts (id),
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- ============================================================
-- Missing columns on existing tables
-- ============================================================

-- 003: friends.ref_code
ALTER TABLE friends ADD COLUMN ref_code TEXT;

-- 004: friends.metadata
ALTER TABLE friends ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';

-- 005: scenario_steps branching
ALTER TABLE scenario_steps ADD COLUMN condition_type TEXT;
ALTER TABLE scenario_steps ADD COLUMN condition_value TEXT;
ALTER TABLE scenario_steps ADD COLUMN next_step_on_false INTEGER;

-- 008: line_account_id on all relevant tables
ALTER TABLE friends     ADD COLUMN line_account_id TEXT REFERENCES line_accounts (id);
ALTER TABLE scenarios   ADD COLUMN line_account_id TEXT;
ALTER TABLE broadcasts  ADD COLUMN line_account_id TEXT;
ALTER TABLE reminders   ADD COLUMN line_account_id TEXT;
ALTER TABLE automations ADD COLUMN line_account_id TEXT;
ALTER TABLE chats       ADD COLUMN line_account_id TEXT;

-- 008: login channel and LIFF columns on line_accounts
ALTER TABLE line_accounts ADD COLUMN login_channel_id     TEXT;
ALTER TABLE line_accounts ADD COLUMN login_channel_secret TEXT;
ALTER TABLE line_accounts ADD COLUMN liff_id              TEXT;

-- 009: token expiry on line_accounts
ALTER TABLE line_accounts ADD COLUMN token_expires_at TEXT;

-- 012: alt_text on broadcasts
ALTER TABLE broadcasts ADD COLUMN alt_text TEXT;
