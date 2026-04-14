-- キャンセル期限（何時間前までキャンセル可能か）。デフォルト24時間
ALTER TABLE line_accounts ADD COLUMN cancel_deadline_hours INTEGER NOT NULL DEFAULT 24;

-- 店舗情報（お店情報Flexで返す内容、JSON文字列）
-- 形式例: {"address":"奈良県橿原市...","phone":"0744-XX-XXXX","hours":"月〜金 10:00〜20:00\n土 10:00〜18:00\n日曜 定休","mapUrl":"https://maps.google.com/..."}
ALTER TABLE line_accounts ADD COLUMN shop_info TEXT;

-- 顧客用リッチメニューID（画像アップロード・デフォルト設定したリッチメニューのID）
ALTER TABLE line_accounts ADD COLUMN customer_rich_menu_id TEXT;

-- 予約に紐づくリマインダーの特定用（同日複数予約での誤更新防止）
ALTER TABLE friend_reminders ADD COLUMN booking_id TEXT;
