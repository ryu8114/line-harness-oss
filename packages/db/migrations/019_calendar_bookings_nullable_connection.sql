-- Migration 019: Make calendar_bookings.connection_id nullable
--   + Add no_show to status CHECK constraint
--   + Include booking system columns from 018 in recreated table
--
-- Background: Google Calendar integration is optional for MVP.
-- connection_id was originally NOT NULL REFERENCES google_calendar_connections,
-- which prevented creating bookings without a calendar connection.
--
-- SQLite does not support ALTER COLUMN, so we recreate the table.

PRAGMA foreign_keys = OFF;

-- 1. Create new table with all columns (original + 018 additions) and nullable connection_id
CREATE TABLE calendar_bookings_new (
  id                      TEXT PRIMARY KEY,
  connection_id           TEXT REFERENCES google_calendar_connections (id) ON DELETE SET NULL,
  line_account_id         TEXT,
  friend_id               TEXT REFERENCES friends (id) ON DELETE SET NULL,
  event_id                TEXT,
  title                   TEXT NOT NULL,
  start_at                TEXT NOT NULL,
  end_at                  TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'confirmed'
                            CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  metadata                TEXT,
  menu_id                 TEXT,
  menu_name_snapshot      TEXT,
  menu_duration_snapshot  INTEGER,
  menu_price_snapshot     INTEGER,
  customer_name           TEXT,
  customer_phone          TEXT,
  customer_note           TEXT,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 2. Copy existing data (connection_id and original columns only; new columns default to NULL)
INSERT INTO calendar_bookings_new (
  id, connection_id, friend_id, event_id, title,
  start_at, end_at, status, metadata, created_at, updated_at
)
SELECT
  id, connection_id, friend_id, event_id, title,
  start_at, end_at, status, metadata, created_at, updated_at
FROM calendar_bookings;

-- 3. Drop old table and rename
DROP TABLE calendar_bookings;
ALTER TABLE calendar_bookings_new RENAME TO calendar_bookings;

-- 4. Recreate indexes
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_connection ON calendar_bookings (connection_id);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_friend ON calendar_bookings (friend_id);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_status ON calendar_bookings (status);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_account ON calendar_bookings (line_account_id);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_start ON calendar_bookings (start_at);

PRAGMA foreign_keys = ON;
