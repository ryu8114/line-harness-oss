# 院長用リッチメニューの実装・セットアップ

1人オーナーの院長向けに、LINE公式アカウントのリッチメニュー（ハーフサイズ3分割）を用意する。画像ファイルは別途用意済みなので、このタスクでは **コード追加・メニュー登録・DB保存・院長への適用まで** を行う。

## 最終的な構成

ハーフサイズ（2500×843）の3分割リッチメニュー。

```
┌─────────────┬─────────────┬─────────────┐
│  今日の予約  │  店舗設定   │  明日の予約  │
│  (postback) │   (uri)     │  (postback) │
└─────────────┴─────────────┴─────────────┘
```

| エリア | 位置 (x, y, w, h) | ラベル | アクション |
|---|---|---|---|
| 左 | 0, 0, 833, 843 | 今日の予約 | postback `action=admin_today_bookings` |
| 中 | 833, 0, 833, 843 | 店舗設定 | uri `https://line-harness-web-a61.pages.dev/booking/hours` |
| 右 | 1666, 0, 834, 843 | 明日の予約 | postback `action=admin_tomorrow_bookings` |

- `chatBarText`: `メニュー`
- `selected`: `true`
- `name`: `院長メニュー`（管理用）

## 前提（既存実装）

以下は既に実装済みなので変更不要：

- `apps/worker/src/services/admin-postback.ts` — `replyTodayBookings` と `replyBookingDetail` が実装済み
- `apps/worker/src/routes/webhook.ts` — postback イベントで `action=admin_` プレフィックスを検知し、`account.admin_line_user_id === userId` を確認して `handleAdminPostback` に委譲する分岐が入っている
- `apps/worker/src/routes/webhook.ts` — follow イベント時に `account.admin_rich_menu_id` があれば自動で `linkRichMenuToUser` する処理が入っている
- `packages/db/migrations/023_admin_rich_menu.sql` — `line_accounts.admin_rich_menu_id` カラムと `admin_link_tokens` テーブルは作成済み
- `packages/db/src/line-accounts.ts` の `updateLineAccount` は `admin_rich_menu_id` の更新に対応済み
- 汎用リッチメニューAPI（`POST /api/rich-menus` など）は `apps/worker/src/routes/rich-menus.ts` にあり

## タスク

### 1. `replyTomorrowBookings` の追加

**ファイル**: `apps/worker/src/services/admin-postback.ts`

既存の `replyTodayBookings` を参考に「明日の予約」版を追加する。既存実装との重複を避けるため、共通処理を `replyBookingsByDate(db, lineClient, replyToken, targetDate, headerLabel, lineAccountId)` のような形でリファクタし、`replyTodayBookings` / `replyTomorrowBookings` がそれを呼ぶ構成にすること。

- `targetDate`: JST の "YYYY-MM-DD"
- `headerLabel`: Flex ヘッダに出すテキスト（例: `今日の予約` / `明日の予約`）
- 「明日」の計算: 現在のJST日付 + 1日。UTCでの日付加算に注意（`new Date(xxxT12:00:00Z)` を使って UTC 正午ベースで加算すると安全）
- 予約0件のときのテキストは「本日の予約はありません。」ではなく可変にする（今日は「本日」、明日は「明日」）

その上で `handleAdminPostback` の switch 文に以下を追加：

```ts
case 'admin_tomorrow_bookings':
  await replyTomorrowBookings(db, lineClient, replyToken, lineAccountId);
  break;
```

動作確認として、`pnpm -r build`（または相当コマンド）が通ることを確認する。

### 2. 院長用リッチメニューを作成するスクリプト

**場所**: `scripts/create-admin-rich-menu.sh`（なければ作成）

このスクリプトは次のことを行う：

1. 画像ファイルパスと対象 `line_account_id` を引数で受け取る
2. `POST /api/rich-menus` でリッチメニュー構造を登録し、`richMenuId` を取得
3. `POST /api/rich-menus/{richMenuId}/image` で画像をバイナリアップロード
4. 受け取った `richMenuId` を標準出力に表示（次のステップで手動SQLに使うため）

環境変数:
- `API` … Worker の URL（デフォルト `https://line-harness.nogardwons.workers.dev`）
- `KEY` … API キー（system_admin か clinic_admin のもの）

使い方の例：

```bash
KEY=lh_xxx bash scripts/create-admin-rich-menu.sh ./admin-menu.png <line_account_id>
```

登録する JSON ペイロードは上記「最終的な構成」の表どおり。

**重要**: `resolvedLineAccountId` は staff の所属院から自動解決されるが、system_admin でスクリプトを動かす場合は `line_account_id` クエリパラメータを付ける必要がある。スクリプトは `?line_account_id=...` を付与する形にすること。

### 3. DB 更新手順の明記

`line_accounts.admin_rich_menu_id` を更新する API は追加せず、SQL で直接更新する方針（今回は1回切り、将来院を増やしたときも SQL 1行で済むため）。

作成したスクリプトの末尾、または README に以下の手順を明記する：

```bash
# ローカルD1の場合
npx wrangler d1 execute line-harness --command \
  "UPDATE line_accounts SET admin_rich_menu_id = 'richmenu-xxxxxxxxxxxxxxxxx' WHERE id = '<line_account_id>';"

# 本番D1の場合
npx wrangler d1 execute line-harness --remote --command \
  "UPDATE line_accounts SET admin_rich_menu_id = 'richmenu-xxxxxxxxxxxxxxxxx' WHERE id = '<line_account_id>';"
```

### 4. 院長への手動適用手順の明記

webhook の follow イベント時に自動アサインが走るので、**院長がいったん友だち解除 → 再追加** すれば自動で付く。これが一番ラク。

ただし院長を友だち解除させたくない場合のため、curl での手動アサイン手順も README に記載する：

```bash
curl -X POST "https://api.line.me/v2/bot/user/{admin_line_user_id}/richmenu/{rich_menu_id}" \
  -H "Authorization: Bearer {channel_access_token}"
```

`admin_line_user_id` は `SELECT admin_line_user_id FROM line_accounts WHERE id = '...'` で取得、`channel_access_token` は同テーブルから。

### 5. デプロイ

変更は Worker のコードのみ（`admin-postback.ts` の追記）。`apps/worker` 配下で：

```bash
cd apps/worker
npm run deploy   # vite build && wrangler deploy（wrangler deploy 単体はNG）
```

## 受け入れ基準

- [ ] `apps/worker/src/services/admin-postback.ts` に `replyTomorrowBookings`（または共通関数経由の実装）が追加されている
- [ ] `handleAdminPostback` の switch に `admin_tomorrow_bookings` ケースが追加されている
- [ ] `scripts/create-admin-rich-menu.sh` が作成されており、画像パスと `line_account_id` を引数に取ってリッチメニュー作成＋画像アップロードを実行できる
- [ ] README か当ファイルに「SQL で `admin_rich_menu_id` を更新する手順」と「院長への手動適用手順」が明記されている
- [ ] `npm run deploy` で Worker がデプロイ済みで、postback で今日・明日の予約が Flex で返ってくることを実機確認済み

## 確認が必要なもの

- 画像ファイル（2500×843 PNG、1MB以下、各エリアの中央にラベルが入ったもの）は別途ユーザー側で用意する
- テスト用の `line_account_id` と API キーはユーザー側が指定する
