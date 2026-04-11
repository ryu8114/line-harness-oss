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

- [ ] **複数院の権限分離**
  - `staff_members` に `line_account_id` カラムを追加
  - `role = 'admin'`（院長）は自分の院のデータのみ参照・操作可能に制限
  - `/api/line-accounts` を認証スタッフの所属院だけ返すよう修正
  - 全管理APIで `line_account_id` の一致チェックを追加
  - 参考: `apps/worker/src/routes/line-accounts.ts`, `apps/worker/src/middleware/auth.ts`

- [ ] **`staff_members` テーブルのロール名見直し**
  - 現状: `owner / admin / staff`
  - 「院長」が `staff_members` テーブルに入るのは名称的に違和感がある
  - 検討案: テーブル名を `accounts` に変更、またはロールに `clinic_owner` を追加
  - 変更時は `role IN (...)` の CHECK 制約とすべての参照箇所を合わせて修正する

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

### 要検討（実装方針が未定）

- [ ] **管理画面のログイン方式**
  - 現状: APIキー入力（院長には不親切）
  - 候補A: メアド＋パスワード（一般的だが実装コスト高・メール送信基盤が必要）
  - 候補B: LINEでログイン（PC管理画面ではQRコードスキャンが必要で不親切）
  - 候補C: APIキーのまま、URLに埋め込んだブックマークを院長に渡す（シンプル）
  - 複数院の権限分離タスクと合わせて方針を決める

---

## 複数院追加の手順（現状）

1. LINE Developers でプロバイダー「タナカワークス」に Messaging API チャンネルを追加
2. Webhook URL を `https://line-harness.nogardwons.workers.dev/webhook` に設定
3. D1 に `line_accounts` レコードを INSERT（`login_channel_id` は共通の Login チャンネル ID）
4. D1 に `staff_members` レコードを INSERT（院長用 API キー）
5. LINE Developers で患者向け LIFF の `line_account_id` パラメータを変えた URL を院に渡す

※ Worker・D1・Pages の再デプロイは不要。
