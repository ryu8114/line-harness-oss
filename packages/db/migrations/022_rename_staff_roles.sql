-- ロール名を意味的に正しい名前に変更
-- owner → system_admin（システム管理者）
-- admin → clinic_admin（院長）
-- staff → staff（そのまま）

-- DROP COLUMN がインデックスにブロックされるため先に削除
DROP INDEX IF EXISTS idx_staff_members_api_key;
DROP INDEX IF EXISTS idx_staff_members_role;

-- role_new カラムを一時追加（NOT NULL DEFAULT で既存行を初期化）
ALTER TABLE staff_members ADD COLUMN role_new TEXT NOT NULL DEFAULT 'staff'
  CHECK (role_new IN ('system_admin', 'clinic_admin', 'staff'));

-- CASE式で一括変換（取りこぼし防止）
UPDATE staff_members SET role_new = CASE role
  WHEN 'owner' THEN 'system_admin'
  WHEN 'admin' THEN 'clinic_admin'
  ELSE 'staff'
END;

-- RENAME COLUMN 後は DEFAULT が残るため、テーブルを再構築して schema.sql と一致させる
CREATE TABLE staff_members_new (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT,
  role       TEXT NOT NULL CHECK (role IN ('system_admin', 'clinic_admin', 'staff')),
  api_key    TEXT UNIQUE NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  line_account_id TEXT REFERENCES line_accounts(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO staff_members_new (id, name, email, role, api_key, is_active, line_account_id, created_at, updated_at)
SELECT id, name, email, role_new, api_key, is_active, line_account_id, created_at, updated_at
FROM staff_members;

DROP TABLE staff_members;
ALTER TABLE staff_members_new RENAME TO staff_members;

-- インデックス再作成
CREATE UNIQUE INDEX idx_staff_members_api_key ON staff_members(api_key);
CREATE INDEX idx_staff_members_role ON staff_members(role);
CREATE INDEX idx_staff_members_line_account_id ON staff_members(line_account_id);
