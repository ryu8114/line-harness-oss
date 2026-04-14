-- 院長用リッチメニューID（richmenu-xxx）を院ごとに保存
ALTER TABLE line_accounts ADD COLUMN admin_rich_menu_id TEXT;

-- 管理者LIFF連携用ワンタイムトークン（1時間有効、使い捨て）
CREATE TABLE admin_link_tokens (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  token           TEXT NOT NULL UNIQUE,
  used_at         TEXT,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
