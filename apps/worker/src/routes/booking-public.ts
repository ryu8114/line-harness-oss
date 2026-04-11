/**
 * 患者向け公開API — 予約システム
 *
 * 認証: X-LIFF-ID-Token ヘッダーで LINE IDトークンを受け取り、
 *       LINE APIで検証してLINE User IDを取得する。
 */

import { Hono } from 'hono';
import {
  getMenusByAccount,
  getMenuById,
  getLineAccountById,
  getLineAccountByChannelId,
  getLineAccounts,
  getFriendByLineUserId,
  createBooking,
  getConfirmedBookingsInRange,
} from '@line-crm/db';
import { calculateSlots, calculateSlotsMultiDay } from '../services/slot-calculator.js';
import { getCalendarConnectionById } from '@line-crm/db';
import {
  sendBookingConfirmation,
  notifyAdminNewBooking,
  registerBookingReminder,
} from '../services/booking-notifications.js';
import type { Env } from '../index.js';

const bookingPublic = new Hono<Env>();

// ---- IDトークン検証ヘルパー ------------------------------------------------

async function verifyLiffIdToken(
  db: D1Database,
  idToken: string,
  envLoginChannelId: string,
): Promise<string | null> {
  // 環境変数のチャンネルIDと全DBアカウントのログインチャンネルIDを試す
  const loginChannelIds = [envLoginChannelId];
  const accounts = await getLineAccounts(db);
  for (const acct of accounts) {
    if (acct.login_channel_id) loginChannelIds.push(acct.login_channel_id);
  }

  for (const channelId of loginChannelIds) {
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (res.ok) {
      const data = await res.json<{ sub: string }>();
      return data.sub; // LINE User ID
    }
  }
  return null;
}

// ---- GET /api/public/menus -------------------------------------------------

bookingPublic.get('/api/public/menus', async (c) => {
  const lineAccountId = c.req.query('line_account_id');
  if (!lineAccountId) {
    return c.json({ success: false, error: 'line_account_id is required' }, 400);
  }

  const account = await getLineAccountById(c.env.DB, lineAccountId);
  if (!account || !account.booking_enabled) {
    return c.json({ success: false, error: 'Booking is not enabled for this account' }, 404);
  }

  const menus = await getMenusByAccount(c.env.DB, lineAccountId);
  return c.json({
    success: true,
    data: menus.map((m) => ({
      id: m.id,
      name: m.name,
      duration: m.duration,
      price: m.price,
      description: m.description,
      sortOrder: m.sort_order,
    })),
  });
});

// ---- GET /api/public/slots -------------------------------------------------

bookingPublic.get('/api/public/slots', async (c) => {
  const lineAccountId = c.req.query('line_account_id');
  const menuId = c.req.query('menu_id');
  const date = c.req.query('date');
  const from = c.req.query('from');
  const to = c.req.query('to');

  if (!lineAccountId || !menuId) {
    return c.json({ success: false, error: 'line_account_id and menu_id are required' }, 400);
  }

  const account = await getLineAccountById(c.env.DB, lineAccountId);
  if (!account || !account.booking_enabled) {
    return c.json({ success: false, error: 'Booking is not enabled for this account' }, 404);
  }

  const menu = await getMenuById(c.env.DB, menuId);
  if (!menu || menu.line_account_id !== lineAccountId) {
    return c.json({ success: false, error: 'Menu not found' }, 404);
  }

  // Googleカレンダー接続情報
  let googleCalendarId: string | undefined;
  let googleAccessToken: string | undefined;
  if (account.google_calendar_connection_id) {
    const conn = await getCalendarConnectionById(c.env.DB, account.google_calendar_connection_id);
    if (conn?.access_token) {
      googleCalendarId = conn.calendar_id;
      googleAccessToken = conn.access_token;
    }
  }

  const slotOpts = {
    db: c.env.DB,
    lineAccountId,
    googleCalendarId,
    googleAccessToken,
    slotUnit: account.slot_unit || 30,
    minBookingHours: account.min_booking_hours || 3,
    maxBookingDays: account.max_booking_days || 14,
  };

  if (date) {
    // 単日
    const slots = await calculateSlots(slotOpts, date, menu.duration);
    return c.json({ success: true, data: slots });
  }

  if (from && to) {
    // 複数日
    const data = await calculateSlotsMultiDay(slotOpts, from, to, menu.duration);
    return c.json({ success: true, data });
  }

  return c.json({ success: false, error: 'date or from/to is required' }, 400);
});

// ---- POST /api/public/bookings ---------------------------------------------

bookingPublic.post('/api/public/bookings', async (c) => {
  // IDトークン検証
  const idToken = c.req.header('X-LIFF-ID-Token');
  if (!idToken) {
    return c.json({ success: false, error: 'X-LIFF-ID-Token header is required' }, 401);
  }
  const lineUserId = await verifyLiffIdToken(c.env.DB, idToken, c.env.LINE_LOGIN_CHANNEL_ID);
  if (!lineUserId) {
    return c.json({ success: false, error: 'Invalid ID token' }, 401);
  }

  const body = await c.req.json<{
    lineAccountId: string;
    menuId: string;
    date: string;       // "YYYY-MM-DD"
    time: string;       // "HH:MM"
    customerName: string;
    customerPhone?: string;
    customerNote?: string;
  }>();

  const { lineAccountId, menuId, date, time, customerName, customerPhone, customerNote } = body;
  if (!lineAccountId || !menuId || !date || !time || !customerName) {
    return c.json({ success: false, error: 'lineAccountId, menuId, date, time, customerName are required' }, 400);
  }

  const account = await getLineAccountById(c.env.DB, lineAccountId);
  if (!account || !account.booking_enabled) {
    return c.json({ success: false, error: 'Booking is not enabled for this account' }, 404);
  }

  const menu = await getMenuById(c.env.DB, menuId);
  if (!menu || menu.line_account_id !== lineAccountId || !menu.is_active) {
    return c.json({ success: false, error: 'Menu not found' }, 404);
  }

  // start/end 時刻を組み立て
  const startAt = `${date}T${time}:00+09:00`;
  const [h, m] = time.split(':').map(Number);
  const endMinutes = h * 60 + m + menu.duration;
  const endH = Math.floor(endMinutes / 60);
  const endM = endMinutes % 60;
  const endAt = `${date}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00+09:00`;

  // レースコンディション対策: 予約作成前に空き確認
  const conflicts = await getConfirmedBookingsInRange(c.env.DB, lineAccountId, startAt, endAt);
  if (conflicts.length > 0) {
    return c.json({ success: false, error: 'この時間帯はすでに予約が入っています。別の時間を選択してください。' }, 409);
  }

  // friendId を取得（存在する場合）
  const friend = await getFriendByLineUserId(c.env.DB, lineUserId);

  const booking = await createBooking(c.env.DB, {
    connectionId: account.google_calendar_connection_id ?? null,
    lineAccountId,
    friendId: friend?.id,
    menuId,
    menuNameSnapshot: menu.name,
    menuDurationSnapshot: menu.duration,
    menuPriceSnapshot: menu.price ?? undefined,
    title: `${customerName}様 ${menu.name}`,
    startAt,
    endAt,
    customerName,
    customerPhone,
    customerNote,
  });

  // Googleカレンダーに登録（ベストエフォート）
  if (account.google_calendar_connection_id) {
    try {
      const { getCalendarConnectionById: getConn } = await import('@line-crm/db');
      const conn = await getConn(c.env.DB, account.google_calendar_connection_id);
      if (conn?.access_token) {
        const { GoogleCalendarClient } = await import('../services/google-calendar.js');
        const gcal = new GoogleCalendarClient({ calendarId: conn.calendar_id, accessToken: conn.access_token });
        const { eventId } = await gcal.createEvent({
          summary: booking.title,
          start: startAt,
          end: endAt,
          description: customerNote,
        });
        const { updateBookingEventId } = await import('@line-crm/db');
        await updateBookingEventId(c.env.DB, booking.id, eventId);
      }
    } catch (err) {
      console.warn('Googleカレンダー登録エラー（予約は作成済み）:', err);
    }
  }

  // 非同期で通知・リマインドを実行（レスポンスをブロックしない）
  c.executionCtx.waitUntil((async () => {
    // 患者への予約確認メッセージ
    await sendBookingConfirmation(lineUserId, account.channel_access_token, booking);

    // 院長への新規予約通知
    if (account.admin_line_user_id) {
      await notifyAdminNewBooking(
        c.env.DB,
        account.channel_access_token,
        account.admin_line_user_id,
        booking,
        friend?.id,
        lineAccountId,
      );
    }

    // 前日リマインド登録（友だち登録済みの患者のみ）
    if (friend?.id) {
      await registerBookingReminder(c.env.DB, friend.id, date, booking);
    }
  })());

  return c.json({
    success: true,
    data: {
      id: booking.id,
      menuName: booking.menu_name_snapshot,
      startAt: booking.start_at,
      endAt: booking.end_at,
      customerName: booking.customer_name,
    },
  }, 201);
});

export { bookingPublic };
