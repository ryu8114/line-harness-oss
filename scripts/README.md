# scripts/

Worker 運用スクリプト集。

---

## create-admin-rich-menu.sh — 院長用リッチメニューのセットアップ

### 前提

- `jq` がインストールされていること
- Worker が `https://line-harness.nogardwons.workers.dev` にデプロイ済みであること
- 画像ファイル（2500×843 px PNG、1 MB 以下）が手元にあること
- migration 023 が本番 D1 に適用済みであること（`admin_rich_menu_id` カラム）

### Step 1: リッチメニューを作成・画像アップロード

```bash
KEY=lh_xxx bash scripts/create-admin-rich-menu.sh ./admin-menu.png <line_account_id>
```

| 変数 | 説明 |
|---|---|
| `KEY` | API キー（`system_admin` または当該院の `clinic_admin`） |
| `API` | Worker URL（省略時: `https://line-harness.nogardwons.workers.dev`） |
| `$1` | PNG 画像ファイルのパス |
| `$2` | 対象の `line_account_id` |

スクリプトが成功すると `richMenuId`（例: `richmenu-xxxxxxxxxxxxxxxxx`）が表示されます。

### Step 2: D1 に admin_rich_menu_id を保存

```bash
# 本番 D1
npx wrangler d1 execute line-harness --remote --command \
  "UPDATE line_accounts SET admin_rich_menu_id = 'richmenu-xxxxxxxxxxxxxxxxx' WHERE id = '<line_account_id>';"

# ローカル D1（開発時）
npx wrangler d1 execute line-harness --command \
  "UPDATE line_accounts SET admin_rich_menu_id = 'richmenu-xxxxxxxxxxxxxxxxx' WHERE id = '<line_account_id>';"
```

### Step 3: 院長にリッチメニューを適用

**推奨 — 友だち再追加（最もラク）**

1. 院長に LINE 公式アカウントを **友だち解除** してもらう
2. 再度 **友だち追加** してもらう
3. follow イベント時に Worker が自動で `linkRichMenuToUser` を呼ぶ

**代替 — curl で直接リンク（友だち解除させたくない場合）**

`admin_line_user_id` と `channel_access_token` を D1 から取得してから実行します。

```bash
# admin_line_user_id と channel_access_token を確認
npx wrangler d1 execute line-harness --remote --command \
  "SELECT admin_line_user_id, channel_access_token FROM line_accounts WHERE id = '<line_account_id>';"

# リッチメニューを院長ユーザーにリンク
curl -X POST \
  "https://api.line.me/v2/bot/user/{admin_line_user_id}/richmenu/{rich_menu_id}" \
  -H "Authorization: Bearer {channel_access_token}"
```
