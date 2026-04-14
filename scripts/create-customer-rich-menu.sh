#!/usr/bin/env bash
# 顧客向けリッチメニューを作成し、デフォルトリッチメニューとして設定するスクリプト
#
# 使い方:
#   KEY=lh_xxx bash scripts/create-customer-rich-menu.sh ./customer-menu.png <line_account_id> <liff_url>
#
# 例:
#   KEY=lh_test_seitai_admin bash scripts/create-customer-rich-menu.sh \
#     ./customer-menu.png \
#     4f1ff98d701860acb816e29805823b16 \
#     https://liff.line.me/2007654321-AbCdEfGh
#
# 環境変数:
#   API  — Worker の URL（デフォルト: https://line-harness.nogardwons.workers.dev）
#   KEY  — API キー（必須）
#
# 注意: 画像は 2500x843 PNG、1MB以下であること

set -euo pipefail

# ---------- 引数チェック ----------
IMAGE_FILE="${1:-}"
LINE_ACCOUNT_ID="${2:-}"
LIFF_URL="${3:-}"

if [[ -z "$IMAGE_FILE" || -z "$LINE_ACCOUNT_ID" || -z "$LIFF_URL" ]]; then
  echo "Usage: KEY=lh_xxx bash $0 <image_file> <line_account_id> <liff_url>" >&2
  echo "" >&2
  echo "  image_file      : 2500x843 PNG ファイルのパス（1MB以下）" >&2
  echo "  line_account_id : line_accounts.id" >&2
  echo "  liff_url        : https://liff.line.me/xxxx-xxxx" >&2
  exit 1
fi

if [[ ! -f "$IMAGE_FILE" ]]; then
  echo "Error: image file not found: $IMAGE_FILE" >&2
  exit 1
fi

# ---------- jq チェック ----------
if ! command -v jq &>/dev/null; then
  echo "Error: 'jq' is required but not installed." >&2
  echo "  macOS: brew install jq" >&2
  echo "  Linux: sudo apt-get install jq" >&2
  exit 1
fi

# ---------- 環境変数チェック ----------
API="${API:-https://line-harness.nogardwons.workers.dev}"

if [[ -z "${KEY:-}" ]]; then
  echo "Error: KEY environment variable is required." >&2
  exit 1
fi

# ---------- ステップ1: リッチメニュー構造を登録 ----------
echo "Creating rich menu structure..."

RICH_MENU_PAYLOAD=$(cat <<EOF
{
  "size": { "width": 2500, "height": 843 },
  "selected": true,
  "name": "顧客メニュー",
  "chatBarText": "メニュー",
  "areas": [
    {
      "bounds": { "x": 0, "y": 0, "width": 833, "height": 843 },
      "action": {
        "type": "uri",
        "label": "予約する",
        "uri": "${LIFF_URL}?line_account_id=${LINE_ACCOUNT_ID}&page=book"
      }
    },
    {
      "bounds": { "x": 833, "y": 0, "width": 833, "height": 843 },
      "action": {
        "type": "uri",
        "label": "予約確認",
        "uri": "${LIFF_URL}?line_account_id=${LINE_ACCOUNT_ID}&page=my-bookings"
      }
    },
    {
      "bounds": { "x": 1666, "y": 0, "width": 834, "height": 843 },
      "action": {
        "type": "postback",
        "label": "お店情報",
        "data": "action=customer_shop_info"
      }
    }
  ]
}
EOF
)

CREATE_RESPONSE=$(curl -s -X POST \
  "${API}/api/rich-menus?line_account_id=${LINE_ACCOUNT_ID}" \
  -H "Authorization: Bearer ${KEY}" \
  -H "Content-Type: application/json" \
  -d "$RICH_MENU_PAYLOAD")

CREATE_SUCCESS=$(echo "$CREATE_RESPONSE" | jq -r '.success')
if [[ "$CREATE_SUCCESS" != "true" ]]; then
  echo "Error: Failed to create rich menu." >&2
  echo "$CREATE_RESPONSE" | jq . >&2
  exit 1
fi

RICH_MENU_ID=$(echo "$CREATE_RESPONSE" | jq -r '.data.richMenuId')
if [[ -z "$RICH_MENU_ID" || "$RICH_MENU_ID" == "null" ]]; then
  echo "Error: richMenuId not found in response." >&2
  echo "$CREATE_RESPONSE" | jq . >&2
  exit 1
fi

echo "Rich menu created: $RICH_MENU_ID"

# ---------- ステップ2: 画像をアップロード ----------
echo "Uploading image: $IMAGE_FILE"

UPLOAD_RESPONSE=$(curl -s -X POST \
  "${API}/api/rich-menus/${RICH_MENU_ID}/image?line_account_id=${LINE_ACCOUNT_ID}" \
  -H "Authorization: Bearer ${KEY}" \
  -H "Content-Type: image/png" \
  --data-binary "@${IMAGE_FILE}")

UPLOAD_SUCCESS=$(echo "$UPLOAD_RESPONSE" | jq -r '.success')
if [[ "$UPLOAD_SUCCESS" != "true" ]]; then
  echo "Error: Failed to upload image." >&2
  echo "$UPLOAD_RESPONSE" | jq . >&2
  exit 1
fi

echo "Image uploaded successfully."

# ---------- ステップ3: デフォルトリッチメニューに設定 ----------
echo "Setting as default rich menu..."

DEFAULT_RESPONSE=$(curl -s -X POST \
  "${API}/api/rich-menus/${RICH_MENU_ID}/default?line_account_id=${LINE_ACCOUNT_ID}" \
  -H "Authorization: Bearer ${KEY}")

DEFAULT_SUCCESS=$(echo "$DEFAULT_RESPONSE" | jq -r '.success')
if [[ "$DEFAULT_SUCCESS" != "true" ]]; then
  echo "Error: Failed to set as default rich menu." >&2
  echo "$DEFAULT_RESPONSE" | jq . >&2
  exit 1
fi

echo "Set as default rich menu successfully."

# ---------- 完了: richMenuId を標準出力 ----------
echo ""
echo "=========================================="
echo "richMenuId: $RICH_MENU_ID"
echo "=========================================="
echo ""
echo "次のステップ: 以下の SQL で customer_rich_menu_id を更新してください。"
echo ""
echo "  npx wrangler d1 execute line-harness --remote --command \\"
echo "    \"UPDATE line_accounts SET customer_rich_menu_id = '${RICH_MENU_ID}' WHERE id = '${LINE_ACCOUNT_ID}';\""
