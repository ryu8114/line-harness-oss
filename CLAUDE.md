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

- [x] **管理者LIFF（院長向け）の作成** ✅ 実装済み・動作確認済み
  - バックエンド: `apps/worker/src/routes/admin-liff-api.ts`（今日の予約一覧・詳細API）
  - フロントエンド: `apps/worker/src/client/admin-booking.ts`（`page=admin-booking`）
  - 院長の公式LINEリッチメニューから動作確認済み

- [ ] **前日リマインド配信の動作確認**
  - 予約作成時に `friend_reminders` へ登録される仕組みは実装済み
  - Cron (`*/5 * * * *`) による実際の配信を翌日に実機確認

### 低優先度（Phase 2）

- [ ] 管理者LIFFから臨時休業を登録できるようにする
- [ ] リピーター判定: `friends.metadata` に顧客情報を保存し次回予約時に自動入力
- [ ] `line_accounts.channel_access_token` の暗号化（現状平文）

### UI改善

- [x] **院長リッチメニューの今日の予約・明日の予約カードのレイアウト崩れを修正** ✅
  - 予約行を3列→2列（時刻 | 縦並び[名前+メニュー]）に変更しテキスト省略を解消
  - 右端に「›」を追加してタップ可能であることを明示
- [x] **管理画面スマホUI全般の改善** ✅
  - 固定ヘッダー下の余白不足を解消（`pt-[72px]`→`pt-20`）
  - 予約一覧：モバイルはカード形式・PCはテーブル形式に切り替え
  - 予約一覧：終了日デフォルトを当日→1ヶ月後に変更
  - 予約詳細：ステータス変更から「完了」「無断キャンセル」を削除
  - メニュー管理：テーブル→カード形式に変更、「無効化/有効化」ボタン・ステータス表示を削除
  - 営業時間：常に横並びレイアウトに変更・時間入力を`flex-1`で伸縮させはみ出し解消
  - `window.confirm()`を全18箇所カスタムモーダルに置き換え（URLが表示されない）
  - ナビゲーションからダッシュボード・設定セクション（スタッフ管理・LINEアカウント）を非表示
  - 画面右下の CCプロンプトボタンを非表示
- [x] **管理画面のヘッダー名「LINE Harness」を変更** ✅ 「予約管理システム」に変更・H ロゴ削除
- [x] **管理画面の不要なメニュー項目を非表示にする** ✅ 友だち管理・配信・分析・自動化・UUID管理・BAN検知・緊急コントロールを削除
- [x] **お店情報（住所・電話・営業時間・Google マップURL）を登録する管理画面ページを作成** ✅ `/booking/shop-info` として独立ページ化

---

## デプロイ手順

### Worker デプロイ
**必ず `npm run deploy` を使うこと。`wrangler deploy` 単体は NG。**

```bash
cd apps/worker
npm run deploy   # vite build && wrangler deploy
```

`wrangler deploy` だけ実行すると vite ビルドがスキップされ、古いコードが本番に乗る。
過去に同様の事故が複数回発生している。

### D1 マイグレーション（本番）
```bash
npx wrangler d1 execute line-harness --remote --file=packages/db/migrations/<ファイル名>.sql
```

---

## 複数院追加の手順

### クライアントがすでに公式LINEを持っている場合の注意点

- **Webhook URL の上書き**: 既存システムで Webhook を使っていた場合、変更すると既存の動作が止まる。事前に確認すること。
- **既存リッチメニューの上書き**: スクリプトで新しいリッチメニューを設定すると既存のものは上書きされる。
- **LINE Login チャンネル**: LIFF に必要。Nogardwons が持つ1つのチャンネル（`2009660165`）を全院共通で使うので、クライアント側での用意は不要。
- **既存フォロワー**: すでにフォロワーがいる場合、設定後すぐ予約機能を提供できる（メリット）。

### 手順

1. LINE Developers でプロバイダー「タナカワークス」に Messaging API チャンネルを追加
   （既存の公式LINEがある場合は既存チャンネルのID・トークン・シークレットを確認）
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

5. admin-link トークンを発行して院長に送る（有効期限 24 時間）

```bash
curl -X POST https://line-harness.nogardwons.workers.dev/api/admin-liff/link-token \
  -H "Authorization: Bearer lh_自分のAPIキー" \
  -H "Content-Type: application/json" \
  -d '{"lineAccountId": "上記の院ID"}'
```

返ってきた `liffUrl` を院長に送る。院長がLINEで開くと LINE User ID が紐付けられ、院長用リッチメニューが自動適用される。

6. 院長用リッチメニューを作成

```bash
KEY=lh_xxx LIFF_URL_ADMIN=https://liff.line.me/2009660165-iO7T7i2u \
  bash scripts/create-admin-rich-menu.sh ./admin-menu.png <line_account_id>
```

返ってきた `richMenuId` を D1 に保存（スクリプトの指示通り）。

7. LINE Developers で患者向け LIFF の `line_account_id` パラメータを変えた URL を院に渡す

※ Worker・D1・Pages の再デプロイは不要。

---

## 顧客向けリッチメニュー設定手順

顧客向けリッチメニュー（予約する / 予約確認 / お店情報）を院に設定する手順。

### 1. リッチメニュー作成

```bash
KEY=lh_xxx bash scripts/create-customer-rich-menu.sh \
  ./customer-menu.png \
  <line_account_id> \
  https://liff.line.me/<liff_id>
```

- 画像は 2500x843 PNG、1MB 以下
- スクリプトが終了すると `richMenuId` が表示される

### 2. D1 に richMenuId を保存

```bash
npx wrangler d1 execute line-harness --remote --command \
  "UPDATE line_accounts SET customer_rich_menu_id = '<richMenuId>' WHERE id = '<line_account_id>';"
```

### 3. 店舗情報の設定

管理画面「予約設定」ページ（`/booking/settings`）で住所・電話・営業時間・Google マップ URL を入力・保存。
顧客がリッチメニューの「お店情報」を押したときに表示される。
