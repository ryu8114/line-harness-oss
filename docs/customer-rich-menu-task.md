# 顧客向けリッチメニューの実装・セットアップ

1人オーナーの整体院の患者向けに、LINE公式アカウントのリッチメニュー（ハーフサイズ3分割）を用意する。既存の院長向けリッチメニュー機構（`admin_rich_menu_id` / webhook follow 自動適用）とは独立した仕組みで、**デフォルトリッチメニュー**として全友だちに適用する。

## 最終的な構成

ハーフサイズ（2500×843）の3分割リッチメニュー。

```
┌─────────────┬─────────────┬─────────────┐
│  予約する    │  予約確認   │  お店情報   │
│   (uri)     │   (uri)     │  (postback) │
└─────────────┴─────────────┴─────────────┘
```

| エリア | 位置 (x, y, w, h) | ラベル | アクション |
|---|---|---|---|
| 左 | 0, 0, 833, 843 | 予約する | uri `https://liff.line.me/{liff_id}?line_account_id={id}&page=booking` |
| 中 | 833, 0, 833, 843 | 予約確認 | uri `https://liff.line.me/{liff_id}?line_account_id={id}&page=my-bookings` |
| 右 | 1666, 0, 834, 843 | お店情報 | postback `action=customer_shop_info` |

- `chatBarText`: `メニュー`
- `selected`: `true`
- `name`: `顧客メニュー`（管理用）

## 前提（既存実装）

以下は既に実装済み：

- 新規予約LIFF（`apps/worker/src/client/booking.ts`）— `?page=booking&line_account_id=xxx` で起動
- 公開予約API（`apps/worker/src/routes/booking-public.ts`）— `verifyLiffIdToken` ヘルパーが使える
- `getFriendByLineUserId`, `getBookingById`, `createBooking`, `updateBookingEventId`, `getConfirmedBookingsInRange` 等のDB関数
- `apps/worker/src/services/booking-notifications.ts` の `sendBookingConfirmation` / `notifyAdminNewBooking`
- Googleカレンダー連携（`GoogleCalendarClient` の `createEvent` / `deleteEvent` / `updateEvent` があるかは未確認 → 要確認）
- webhook.ts の postback 分岐（既存の `action=admin_` 分岐と、友だち向けの auto_replies 分岐）

## タスク

### 1. DB マイグレーション追加

**ファイル**: `packages/db/migrations/024_customer_booking.sql`（新規）

```sql
-- キャンセル期限（何時間前までキャンセル可能か）。デフォルト24時間
ALTER TABLE line_accounts ADD COLUMN cancel_deadline_hours INTEGER NOT NULL DEFAULT 24;

-- 店舗情報（お店情報Flexで返す内容、JSON文字列）
-- 形式例: {"address":"奈良県橿原市...","phone":"0744-XX-XXXX","hours":"月〜金 10:00〜20:00\n土 10:00〜18:00\n日曜 定休","mapUrl":"https://maps.google.com/..."}
ALTER TABLE line_accounts ADD COLUMN shop_info TEXT;

-- 顧客用リッチメニューID（画像アップロード・デフォルト設定したリッチメニューのID）
ALTER TABLE line_accounts ADD COLUMN customer_rich_menu_id TEXT;
```

本番適用: `npx wrangler d1 execute line-harness --remote --file=packages/db/migrations/024_customer_booking.sql`

### 2. DB 関数の追加

**ファイル**: `packages/db/src/bookings.ts`（または該当ファイル）

既存の `getBookingsByAccount` を参考に、以下を追加：

```ts
export async function getBookingsByFriendId(
  db: D1Database,
  friendId: string,
  opts?: { from?: string; to?: string; status?: string; lineAccountId?: string },
): Promise<BookingRow[]>
```

- `friend_id = ?` で絞る
- `from`/`to` は `start_at` で範囲絞り込み
- `status` 指定時はそのステータスのみ
- `lineAccountId` 指定時はその院のみ（念のため）
- `ORDER BY start_at ASC`

さらに、日時変更用に予約時間を更新する関数を追加：

```ts
export async function updateBookingSchedule(
  db: D1Database,
  id: string,
  startAt: string,
  endAt: string,
): Promise<BookingRow | null>
```

- `start_at`, `end_at`, `updated_at` を更新
- ステータスが `confirmed` の場合のみ成功とする（それ以外は null を返す）

**ファイル**: `packages/db/src/line-accounts.ts`

`UpdateLineAccountInput` に `cancel_deadline_hours` と `shop_info` と `customer_rich_menu_id` を追加し、`updateLineAccount` の分岐にも追加する。

### 3. 顧客公開API の追加

**ファイル**: `apps/worker/src/routes/booking-public.ts`

既存の `verifyLiffIdToken` を流用して以下を追加：

#### a. `GET /api/public/my-bookings`

- クエリ: `line_account_id`
- ヘッダ: `X-LIFF-ID-Token`
- 動作:
  1. IDトークン検証 → `lineUserId` 取得
  2. `getFriendByLineUserId(db, lineUserId)` で friend 取得（nullなら空配列で200返す）
  3. JST今日の00:00以降を `from` として `getBookingsByFriendId(db, friend.id, { from, status: 'confirmed', lineAccountId })` で取得
  4. `{ id, startAt, endAt, menuName, menuDuration, menuPrice, customerNote }[]` を返す

#### b. `POST /api/public/my-bookings/:id/cancel`

- ボディ: なし（または `{ reason?: string }`）
- 動作:
  1. IDトークン検証 → `lineUserId` 取得
  2. `getFriendByLineUserId` で friend 取得（なければ401）
  3. `getBookingById(db, id)` で取得
  4. **権限確認**: `booking.friend_id === friend.id` かつ `booking.line_account_id === lineAccountId` でなければ403
  5. **状態確認**: `booking.status === 'confirmed'` でなければ400
  6. **時間制限チェック**:
     - `account.cancel_deadline_hours` 時間前を過ぎていれば400、エラーメッセージ「キャンセル期限を過ぎています」
     - 計算: `(new Date(booking.start_at).getTime() - Date.now()) / 3600000 < account.cancel_deadline_hours` なら期限切れ
  7. `bookings.status = 'cancelled'` に更新（既存の `updateBookingStatus` を流用）
  8. Googleカレンダーから削除（ベストエフォート、既存 `booking-admin.ts` のキャンセル処理と同じロジック）
  9. 該当の `friend_reminders` を `cancelled` にする（DB関数があればそれを使う、なければ直接UPDATE）
  10. 院長へ通知（後述の `notifyAdminBookingCancelled` を呼ぶ）
  11. 成功レスポンスを返す

#### c. `PUT /api/public/my-bookings/:id/reschedule`

- ボディ: `{ date: "YYYY-MM-DD", time: "HH:MM" }`
- 動作:
  1. IDトークン検証 → `lineUserId` 取得
  2. friend取得 → `getBookingById` → 権限確認 → 状態確認（上記 cancel と同じ）
  3. **時間制限チェック**: キャンセルと同じ基準。`account.cancel_deadline_hours` 時間前を過ぎていれば400
  4. 新しい `startAt` / `endAt` を計算（既存のメニュー duration を使用）
  5. **空き枠チェック**: `getConfirmedBookingsInRange(db, lineAccountId, newStartAt, newEndAt)` で衝突がないか。
     - ただし **自分自身の予約は除外** する（そうしないと「同じ時間に変更」が競合扱いされる）
     - 実装: 取得結果から `b.id !== bookingId` でフィルタ
  6. `updateBookingSchedule(db, id, newStartAt, newEndAt)` で更新
  7. **Googleカレンダーも更新**: `google-calendar.ts` に `updateEvent` がなければ「削除＋再作成」でフォールバック。実装前に `google-calendar.ts` を確認してどちらかを選ぶ
  8. **前日リマインドを更新**:
     - 既存の `friend_reminders` レコードの `target_date` を新しい日付に更新
     - 該当レコードがなければ新規登録（`registerBookingReminder` を流用できる形にリファクタ）
  9. 院長へ通知（後述の `notifyAdminBookingRescheduled` を呼ぶ）
  10. 更新後のbookingを返す

### 4. 通知関数の追加

**ファイル**: `apps/worker/src/services/booking-notifications.ts`

既存の `notifyAdminNewBooking` に対となる関数を追加：

#### `notifyAdminBookingCancelled(db, accessToken, adminLineUserId, booking, lineAccountId?)`

- event-bus に `booking_cancelled` イベント発火
- 院長LINEへ直接push（テキスト）:
  ```
  【予約キャンセル】
  {customer_name} 様
  {menu_name_snapshot}
  {日時}
  ```

#### `notifyAdminBookingRescheduled(db, accessToken, adminLineUserId, oldBooking, newBooking, lineAccountId?)`

- event-bus に `booking_rescheduled` イベント発火
- 院長LINEへ直接push（テキスト）:
  ```
  【予約変更】
  {customer_name} 様
  {menu_name_snapshot}
  変更前: {oldStartAt の日時}
  変更後: {newStartAt の日時}
  ```

### 5. `customer-postback.ts` の新設

**ファイル**: `apps/worker/src/services/customer-postback.ts`（新規）

院長側の `admin-postback.ts` と同じパターンで、友だち向けの postback を処理する。

```ts
export async function handleCustomerPostback(
  db: D1Database,
  lineClient: LineClient,
  replyToken: string,
  postbackData: string,
  lineAccountId: string,
): Promise<void>
```

対応する action:
- `action=customer_shop_info` → 店舗情報 Flex を reply

実装:
- `line_accounts.shop_info` から JSON を読み取る（未設定なら「店舗情報が登録されていません」とテキストで返す）
- JSON の内容を Flex bubble に整形:
  - ヘッダ: 院の `name`
  - 本文: 住所、電話、営業時間（複数行対応）
  - フッタボタン:
    - 「地図を見る」→ uri action で `mapUrl` を開く（mapUrlが設定されていれば）
    - 「電話をかける」→ uri action で `tel:{phone}` を開く
- `flexBubble`, `flexBox`, `flexText` は `@line-crm/line-sdk` から import（院長側と同じ）

### 6. webhook.ts の postback 分岐に追加

**ファイル**: `apps/worker/src/routes/webhook.ts`

既存の admin_postback 分岐の下に、顧客向け分岐を追加する。

```ts
// 顧客リッチメニューの postback
if (postbackData.startsWith('action=customer_')) {
  if (lineAccountId) {
    try {
      await handleCustomerPostback(db, lineClient, event.replyToken, postbackData, lineAccountId);
    } catch (err) {
      console.error('Customer postback error:', err);
    }
  }
  return;
}
```

**注意**: 顧客postbackは friends レコード不要で処理する（店舗情報を返すだけなら friend 不要）。ただし将来 friend に紐づく処理を追加するなら、`getFriendByLineUserId` で取得する分岐を追加する。

### 7. 新 LIFF 画面 `my-bookings.ts`

**ファイル**: `apps/worker/src/client/my-bookings.ts`（新規）

既存の `apps/worker/src/client/admin-booking.ts` と `booking.ts` を参考に実装する。

#### 画面構成

- **一覧画面**: 今後の予約（confirmed のみ、日時昇順）
  - 各項目: 日時、メニュー名、所要時間、料金
  - 項目タップで詳細画面へ
  - 0件のとき: 「現在ご予約はありません」＋「新しく予約する」ボタン → 新規予約LIFF（同ページ内遷移）
- **詳細画面**: 一覧の項目タップで遷移
  - 日時、メニュー、所要時間、料金、備考
  - 「日時を変更」ボタン → 変更フロー
  - 「キャンセル」ボタン → キャンセル確認画面
  - 「戻る」ボタン → 一覧へ
- **キャンセル確認画面**: 対象予約を再表示 + 「本当にキャンセルしますか？」
  - 「キャンセル実行」「やめる」の2ボタン
- **完了画面（キャンセル）**: 「キャンセルを受け付けました」+ 「戻る」
- **日時変更フロー**:
  - メニューは固定（変更不可）、カレンダーで日付選択 → 時間選択 → 確認 → 完了
  - 既存の `booking.ts` のカレンダー・時間選択ロジックをできる限り流用
  - 確定時は `PUT /api/public/my-bookings/:id/reschedule` を呼ぶ
- **完了画面（変更）**: 「予約を変更しました」+ 「戻る」
- **エラー画面**: API エラー時。メッセージ表示と「再読み込み」ボタン

#### 認証

`booking.ts` と同様、LIFF SDK で `getIDToken()` を取得し、`X-LIFF-ID-Token` ヘッダで API を呼ぶ。

#### ページ分岐

`?page=my-bookings` で `initMyBookings()` を起動するよう、既存のルーティング（index.html / main.ts の page 判定箇所）に分岐を追加する。既存ファイルの page 判定方法を確認してから追記すること。

### 8. 管理画面からの編集UI

**ファイル**: `apps/web/src/app/booking/hours/page.tsx`（既存、または新規ページ）

キャンセル期限と店舗情報を編集できるフォームを追加する。どこに置くかは既存UIの構成次第。以下の候補から選ぶ：

- 候補A: `/booking/hours` の下部に追加（営業時間と同じ画面）
- 候補B: 新規 `/booking/settings` ページを作る
- 候補C: `/settings/store-info` として独立

**実装内容**:
- `cancel_deadline_hours`（数値入力、単位:時間）
- `shop_info.address`（テキスト）
- `shop_info.phone`（テキスト）
- `shop_info.hours`（複数行テキスト、改行で区切る）
- `shop_info.mapUrl`（URL）
- 保存ボタン → `PUT /api/line-accounts/:id` を呼ぶ（既存APIルートに `cancelDeadlineHours`, `shopInfo` を受ける処理を追加する必要がある）

**line-accounts のルート修正**: 既存の `apps/worker/src/routes/line-accounts.ts` の PUT ハンドラで、新カラムをリクエストボディから受け取って `updateLineAccount` に渡すようにする。

### 9. リッチメニュー作成スクリプト

**ファイル**: `scripts/create-customer-rich-menu.sh`（新規）

前回作成した `scripts/create-admin-rich-menu.sh` を参考に、顧客用リッチメニューを作成するスクリプトを作る。院長版との違いは **デフォルトリッチメニューに設定する** 点。

引数: 画像パス、`line_account_id`、顧客用LIFF URL（uri アクション用）

処理:
1. `POST /api/rich-menus` でメニュー構造を登録（areas: 上記の表どおり）
2. `POST /api/rich-menus/:id/image` で画像アップロード
3. `POST /api/rich-menus/:id/default` でデフォルトに設定
4. `richMenuId` を標準出力

registerするJSONペイロード例（areas部分）:

```json
[
  {
    "bounds": { "x": 0, "y": 0, "width": 833, "height": 843 },
    "action": { "type": "uri", "uri": "https://liff.line.me/{liff_id}?line_account_id={account_id}&page=booking", "label": "予約する" }
  },
  {
    "bounds": { "x": 833, "y": 0, "width": 833, "height": 843 },
    "action": { "type": "uri", "uri": "https://liff.line.me/{liff_id}?line_account_id={account_id}&page=my-bookings", "label": "予約確認" }
  },
  {
    "bounds": { "x": 1666, "y": 0, "width": 834, "height": 843 },
    "action": { "type": "postback", "data": "action=customer_shop_info", "label": "お店情報" }
  }
]
```

スクリプトでは uri 中の `{liff_id}` と `{account_id}` を引数か環境変数で差し替えられるようにする。

### 10. DB 更新手順の明記

`line_accounts.customer_rich_menu_id` をセットする手順を scripts/README.md または CLAUDE.md に追記：

```bash
# ローカル
npx wrangler d1 execute line-harness --command \
  "UPDATE line_accounts SET customer_rich_menu_id = 'richmenu-xxx' WHERE id = '<line_account_id>';"

# 本番
npx wrangler d1 execute line-harness --remote --command \
  "UPDATE line_accounts SET customer_rich_menu_id = 'richmenu-xxx' WHERE id = '<line_account_id>';"
```

加えて、既存の友だち全員にはデフォルトリッチメニュー設定で自動的に反映される（新規友だち含む）。個別アサインされている友だちには効かないが、そういう友だちがいない前提で運用する。

### 11. デプロイ

```bash
cd apps/worker
npm run deploy   # vite build && wrangler deploy（wrangler deploy 単体は NG）
```

管理画面（apps/web）を触ったら Pages 側のデプロイも必要（通常は git push で自動）。

## 受け入れ基準

- [ ] migration 024 が本番 D1 に適用済み
- [ ] `getBookingsByFriendId` / `updateBookingSchedule` が DB 関数に追加されている
- [ ] `GET /api/public/my-bookings` / `POST /api/public/my-bookings/:id/cancel` / `PUT /api/public/my-bookings/:id/reschedule` が動作する
- [ ] キャンセル期限超過時に400エラーが返る
- [ ] 日時変更時、自分自身の予約は衝突チェックから除外される
- [ ] 日時変更時、Googleカレンダーも更新される
- [ ] 日時変更時、前日リマインドの `target_date` も更新される
- [ ] キャンセル・変更時に院長へ通知が飛ぶ
- [ ] `customer-postback.ts` が `action=customer_shop_info` を処理し、店舗情報 Flex を返す
- [ ] webhook.ts の postback 分岐で `customer_` プレフィックスが振り分けられている
- [ ] LIFF `?page=my-bookings` で一覧・詳細・キャンセル・日時変更の画面が動作する
- [ ] 管理画面からキャンセル期限と店舗情報を編集・保存できる
- [ ] `scripts/create-customer-rich-menu.sh` で顧客用リッチメニューが作成できる（画像ファイルは別途用意）
- [ ] `SELECT customer_rich_menu_id FROM line_accounts WHERE id = '...'` で値がセットされている
- [ ] 実機で3ボタンが表示され、それぞれの動作を確認済み

## 確認が必要なもの（実装前に要チェック）

- 画像ファイル（2500×843 PNG、1MB以下）は別途ユーザー側で用意する
- `google-calendar.ts` に `updateEvent` メソッドがあるか。なければ「削除＋再作成」で実装
- `friend_reminders` テーブルの target_date 更新関数があるか。なければ新設 or 直接UPDATE
- `apps/worker/src/client/` 配下の既存ルーティング（page 判定）の仕組み。`main.ts` などで `?page=xxx` を見て分岐している箇所に `my-bookings` を追加
- `apps/worker/src/routes/line-accounts.ts` の PUT ハンドラに `cancelDeadlineHours` / `shopInfo` を追加する必要がある
- 既存の patient 向け LIFF の page 判定が、`booking.ts` をデフォルトとして動いている前提でOKか

## 作業順序の推奨

1. マイグレーション作成・ローカル適用
2. DB関数追加（`getBookingsByFriendId`, `updateBookingSchedule`）
3. 公開API追加（`GET`, `POST cancel`, `PUT reschedule`）
4. 通知関数追加（`notifyAdminBookingCancelled`, `notifyAdminBookingRescheduled`）
5. `customer-postback.ts` 新設 + webhook.ts 分岐追加
6. LIFF画面 `my-bookings.ts` 実装
7. 管理画面の編集UI追加 + `line-accounts.ts` PUT ハンドラ修正
8. 本番マイグレーション適用
9. デプロイ
10. `scripts/create-customer-rich-menu.sh` で実機にリッチメニュー登録
11. SQL で `customer_rich_menu_id` 更新
12. 実機確認
