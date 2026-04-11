/**
 * 予約作成時の通知・リマインド連携
 *
 * 1. 患者への予約確認LINEメッセージ送信
 * 2. 院長への新規予約通知（event-bus経由）
 * 3. 既存リマインダーシステムへの前日リマインド登録
 */

import {
  createReminder,
  createReminderStep,
  enrollFriendInReminder,
  getReminders,
  getReminderSteps,
  jstNow,
  type BookingRow,
} from '@line-crm/db';
import { fireEvent } from './event-bus.js';
import { LineClient } from '@line-crm/line-sdk';

const BOOKING_REMINDER_NAME = '予約前日リマインド';

/** 予約確認メッセージを患者に送信する */
export async function sendBookingConfirmation(
  lineUserId: string,
  accessToken: string,
  booking: BookingRow,
): Promise<void> {
  const lineClient = new LineClient(accessToken);

  const startDate = formatDateJa(booking.start_at);
  const startTime = formatTime(booking.start_at);
  const endTime = formatTime(booking.end_at);
  const price = booking.menu_price_snapshot ? `¥${booking.menu_price_snapshot.toLocaleString()}` : '';

  const text = [
    `【予約確定】`,
    `${startDate}`,
    `${startTime}〜${endTime}`,
    booking.menu_name_snapshot || '',
    price,
    ``,
    `ご予約ありがとうございます。当日のお越しをお待ちしております。`,
  ].filter(Boolean).join('\n');

  try {
    await lineClient.pushMessage(lineUserId, [{ type: 'text', text }]);
  } catch (err) {
    console.warn('予約確認メッセージ送信エラー:', err);
  }
}

/** 院長に新規予約通知を送る（event-bus + 院長LINE User IDへの直接push） */
export async function notifyAdminNewBooking(
  db: D1Database,
  accessToken: string,
  adminLineUserId: string,
  booking: BookingRow,
  friendId?: string,
  lineAccountId?: string,
): Promise<void> {
  // event-bus に booking_created イベント発火（notification_rules 連携）
  try {
    await fireEvent(
      db,
      'booking_created',
      {
        friendId,
        eventData: {
          bookingId: booking.id,
          menuName: booking.menu_name_snapshot,
          startAt: booking.start_at,
          endAt: booking.end_at,
          customerName: booking.customer_name,
          customerNote: booking.customer_note,
        },
      },
      accessToken,
      lineAccountId,
    );
  } catch (err) {
    console.warn('booking_created イベント発火エラー:', err);
  }

  // 院長LINEへ直接pushMessage
  try {
    const lineClient = new LineClient(accessToken);
    const startDate = formatDateJa(booking.start_at);
    const startTime = formatTime(booking.start_at);
    const endTime = formatTime(booking.end_at);

    const text = [
      `【新規予約】`,
      `${booking.customer_name} 様`,
      `${booking.menu_name_snapshot}`,
      `${startDate} ${startTime}〜${endTime}`,
      booking.customer_note ? `症状: ${booking.customer_note}` : '',
    ].filter(Boolean).join('\n');

    await lineClient.pushMessage(adminLineUserId, [{ type: 'text', text }]);
  } catch (err) {
    console.warn('院長への新規予約通知エラー:', err);
  }
}

/**
 * 既存リマインダーシステムに前日リマインドを登録する。
 *
 * 院ごとに「予約前日リマインド」というリマインダーを1つ用意する。
 * なければ自動作成し、友だちリマインダーに登録する。
 * target_date = 予約日 (YYYY-MM-DD)
 * offset_minutes = -360 (前日18:00 = 予約日0:00の6時間前... ではなく前日18:00)
 *
 * リマインダーシステムは target_date + offset_minutes の時刻に配信する。
 * 前日18:00 = 予約日0:00 - 360分 = -360分
 */
export async function registerBookingReminder(
  db: D1Database,
  friendId: string,
  bookingDate: string,  // "YYYY-MM-DD"
  booking: BookingRow,
): Promise<void> {
  try {
    // 院の「予約前日リマインド」マスタを取得or作成
    const reminderId = await getOrCreateBookingReminderMaster(db, booking);
    if (!reminderId) return;

    // friend_reminders に登録
    await enrollFriendInReminder(db, {
      friendId,
      reminderId,
      targetDate: `${bookingDate}T00:00:00+09:00`,
    });
  } catch (err) {
    console.warn('リマインド登録エラー:', err);
  }
}

/** 「予約前日リマインド」マスタのIDを取得、なければ作成 */
async function getOrCreateBookingReminderMaster(
  db: D1Database,
  booking: BookingRow,
): Promise<string | null> {
  // 既存のリマインダーから「予約前日リマインド」を探す
  const allReminders = await getReminders(db);
  let reminder = allReminders.find((r) => r.name === BOOKING_REMINDER_NAME && r.is_active);

  if (!reminder) {
    // 新規作成
    reminder = await createReminder(db, {
      name: BOOKING_REMINDER_NAME,
      description: '予約日の前日18:00に送信するリマインドメッセージ',
    });

    // ステップ追加: offset_minutes = -360 (前日18:00 = 予約日0:00の6時間前)
    const startTime = formatTime(booking.start_at);
    const endTime = formatTime(booking.end_at);
    const menuName = booking.menu_name_snapshot || '';

    const messageContent = [
      `【明日のご予約リマインド】`,
      `${menuName}`,
      `${startTime}〜${endTime}`,
      ``,
      `お気をつけてお越しください。`,
    ].filter(Boolean).join('\n');

    await createReminderStep(db, {
      reminderId: reminder.id,
      offsetMinutes: -360,  // 前日18:00
      messageType: 'text',
      messageContent,
    });
  } else {
    // 既存リマインダーのステップが空なら追加
    const steps = await getReminderSteps(db, reminder.id);
    if (steps.length === 0) {
      const startTime = formatTime(booking.start_at);
      const endTime = formatTime(booking.end_at);
      const menuName = booking.menu_name_snapshot || '';
      await createReminderStep(db, {
        reminderId: reminder.id,
        offsetMinutes: -360,
        messageType: 'text',
        messageContent: [`【明日のご予約リマインド】`, menuName, `${startTime}〜${endTime}`, `お気をつけてお越しください。`].join('\n'),
      });
    }
  }

  return reminder.id;
}

// ---- ユーティリティ --------------------------------------------------------

function formatDateJa(isoString: string): string {
  // isoString は "2026-04-14T10:00:00+09:00" 形式（JST）
  // getDate()/getDay() はランタイムのローカル時刻（Workers = UTC）を使うため、
  // UTC正午を使ってUTCメソッドで曜日・日付を取得する
  const datePart = isoString.slice(0, 10); // "2026-04-14"
  const [year, month, day] = datePart.split('-').map(Number);
  const d = new Date(`${datePart}T12:00:00Z`);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${year}年${month}月${day}日(${weekdays[d.getUTCDay()]})`;
}

function formatTime(isoString: string): string {
  // isoString は "2026-04-14T10:00:00+09:00" 形式（JST）
  // getHours() はUTCになるため、文字列から直接スライスする
  return isoString.slice(11, 16); // "10:00"
}
