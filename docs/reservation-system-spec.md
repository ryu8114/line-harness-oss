# LINE予約システム 仕様・運用マニュアル

> 整体院・美容院・ネイルサロンなど、1人オーナー向けのLINE公式アカウント連携予約システムです。

---

## 目次

1. [システム概要](#1-システム概要)
2. [機能一覧](#2-機能一覧)
3. [顧客向け予約フロー](#3-顧客向け予約フロー)
4. [院長・スタッフ向け管理機能](#4-院長スタッフ向け管理機能)
5. [リマインド通知の仕組み](#5-リマインド通知の仕組み)
6. [予約の制約・設定項目](#6-予約の制約設定項目)
7. [導入手順（院ごとの初期設定）](#7-導入手順院ごとの初期設定)
8. [運用手順（日常操作）](#8-運用手順日常操作)
9. [システム構成・インフラ](#9-システム構成インフラ)
10. [Google Calendar連携](#10-google-calendar連携)
11. [未実装・Phase 2 機能](#11-未実装phase-2-機能)

---

## 1. システム概要

### サービスの特徴

- **LINEだけで完結**: 顧客はアプリを別途インストール不要。LINE公式アカウントのリッチメニューから予約できる
- **LIFF（LINE内ブラウザ）**: 予約フォームはLINE内で動作し、LINE認証と連携することで顧客情報の入力負担を軽減
- **院長もLINEで確認**: 当日・翌日の予約一覧をLINEから確認できる院長向けLIFF付き
- **複数院対応**: 同一システムで複数の院を管理可能。院ごとにデータが完全分離される

### 利用技術

| レイヤー | 技術 |
|---------|------|
| バックエンド | Cloudflare Workers (TypeScript) |
| データベース | Cloudflare D1 (SQLite互換) |
| 管理画面 | Next.js (Cloudflare Pages) |
| LINE連携 | LINE Messaging API + LIFF |
| カレンダー連携 | Google Calendar API（オプション） |

---

## 2. 機能一覧

### 顧客向け機能

| 機能 | 説明 |
|------|------|
| 新規予約 | メニュー選択→日時選択（週間グリッド）→顧客情報入力→確認 |
| 予約確認 | 今後の予約一覧をLINEから確認 |
| キャンセル | キャンセル期限内であればLINEから自己キャンセル可 |
| 日時変更 | 別の空き日時に変更可（キャンセル期限内） |
| 前日リマインド | 予約の前日18時頃にLINEでリマインドメッセージが届く |
| お店情報 | 住所・電話・営業時間・Google マップURLを表示 |

### 院長・スタッフ向け機能

| 機能 | 説明 |
|------|------|
| 予約一覧 | 日付・ステータスでフィルタ可能な一覧 |
| 予約ステータス変更 | confirmed / completed / no_show などを手動更新 |
| メニュー管理 | 施術メニューのCRUD（名前・時間・料金・説明・表示順） |
| 営業時間設定 | 曜日別の営業時間・休憩時間を設定 |
| 例外日設定 | 臨時休業・部分営業を日付単位で登録 |
| 予約設定 | キャンセル期限・最短予約時間・スロット単位・店舗情報 |
| LINE通知 | 新規予約・キャンセル・日時変更が発生したら院長LINEへ即時通知 |
| 今日の予約（LIFF） | 当日・翌日の予約をLINEから一覧表示 |

---

## 3. 顧客向け予約フロー

### 3-1. 予約作成

```
LINEリッチメニュー「予約する」
  ↓
① メニュー選択（施術内容）
  ↓
② 週間カレンダーから日付選択
  ↓
③ 空きスロットから時間選択（30分単位）
  ↓
④ 顧客情報入力（お名前・電話番号・ご要望）
  ↓
⑤ 確認画面
  ↓
⑥ 予約完了 → LINEに確認メッセージ送信
           → 院長LINEに新規予約通知
           → 前日リマインドを自動登録
```

**入力項目**

| 項目 | 必須/任意 | 説明 |
|------|---------|------|
| お名前 | 必須 | 表示名として使用 |
| 電話番号 | 任意 | 電話リンク表示に使用 |
| ご要望・メモ | 任意 | 院長確認用（リマインドには含めない） |

### 3-2. 予約確認・キャンセル・日時変更

```
LINEリッチメニュー「予約確認」
  ↓
今後の確定予約一覧を表示
  ↓
各予約にキャンセル / 日時変更ボタン
  ↓
キャンセル → 即時キャンセル（期限内のみ）
           → 院長LINEに通知

日時変更 → 新しい日時を選択
         → 確認画面 → 完了
         → 院長LINEに通知
```

**制限**
- キャンセル・変更ともに「予約日時の○時間前まで」という期限を院ごとに設定可（デフォルト: 24時間前）
- 期限を過ぎた場合は画面にメッセージを表示し、院への連絡を案内

---

## 4. 院長・スタッフ向け管理機能

### 4-1. 管理画面へのアクセス

管理画面URL：`https://line-harness-web-a61.pages.dev`

ログイン方法：

```
https://line-harness-web-a61.pages.dev/login?key=<APIキー>
```

- URLにアクセスするだけで自動ログイン（keyパラメータはURLから即削除されセキュア）
- 院長ごとに個別のAPIキーを発行

### 4-2. メニュー管理（`/booking/menus`）

各院の施術メニューを管理する。

| 設定項目 | 説明 |
|---------|------|
| メニュー名 | 顧客に表示される名前 |
| 施術時間（分） | スロット計算に使用 |
| 料金（円） | 予約確認画面に表示 |
| 説明文 | 任意のメモ |
| 有効/無効 | 無効にすると顧客の選択肢から除外 |
| 表示順 | 並び順を自由に変更可 |

### 4-3. 営業時間設定（`/booking/business-hours`）

曜日ごとに設定。

| 設定項目 | 説明 |
|---------|------|
| 営業開始・終了時刻 | その曜日の受付時間 |
| 休憩開始・終了時刻 | この時間帯は予約不可 |
| 定休日設定 | 開始・終了をNULLにすると終日予約不可 |

### 4-4. 例外日設定（`/booking/exceptions`）

臨時の休業・特別営業時間を日付単位で登録。

| 種類 | 説明 |
|-----|------|
| 全休（closed） | その日は終日予約不可 |
| 部分営業（partial） | 指定した時間帯のみ予約可 |

### 4-5. 予約一覧（`/booking/list`）

- 日付・ステータスでフィルタ表示
- ステータス: `confirmed`（確定）/ `completed`（施術完了）/ `cancelled`（キャンセル）/ `no_show`（無断キャンセル）
- 各予約の詳細確認・ステータス手動変更が可能

### 4-6. 予約設定（`/booking/settings`）

| 設定項目 | デフォルト | 説明 |
|---------|-----------|------|
| キャンセル期限 | 24時間前 | この時間を過ぎると顧客は自己キャンセル不可 |
| 店舗情報 | — | 住所・電話・営業時間テキスト・Google マップURL |

### 4-7. 院長向けLIFF（LINE内予約確認）

院長のLINEリッチメニューから操作可能。

| ボタン | 機能 |
|-------|------|
| 今日の予約 | 当日の確定予約一覧を表示（名前・時刻・メニュー） |
| 明日の予約 | 翌日の確定予約一覧を表示 |
| 店舗設定 | 管理画面の営業時間設定ページへジャンプ |

---

## 5. リマインド通知の仕組み

### 前日リマインド

予約作成時に自動登録され、Cronジョブが5分ごとに配信チェックを行う。

```
予約作成
  ↓
前日18時 に配信するジョブを自動登録
  ↓
Cron（5分おき）で「前日18時になったか」を確認
  ↓
対象ジョブを実行 → 顧客LINEへリマインドメッセージ送信
```

**リマインドメッセージの内容（現状）**
```
【明日のご予約リマインド】
お気をつけてお越しください。
```

**設計上の注意**
- 同日に複数予約がある場合でも重複送信しない設計
- キャンセル・日時変更時はリマインドも自動更新・削除

### 汎用リマインダーシステム

予約リマインド以外にも、段階的なリマインド（例：3日前・1日前・当日など）を設定できる汎用リマインダーシステムも内包している。

---

## 6. 予約の制約・設定項目

### 時間制約

| 項目 | デフォルト | 設定場所 |
|------|-----------|---------|
| スロット単位 | 30分 | `line_accounts.slot_unit` |
| 最短予約時間 | 3時間前まで | `line_accounts.min_booking_hours` |
| 最大予約期限 | 14日先まで | `line_accounts.max_booking_days` |
| キャンセル期限 | 予約24時間前まで | `/booking/settings` |

### スロット計算ロジック

1. 営業時間から `slot_unit` 刻みでスロットを生成
2. 休憩時間・例外日をマスク
3. 既存の確定予約と重複するスロットを除外
4. Google Calendar上の予定と重複するスロットも除外（GCal連携時）
5. `min_booking_hours` 以内・`max_booking_days` 超のスロットを除外
6. 残った `available: true` のスロットのみ顧客に表示

### 競合・同時予約対策

- サーバー側で予約重複チェック実施（重複なら409エラー）
- 日時変更時は楽観的ロック（NOT EXISTS条件）で原子的に更新
- 競合発生時はGoogle Calendarの補償処理も実行

---

## 7. 導入手順（院ごとの初期設定）

### 手順1: LINE Messaging API チャンネル作成

1. LINE Developers でプロバイダー内に新しい Messaging API チャンネルを追加
2. Webhook URL を設定：
   ```
   https://line-harness.nogardwons.workers.dev/webhook
   ```
3. Webhook の利用をONにする

### 手順2: LIFFアプリ作成

LINE Developers でLIFFアプリを作成し、エンドポイントURLを設定：
```
https://line-harness.nogardwons.workers.dev/liff
```
- スコープ: `profile`, `openid`
- LIFFブラウザサイズ: Full

### 手順3: D1にデータ登録

```sql
-- 院情報を登録
INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active)
VALUES ('任意のID', 'チャンネルID', '院名', 'アクセストークン', 'チャンネルシークレット', 1);

-- 院長アカウントを登録
INSERT INTO staff_members (id, name, role, api_key, line_account_id)
VALUES (lower(hex(randomblob(16))), '院長名', 'clinic_admin', 'lh_任意のキー', '上記の院ID');
```

### 手順4: 予約機能を有効化

```sql
UPDATE line_accounts
SET booking_enabled = 1,
    liff_id = '<LIFF ID>',
    admin_line_user_id = NULL  -- 後で院長LINEと連携
WHERE id = '院ID';
```

### 手順5: 顧客向けリッチメニュー作成

画像（2500x843 PNG、1MB以下）を用意して実行：

```bash
KEY=lh_xxx bash scripts/create-customer-rich-menu.sh \
  ./customer-menu.png \
  <line_account_id> \
  https://liff.line.me/<liff_id>
```

表示された `richMenuId` を保存：

```sql
UPDATE line_accounts
SET customer_rich_menu_id = '<richMenuId>'
WHERE id = '<line_account_id>';
```

### 手順6: 院長リッチメニュー作成

```bash
KEY=lh_xxx bash scripts/create-admin-rich-menu.sh \
  ./admin-menu.png \
  <line_account_id> \
  https://liff.line.me/<liff_id>
```

### 手順7: 院長LIFF連携

院長に以下のURLを送付し、LINEでアクセスしてもらう（院長のLINE UserIDを紐付け）：

```
https://liff.line.me/<LIFF_ID>?line_account_id=<院ID>&page=admin-link
```

### 手順8: ログインURLを院長に渡す

```
https://line-harness-web-a61.pages.dev/login?key=lh_任意のキー
```

### 手順9: 管理画面で初期設定

院長が管理画面で以下を設定：
- `/booking/menus` — 施術メニューを登録
- `/booking/business-hours` — 営業時間・定休日を設定
- `/booking/settings` — キャンセル期限・店舗情報を入力

> **注意**: Worker・D1・Pagesの再デプロイは不要。新しい院を追加するたびにこの手順を繰り返すだけで対応可能。

---

## 8. 運用手順（日常操作）

### 予約の確認

**管理画面の場合**
1. `/booking/list` を開く
2. 日付フィルタで確認したい日を選択
3. ステータス `confirmed` で絞り込む

**LINEの場合**
1. 院長リッチメニューの「今日の予約」または「明日の予約」をタップ

### 臨時休業の設定

1. 管理画面 `/booking/exceptions` を開く
2. 「例外日を追加」ボタンをクリック
3. 日付を選択 → 「全休」を選択 → 保存
4. 以降その日は顧客の予約フォームに表示されなくなる

### メニューの追加・変更

1. 管理画面 `/booking/menus` を開く
2. 「メニューを追加」または既存メニューの「編集」ボタンをクリック
3. 名前・時間・料金を入力して保存

### 予約ステータスの更新

施術完了時など：
1. 管理画面 `/booking/list` で対象予約を開く
2. ステータスを `completed` に変更して保存

### Workerのデプロイ（開発者向け）

**必ず `npm run deploy` を使うこと（`wrangler deploy` 単体は NG）：**

```bash
cd apps/worker
npm run deploy   # vite build && wrangler deploy
```

### D1 マイグレーション実行（開発者向け）

```bash
npx wrangler d1 execute line-harness --remote --file=packages/db/migrations/<ファイル名>.sql
```

---

## 9. システム構成・インフラ

### エンドポイント

| 種類 | URL |
|-----|-----|
| Worker API | `https://line-harness.nogardwons.workers.dev` |
| 管理画面 | `https://line-harness-web-a61.pages.dev` |
| Webhook | `https://line-harness.nogardwons.workers.dev/webhook` |
| LIFF | `https://line-harness.nogardwons.workers.dev/liff` |

### 主要APIエンドポイント（内部）

**顧客向け（LIFF内から呼び出し）**

| メソッド | パス | 説明 |
|---------|-----|------|
| POST | `/api/public/bookings` | 予約作成 |
| GET | `/api/public/my-bookings` | 予約一覧取得 |
| POST | `/api/public/my-bookings/:id/cancel` | キャンセル |
| PUT | `/api/public/my-bookings/:id/reschedule` | 日時変更 |
| GET | `/api/public/booking-slots` | 空き日程一覧 |
| GET | `/api/public/booking-menus` | メニュー一覧 |
| GET | `/api/public/shop-info` | 店舗情報 |

**院長向け（APIキー認証）**

| メソッド | パス | 説明 |
|---------|-----|------|
| GET/POST | `/api/booking/admin/menus` | メニュー一覧・作成 |
| PUT/DELETE | `/api/booking/admin/menus/:id` | メニュー更新・削除 |
| GET/PUT | `/api/booking/admin/business-hours` | 営業時間 |
| GET/POST | `/api/booking/admin/schedule-exceptions` | 例外日 |
| GET | `/api/booking/admin/bookings` | 予約一覧 |
| PUT | `/api/booking/admin/bookings/:id` | 予約更新 |
| GET/PUT | `/api/booking/settings` | 予約設定 |

### データベース構成（主要テーブル）

| テーブル | 用途 |
|---------|------|
| `line_accounts` | LINE公式アカウント情報・各種設定 |
| `staff_members` | 院長・スタッフアカウント（ロール管理） |
| `calendar_bookings` | 予約データ本体 |
| `menus` | 施術メニュー |
| `business_hours` | 営業時間（曜日別） |
| `schedule_exceptions` | 例外日 |
| `reminders` | リマインダーマスタ |
| `reminder_steps` | リマインダーステップ定義 |
| `friend_reminders` | 顧客ごとのリマインド配信ジョブ |

### ロール定義

| ロール | 権限 |
|-------|------|
| `system_admin` | 全院データへのアクセス可 |
| `clinic_admin` | 自院のデータのみアクセス可（院長） |
| `staff` | 自院のデータのみアクセス可（スタッフ） |

---

## 10. Google Calendar連携

### 設定方法

管理画面の設定画面からGoogle Calendarと連携可能（オプション）。

### 連携内容

| タイミング | 処理 |
|---------|-----|
| 予約作成時 | Googleカレンダーに予定を作成 |
| 日時変更時 | 旧予定を削除し新予定を作成 |
| キャンセル時 | Googleカレンダーの予定を削除 |
| スロット計算時 | カレンダー上の予定を「空きなし」として反映 |

### 注意事項

- 連携はオプション。`connection_id` が未設定の場合はスキップされる
- GCal連携に失敗しても予約自体は成功する（ベストエフォート）
- 日時変更時の競合発生時は補償処理でGCalの不整合を自動解消

---

## 11. 未実装・Phase 2 機能

現時点で未実装の機能一覧（将来対応予定）。

| 機能 | 概要 |
|-----|------|
| 複数スタッフ対応 | 現状は1人オーナー専用。スタッフ別スロット管理は未対応 |
| リピーター自動入力 | 過去の顧客情報を次回予約時に自動入力 |
| 院長LIFFから臨時休業登録 | 現状は管理画面からのみ操作可 |
| アクセストークン暗号化 | `channel_access_token` は現状平文でDB保存 |
| メール通知 | 現状はLINEメッセージのみ |
| 予約リマインド内容カスタマイズ | 現状は固定文言 |

---

## 付録：リッチメニュー構成

### 顧客向けリッチメニュー（2500×843px）

```
┌──────────────┬──────────────┬──────────────┐
│   予約する   │  予約確認    │  お店情報    │
│  （LIFF開く）│  （LIFF開く）│  （LINEで表示）│
└──────────────┴──────────────┴──────────────┘
```

### 院長向けリッチメニュー（2500×843px）

```
┌──────────────┬──────────────┬──────────────┐
│  今日の予約  │  店舗設定    │  明日の予約  │
│  （LIFF開く）│  （管理画面）│  （LIFF開く）│
└──────────────┴──────────────┴──────────────┘
```
