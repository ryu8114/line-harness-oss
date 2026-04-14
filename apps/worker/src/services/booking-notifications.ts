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
  lineAccountId: string,
): Promise<void> {
  try {
    // H3: lineAccountId でスコープした「予約前日リマインド」マスタを取得or作成
    const reminderId = await getOrCreateBookingReminderMaster(db, lineAccountId);
    if (!reminderId) return;

    // friend_reminders に登録（booking_id を紐付けて同日複数予約での誤更新を防ぐ）
    await enrollFriendInReminder(db, {
      friendId,
      reminderId,
      targetDate: `${bookingDate}T00:00:00+09:00`,
      bookingId: booking.id,
    });
  } catch (err) {
    console.warn('リマインド登録エラー:', err);
  }
}

/**
 * テナント（lineAccountId）スコープの「予約前日リマインド」マスタを取得または作成。
 * H3 対策: 名前に lineAccountId を含めることでテナント間の混用を防ぐ。
 * メッセージは汎用テキストにし、特定予約の時刻をハードコードしない。
 */
async function getOrCreateBookingReminderMaster(
  db: D1Database,
  lineAccountId: string,
): Promise<string | null> {
  // テナント固有の名前で既存リマインダーを検索
  const tenantReminderName = `${BOOKING_REMINDER_NAME}_${lineAccountId}`;
  const allReminders = await getReminders(db);
  let reminder = allReminders.find((r) => r.name === tenantReminderName && r.is_active);

  if (!reminder) {
    // 新規作成（汎用メッセージ）
    reminder = await createReminder(db, {
      name: tenantReminderName,
      description: '予約日の前日18:00に送信するリマインドメッセージ',
    });

    await createReminderStep(db, {
      reminderId: reminder.id,
      offsetMinutes: -360,  // 前日18:00
      messageType: 'text',
      messageContent: ['【明日のご予約リマインド】', 'お気をつけてお越しください。'].join('\n'),
    });
  } else {
    // 既存リマインダーのステップが空なら追加
    const steps = await getReminderSteps(db, reminder.id);
    if (steps.length === 0) {
      await createReminderStep(db, {
        reminderId: reminder.id,
        offsetMinutes: -360,
        messageType: 'text',
        messageContent: ['【明日のご予約リマインド】', 'お気をつけてお越しください。'].join('\n'),
      });
    }
  }

  return reminder.id;
}

/** 院長に予約キャンセルを通知する */
export async function notifyAdminBookingCancelled(
  db: D1Database,
  accessToken: string,
  adminLineUserId: string,
  booking: BookingRow,
  lineAccountId?: string,
): Promise<void> {
  try {
    await fireEvent(
      db,
      'booking_cancelled',
      {
        eventData: {
          bookingId: booking.id,
          menuName: booking.menu_name_snapshot,
          startAt: booking.start_at,
          customerName: booking.customer_name,
        },
      },
      accessToken,
      lineAccountId,
    );
  } catch (err) {
    console.warn('booking_cancelled イベント発火エラー:', err);
  }

  try {
    const lineClient = new LineClient(accessToken);
    const startDate = formatDateJa(booking.start_at);
    const startTime = formatTime(booking.start_at);
    const endTime = formatTime(booking.end_at);

    const text = [
      `【予約キャンセル】`,
      `${booking.customer_name} 様`,
      `${booking.menu_name_snapshot}`,
      `${startDate} ${startTime}〜${endTime}`,
    ].filter(Boolean).join('\n');

    await lineClient.pushMessage(adminLineUserId, [{ type: 'text', text }]);
  } catch (err) {
    console.warn('院長へのキャンセル通知エラー:', err);
  }
}

/** 院長に予約日時変更を通知する */
export async function notifyAdminBookingRescheduled(
  db: D1Database,
  accessToken: string,
  adminLineUserId: string,
  oldBooking: BookingRow,
  newBooking: BookingRow,
  lineAccountId?: string,
): Promise<void> {
  try {
    await fireEvent(
      db,
      'booking_rescheduled',
      {
        eventData: {
          bookingId: newBooking.id,
          menuName: newBooking.menu_name_snapshot,
          oldStartAt: oldBooking.start_at,
          newStartAt: newBooking.start_at,
          customerName: newBooking.customer_name,
        },
      },
      accessToken,
      lineAccountId,
    );
  } catch (err) {
    console.warn('booking_rescheduled イベント発火エラー:', err);
  }

  try {
    const lineClient = new LineClient(accessToken);
    const oldDate = formatDateJa(oldBooking.start_at);
    const oldStart = formatTime(oldBooking.start_at);
    const oldEnd = formatTime(oldBooking.end_at);
    const newDate = formatDateJa(newBooking.start_at);
    const newStart = formatTime(newBooking.start_at);
    const newEnd = formatTime(newBooking.end_at);

    const text = [
      `【予約変更】`,
      `${newBooking.customer_name} 様`,
      `${newBooking.menu_name_snapshot}`,
      `変更前: ${oldDate} ${oldStart}〜${oldEnd}`,
      `変更後: ${newDate} ${newStart}〜${newEnd}`,
    ].filter(Boolean).join('\n');

    await lineClient.pushMessage(adminLineUserId, [{ type: 'text', text }]);
  } catch (err) {
    console.warn('院長への日時変更通知エラー:', err);
  }
}

// ---- ユーティリティ --------------------------------------------------------

export function formatDateJa(isoString: string): string {
  // isoString は "2026-04-14T10:00:00+09:00" 形式（JST）
  // getDate()/getDay() はランタイムのローカル時刻（Workers = UTC）を使うため、
  // UTC正午を使ってUTCメソッドで曜日・日付を取得する
  const datePart = isoString.slice(0, 10); // "2026-04-14"
  const [year, month, day] = datePart.split('-').map(Number);
  const d = new Date(`${datePart}T12:00:00Z`);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${year}年${month}月${day}日(${weekdays[d.getUTCDay()]})`;
}

export function formatTime(isoString: string): string {
  // isoString は "2026-04-14T10:00:00+09:00" 形式（JST）
  // getHours() はUTCになるため、文字列から直接スライスする
  return isoString.slice(11, 16); // "10:00"
}
