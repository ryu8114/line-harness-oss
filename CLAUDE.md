# LINE Harness OSS — 開発メモ

## プロジェクト概要

整体院・美容・ネイルなど1人オーナー向けのLINE予約システム。
LINE Harness OSSをベースに予約機能を拡張したもの。

- Worker: `https://line-harness.nogardwons.workers.dev`
- 管理画面: `https://line-harness-web-a61.pages.dev`
- D1: `line-harness` (42b8b97e-65e5-455a-b16a-fb1e61f50b6b)

---

## 残タスク

### 高優先度

- [x] **複数院の権限分離** ✅ 実装済み
  - `staff_members.line_account_id` カラム追加（migration 021）
  - `requireTenant` ミドルウェアで admin/staff を自院にスコープ
  - 全 API ルートで `resolvedLineAccountId` / `checkOwnership` による分離を適用
  - 参考: `apps/worker/src/middleware/tenant.ts`

- [x] **管理画面のログイン方式** ✅ 実装済み（候補C）
  - `/login?key=<APIキー>` で自動ログイン（URL から key を即削除）
  - admin/staff はアカウントセレクターが自院に固定される
  - 将来スケール時はメアド＋パスワードに移行予定

- [x] **`staff_members` テーブルのロール名見直し** ✅ 実装済み
  - 変更後: `system_admin / clinic_admin / staff`
  - `system_admin` = システム全体管理者（旧 `owner`）
  - `clinic_admin` = 院長（旧 `admin`）
  - `staff` = スタッフ（変更なし）
  - マイグレーション: `packages/db/migrations/022_rename_staff_roles.sql`

### 中優先度

- [ ] **管理者LIFF（院長向け）の作成**
  - LINE Developers で LIFF を新規追加（エンドポイント: `/?page=admin-booking`）
  - 作成後: `UPDATE line_accounts SET liff_id_admin = '...' WHERE id = '...'`
  - 機能: 今日の予約一覧・予約詳細表示

- [ ] **前日リマインド配信の動作確認**
  - 予約作成時に `friend_reminders` へ登録される仕組みは実装済み
  - Cron (`*/5 * * * *`) による実際の配信を翌日に実機確認

### 低優先度（Phase 2）

- [ ] 管理者LIFFから臨時休業を登録できるようにする
- [ ] リピーター判定: `friends.metadata` に顧客情報を保存し次回予約時に自動入力
- [ ] `line_accounts.channel_access_token` の暗号化（現状平文）

---

## 複数院追加の手順

1. LINE Developers でプロバイダー「タナカワークス」に Messaging API チャンネルを追加
2. Webhook URL を `https://line-harness.nogardwons.workers.dev/webhook` に設定
3. D1 に `line_accounts` レコードを INSERT

```sql
INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active)
VALUES ('新しいID', 'チャンネルID', '院名', 'アクセストークン', 'チャンネルシークレット', 1);
```

4. D1 に `staff_members` レコードを INSERT（`line_account_id` に上記の院 ID を指定）

```sql
INSERT INTO staff_members (id, name, role, api_key, line_account_id)
VALUES (lower(hex(randomblob(16))), '院長名', 'clinic_admin', 'lh_任意のキー', '上記の院ID');
```

5. ログイン URL を院長に渡す: `https://line-harness-web-a61.pages.dev/login?key=lh_任意のキー`
6. LINE Developers で患者向け LIFF の `line_account_id` パラメータを変えた URL を院に渡す

※ Worker・D1・Pages の再デプロイは不要。
