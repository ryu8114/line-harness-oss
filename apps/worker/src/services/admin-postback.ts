/**
 * 院長リッチメニューの postback ハンドラ
 *
 * リッチメニューのボタンが押されると postback イベントが届く。
 * replyMessage（無料）で予約情報を返す。
 */

import { getBookingsByAccount, getBookingById } from '@line-crm/db';
import { LineClient, flexBubble, flexBox, flexText } from '@line-crm/line-sdk';
import { formatDateJa, formatTime } from './booking-notifications.js';

const MAX_BOOKINGS_DISPLAY = 10;

/** postbackData を解析して対応する返信を送る */
export async function handleAdminPostback(
  db: D1Database,
  lineClient: LineClient,
  replyToken: string,
  postbackData: string,
  lineAccountId: string,
): Promise<void> {
  const params = new URLSearchParams(postbackData);
  const action = params.get('action');

  switch (action) {
    case 'admin_today_bookings':
      await replyTodayBookings(db, lineClient, replyToken, lineAccountId);
      break;
    case 'admin_booking_detail': {
      const bookingId = params.get('id');
      if (bookingId) {
        await replyBookingDetail(db, lineClient, replyToken, bookingId, lineAccountId);
      }
      break;
    }
    default:
      console.warn(`Unknown admin postback action: ${action}`);
  }
}

/** 今日の予約一覧を Flex Message で返す */
async function replyTodayBookings(
  db: D1Database,
  lineClient: LineClient,
  replyToken: string,
  lineAccountId: string,
): Promise<void> {
  // 今日（JST）の範囲を計算
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = jstNow.toISOString().slice(0, 10);
  const from = `${today}T00:00:00+09:00`;
  const to = `${today}T23:59:59+09:00`;

  const allBookings = await getBookingsByAccount(db, lineAccountId, { from, to });
  const confirmed = allBookings.filter(b => b.status !== 'cancelled');
  const truncated = confirmed.length > MAX_BOOKINGS_DISPLAY;
  const bookings = truncated ? confirmed.slice(0, MAX_BOOKINGS_DISPLAY) : confirmed;

  const jstDate = jstNow;
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const dateLabel = `${jstDate.getUTCMonth() + 1}月${jstDate.getUTCDate()}日(${weekdays[jstDate.getUTCDay()]})`;

  if (bookings.length === 0) {
    await lineClient.replyMessage(replyToken, [
      { type: 'text', text: `【今日の予約】${dateLabel}\n\n本日の予約はありません。` },
    ]);
    return;
  }

  // ボディの予約リスト（各行をタップすると詳細を返す）
  const bookingItems = bookings.map(b =>
    flexBox('horizontal', [
      flexText(
        `${formatTime(b.start_at)}〜${formatTime(b.end_at)}`,
        { size: 'sm', color: '#555555', flex: 2 },
      ),
      flexText(
        b.customer_name ?? '（名前なし）',
        { size: 'sm', flex: 3, wrap: true },
      ),
      flexText(
        b.menu_name_snapshot ?? '',
        { size: 'sm', color: '#888888', flex: 3, wrap: true },
      ),
    ], {
      margin: 'sm',
      action: { type: 'postback', label: '詳細', data: `action=admin_booking_detail&id=${b.id}` },
    }),
  );

  if (truncated) {
    bookingItems.push(
      flexBox('vertical', [
        flexText(`...他${confirmed.length - MAX_BOOKINGS_DISPLAY}件`, {
          size: 'xs',
          color: '#888888',
        }),
      ], { margin: 'sm' }),
    );
  }

  const bubble = flexBubble({
    header: flexBox('vertical', [
      flexText('今日の予約', { weight: 'bold', size: 'lg' }),
      flexText(`${dateLabel}（${confirmed.length}件）`, { size: 'sm', color: '#888888' }),
    ], { backgroundColor: '#f5f5f5', paddingAll: 'md' }),
    body: flexBox('vertical', bookingItems, { spacing: 'none' }),
  });

  await lineClient.replyMessage(replyToken, [
    {
      type: 'flex',
      altText: `今日の予約 ${dateLabel}（${confirmed.length}件）`,
      contents: bubble,
    },
  ]);
}

/** 予約詳細を Flex Message で返す */
async function replyBookingDetail(
  db: D1Database,
  lineClient: LineClient,
  replyToken: string,
  bookingId: string,
  lineAccountId: string,
): Promise<void> {
  const booking = await getBookingById(db, bookingId);
  if (!booking || booking.line_account_id !== lineAccountId) {
    await lineClient.replyMessage(replyToken, [
      { type: 'text', text: '予約が見つかりませんでした。' },
    ]);
    return;
  }

  const rows: Array<{ label: string; value: string }> = [
    { label: '日時', value: `${formatDateJa(booking.start_at)} ${formatTime(booking.start_at)}〜${formatTime(booking.end_at)}` },
    { label: 'お名前', value: booking.customer_name ?? '（不明）' },
    { label: 'メニュー', value: `${booking.menu_name_snapshot ?? ''}${booking.menu_duration_snapshot ? `（${booking.menu_duration_snapshot}分）` : ''}` },
    ...(booking.customer_phone ? [{ label: '電話番号', value: booking.customer_phone }] : []),
    ...(booking.customer_note ? [{ label: 'お悩み', value: booking.customer_note }] : []),
  ];

  const bubble = flexBubble({
    header: flexBox('vertical', [
      flexText('予約詳細', { weight: 'bold', size: 'lg' }),
    ], { backgroundColor: '#f5f5f5', paddingAll: 'md' }),
    body: flexBox('vertical',
      rows.map(r =>
        flexBox('horizontal', [
          flexText(r.label, { size: 'sm', color: '#888888', flex: 2 }),
          flexText(r.value, { size: 'sm', flex: 4, wrap: true }),
        ], { margin: 'sm' }),
      ),
    ),
  });

  await lineClient.replyMessage(replyToken, [
    {
      type: 'flex',
      altText: `予約詳細 ${booking.customer_name ?? ''}`,
      contents: bubble,
    },
  ]);
}
