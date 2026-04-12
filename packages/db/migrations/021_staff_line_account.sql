-- staff_members に line_account_id を追加
-- owner は NULL（全院アクセス可）、admin/staff はアプリ層で必須化
ALTER TABLE staff_members ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id);
CREATE INDEX IF NOT EXISTS idx_staff_members_line_account_id ON staff_members(line_account_id);
