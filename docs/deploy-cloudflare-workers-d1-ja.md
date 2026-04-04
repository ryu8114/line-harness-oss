# Cloudflare Workers + D1 セットアップ手順

このリポジトリを次の配置先で運用する前提の手順書です。

- 作業親ディレクトリ: `/home/tanaka/.openclaw/workspace-main/projects/website-leads-business`
- リポジトリ配置先: `/home/tanaka/.openclaw/workspace-main/projects/website-leads-business/line-harness-oss`

## 1. リポジトリを取得

```bash
cd /home/tanaka/.openclaw/workspace-main/projects/website-leads-business
git clone https://github.com/Shudesu/line-harness-oss.git
cd /home/tanaka/.openclaw/workspace-main/projects/website-leads-business/line-harness-oss
pnpm install
```

## 2. Cloudflare にログイン

```bash
npx wrangler login
npx wrangler whoami
```

`account_id` を控えて `apps/worker/wrangler.toml` の `account_id` に入れます。

## 3. LINE Developers で 2 つのチャネルを用意

- Messaging API チャネル
- LINE Login チャネル

控える値:

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_LOGIN_CHANNEL_ID`
- `LINE_LOGIN_CHANNEL_SECRET`

## 4. D1 と R2 を作成

```bash
npx wrangler d1 create line-harness
npx wrangler r2 bucket create line-harness-images
```

D1 作成時の `database_id` を控えます。

## 5. wrangler.toml を更新

対象: `apps/worker/wrangler.toml`

更新する値:

- `account_id = "YOUR_DEV_ACCOUNT_ID"`
- `database_id = "YOUR_DEV_D1_DATABASE_ID"`

固定値:

- `name = "line-harness"`
- `database_name = "line-harness"`
- `bucket_name = "line-harness-images"`

## 6. D1 にスキーマ適用

```bash
npx wrangler d1 execute line-harness --config apps/worker/wrangler.toml --file=packages/db/schema.sql
```

## 7. Cloudflare Secrets を登録

```bash
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put API_KEY
npx wrangler secret put LINE_LOGIN_CHANNEL_ID
npx wrangler secret put LINE_LOGIN_CHANNEL_SECRET
```

必要に応じて追加:

```bash
npx wrangler secret put WORKER_URL
npx wrangler secret put LIFF_URL
```

## 8. ローカル確認

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm db:migrate:local
pnpm dev:worker
```

ローカル URL:

- Worker: `http://localhost:8787`

## 9. 本番デプロイ

```bash
pnpm deploy:worker
```

デプロイ後に確認する URL:

- Webhook: `https://<your-worker-subdomain>.workers.dev/webhook`
- LINE Login 導線: `https://<your-worker-subdomain>.workers.dev/auth/line?ref=test`

## 10. LINE Developers の設定

Messaging API チャネルで Webhook URL を次に設定:

```text
https://<your-worker-subdomain>.workers.dev/webhook
```

Webhook を有効化し、検証を成功させます。

## 11. API 疎通確認

```bash
curl -H "Authorization: Bearer <API_KEY>" \
  https://<your-worker-subdomain>.workers.dev/api/friends/count
```
