-- Migration 018: Booking system for chiropractic clinics
-- Run: wrangler d1 execute line-crm --file=packages/db/migrations/018_booking_system.sql --remote

-- =============================================================
-- Extend line_accounts with booking system columns
-- =============================================================
ALTER TABLE line_accounts ADD COLUMN admin_line_user_id TEXT;
ALTER TABLE line_accounts ADD COLUMN liff_id_admin TEXT;
ALTER TABLE line_accounts ADD COLUMN google_calendar_connection_id TEXT;
ALTER TABLE line_accounts ADD COLUMN booking_enabled INTEGER DEFAULT 0;
ALTER TABLE line_accounts ADD COLUMN min_booking_hours INTEGER DEFAULT 3;
ALTER TABLE line_accounts ADD COLUMN max_booking_days INTEGER DEFAULT 14;
ALTER TABLE line_accounts ADD COLUMN slot_unit INTEGER DEFAULT 30;
ALTER TABLE line_accounts ADD COLUMN plan TEXT DEFAULT 'monitor';

-- =============================================================
-- Extend calendar_bookings with booking detail columns
-- =============================================================
ALTER TABLE calendar_bookings ADD COLUMN menu_id TEXT;
ALTER TABLE calendar_bookings ADD COLUMN menu_name_snapshot TEXT;
ALTER TABLE calendar_bookings ADD COLUMN menu_duration_snapshot INTEGER;
ALTER TABLE calendar_bookings ADD COLUMN menu_price_snapshot INTEGER;
ALTER TABLE calendar_bookings ADD COLUMN customer_name TEXT;
ALTER TABLE calendar_bookings ADD COLUMN customer_phone TEXT;
ALTER TABLE calendar_bookings ADD COLUMN customer_note TEXT;
ALTER TABLE calendar_bookings ADD COLUMN line_account_id TEXT;

-- =============================================================
-- New table: menus (施術メニュー)
-- =============================================================
CREATE TABLE IF NOT EXISTS menus (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  duration INTEGER NOT NULL,
  price INTEGER,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_menus_account ON menus (line_account_id, is_active);

-- =============================================================
-- New table: business_hours (営業時間)
-- =============================================================
CREATE TABLE IF NOT EXISTS business_hours (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,
  open_time TEXT,
  close_time TEXT,
  break_start TEXT,
  break_end TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_business_hours_account ON business_hours (line_account_id, day_of_week);

-- =============================================================
-- New table: schedule_exceptions (例外日)
-- =============================================================
CREATE TABLE IF NOT EXISTS schedule_exceptions (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('closed', 'partial')),
  open_time TEXT,
  close_time TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_exceptions_account_date ON schedule_exceptions (line_account_id, date);
