import { extractFlexAltText } from '../utils/flex-alt-text.js';

/**
 * リマインダ配信処理 — cronトリガーで定期実行
 *
 * target_date + offset_minutes の時刻が現在時刻以前で
 * まだ配信されていないステップを配信する
 */

import {
  getDueReminderDeliveries,
  markReminderStepDelivered,
  completeReminderIfDone,
  getFriendById,
  getBookingById,
  jstNow,
} from '@line-crm/db';
import type { LineClient, Message } from '@line-crm/line-sdk';
import { addJitter, sleep } from './stealth.js';
import { formatDateJa, formatTime } from './booking-notifications.js';

export async function processReminderDeliveries(
  db: D1Database,
  lineClient: LineClient,
): Promise<void> {
  const now = jstNow();
  const dueReminders = await getDueReminderDeliveries(db, now);

  for (let i = 0; i < dueReminders.length; i++) {
    const fr = dueReminders[i];
    try {
      // ステルス: バースト回避のためランダム遅延
      if (i > 0) {
        await sleep(addJitter(50, 200));
      }

      const friend = await getFriendById(db, fr.friend_id);
      if (!friend || !friend.is_following) {
        // フォロー解除済み — スキップ
        continue;
      }

      // 予約リマインドの場合は booking_id から動的にメッセージを生成する
      const booking = fr.booking_id ? await getBookingById(db, fr.booking_id) : null;

      for (const step of fr.steps) {
        const resolvedContent =
          booking && step.message_type === 'text'
            ? buildBookingReminderText(booking.start_at, booking.end_at, booking.menu_name_snapshot)
            : step.message_content;
        const message = buildMessage(step.message_type, resolvedContent);
        await lineClient.pushMessage(friend.line_user_id, [message]);

        // メッセージログに記録
        const logId = crypto.randomUUID();
        await db
          .prepare(
            `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
             VALUES (?, ?, 'outgoing', ?, ?, ?)`,
          )
          .bind(logId, friend.id, step.message_type, resolvedContent, jstNow())
          .run();

        // 配信済みを記録
        await markReminderStepDelivered(db, fr.id, step.id);
      }

      // 全ステップ配信済みかチェック
      await completeReminderIfDone(db, fr.id, fr.reminder_id);
    } catch (err) {
      console.error(`リマインダ配信エラー (friend_reminder ${fr.id}):`, err);
    }
  }
}

/** 予約リマインド用の動的テキストを生成する */
export function buildBookingReminderText(
  startAt: string,
  endAt: string,
  menuName: string | null,
): string {
  const lines = [
    '【明日のご予約リマインド】',
    formatDateJa(startAt),
    `${formatTime(startAt)}〜${formatTime(endAt)}`,
  ];
  if (menuName) lines.push(menuName);
  lines.push('', 'ご予約ありがとうございます。', 'お気をつけてお越しください。');
  return lines.join('\n');
}

function buildMessage(messageType: string, messageContent: string, altText?: string): Message {
  if (messageType === 'text') {
    return { type: 'text', text: messageContent };
  }
  if (messageType === 'image') {
    try {
      const parsed = JSON.parse(messageContent) as { originalContentUrl: string; previewImageUrl: string };
      return { type: 'image', originalContentUrl: parsed.originalContentUrl, previewImageUrl: parsed.previewImageUrl };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }
  if (messageType === 'flex') {
    try {
      const contents = JSON.parse(messageContent);
      return { type: 'flex', altText: altText || extractFlexAltText(contents), contents };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }
  return { type: 'text', text: messageContent };
}
