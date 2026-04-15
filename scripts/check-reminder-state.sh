#!/usr/bin/env bash
# scripts/check-reminder-state.sh
#
# Inspect the live D1 reminder state for a quick sanity-check before / after
# a booking is created, or after the Cron fires.
#
# Usage:
#   bash scripts/check-reminder-state.sh             # local D1
#   bash scripts/check-reminder-state.sh --remote    # production D1
#
# Requires: wrangler authenticated, run from repo root.

set -euo pipefail

REMOTE_FLAG=""
if [[ "${1:-}" == "--remote" ]]; then
  REMOTE_FLAG="--remote"
fi

D1="npx wrangler d1 execute line-harness --config apps/worker/wrangler.toml $REMOTE_FLAG"

echo ""
echo "=== Reminder masters (tenant-scoped) ==="
$D1 --command "
SELECT id, name, is_active, created_at
FROM reminders
ORDER BY created_at DESC
LIMIT 20;
"

echo ""
echo "=== Active pending deliveries (friend_reminders not yet sent) ==="
$D1 --command "
SELECT
  fr.id            AS friend_reminder_id,
  fr.friend_id,
  fr.booking_id,
  fr.target_date,
  rs.offset_minutes,
  -- Compute scheduled delivery as UTC epoch → readable string
  datetime(
    (strftime('%s', replace(fr.target_date, '+09:00', '')) - 9*3600)
    + rs.offset_minutes * 60,
    'unixepoch'
  ) || ' UTC'      AS scheduled_delivery_utc,
  r.name           AS reminder_name,
  fr.status
FROM friend_reminders fr
JOIN reminders        r  ON r.id  = fr.reminder_id
JOIN reminder_steps   rs ON rs.reminder_id = r.id
LEFT JOIN friend_reminder_deliveries frd
       ON frd.friend_reminder_id = fr.id
      AND frd.reminder_step_id   = rs.id
WHERE fr.status  = 'active'
  AND r.is_active = 1
  AND frd.id IS NULL
ORDER BY fr.target_date ASC
LIMIT 30;
"

echo ""
echo "=== Recently delivered reminders (last 24 h) ==="
$D1 --command "
SELECT
  frd.friend_reminder_id,
  fr.friend_id,
  fr.booking_id,
  frd.delivered_at,
  r.name AS reminder_name
FROM friend_reminder_deliveries frd
JOIN friend_reminders fr ON fr.id = frd.friend_reminder_id
JOIN reminders        r  ON r.id  = fr.reminder_id
WHERE frd.delivered_at >= datetime('now', '-24 hours')
ORDER BY frd.delivered_at DESC
LIMIT 20;
"
