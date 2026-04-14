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
  getBookingById,
  updateBookingStatus,
  updateBookingEventId,
  getBookingsByFriendId,
  updateBookingSchedule,
  getCalendarConnectionById,
  cancelReminderByBookingId,
  updateReminderTargetDateByBookingId,
} from '@line-crm/db';
import type { BookingRow } from '@line-crm/db';
import { calculateSlots, calculateSlotsMultiDay } from '../services/slot-calculator.js';
import { LineClient } from '@line-crm/line-sdk';
import {
  sendBookingConfirmation,
  notifyAdminNewBooking,
  registerBookingReminder,
  notifyAdminBookingCancelled,
  notifyAdminBookingRescheduled,
} from '../services/booking-notifications.js';
import type { Env } from '../index.js';

const bookingPublic = new Hono<Env>();

// ---- IDトークン検証ヘルパー ------------------------------------------------

/**
 * 全アカウントのログインチャンネルを試す汎用版（既存予約作成に使用）。
 */
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

/**
 * 特定アカウントのログインチャンネルのみで検証する（my-bookings 系エンドポイントに使用）。
 * H1 対策: line_account_id が指定されているとき、他テナントの有効トークンを誤受理しない。
 */
async function verifyLiffIdTokenForAccount(
  db: D1Database,
  idToken: string,
  lineAccountId: string,
  envLoginChannelId: string,
): Promise<string | null> {
  const account = await getLineAccountById(db, lineAccountId);
  const channelId = account?.login_channel_id || envLoginChannelId;

  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  if (!res.ok) return null;
  const data = await res.json<{ sub: string }>();
  return data.sub;
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
  // H1: lineAccountId を先にbodyから取得してトークン検証をスコープ化
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

  // IDトークン検証（lineAccountId にスコープ: H1）
  const idToken = c.req.header('X-LIFF-ID-Token');
  if (!idToken) {
    return c.json({ success: false, error: 'X-LIFF-ID-Token header is required' }, 401);
  }
  const lineUserId = await verifyLiffIdTokenForAccount(c.env.DB, idToken, lineAccountId, c.env.LINE_LOGIN_CHANNEL_ID);
  if (!lineUserId) {
    return c.json({ success: false, error: 'Invalid ID token' }, 401);
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

  // 日時バリデーション（不正な日時は NaN になる）
  if (!Number.isFinite(new Date(startAt).getTime())) {
    return c.json({ success: false, error: '不正な日時形式です' }, 400);
  }

  // MEDIUM-1: サーバー側でスロット可否を検証（営業時間・休日・GCal含む）
  const bookingGcalConn = account.google_calendar_connection_id
    ? await getCalendarConnectionById(c.env.DB, account.google_calendar_connection_id)
    : null;
  const bookingValidSlots = await calculateSlots(
    {
      db: c.env.DB,
      lineAccountId,
      googleCalendarId: bookingGcalConn?.calendar_id,
      googleAccessToken: bookingGcalConn?.access_token || undefined,
      slotUnit: account.slot_unit || 30,
      minBookingHours: account.min_booking_hours || 3,
      maxBookingDays: account.max_booking_days || 14,
    },
    date,
    menu.duration,
  );
  if (!bookingValidSlots.some((s) => s.time === time && s.available)) {
    return c.json({ success: false, error: 'この時間帯は予約できません。別の時間を選択してください。' }, 400);
  }

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
  // CREATE-TOCTOU: アトミックな INSERT が競合を検出した場合
  if (!booking) {
    return c.json({ success: false, error: 'この時間帯はすでに予約が入っています。別の時間を選択してください。' }, 409);
  }

  // Googleカレンダーに登録（ベストエフォート）
  // M: updateBookingEventId 失敗時はGCalイベントを補償削除
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
        try {
          const { updateBookingEventId } = await import('@line-crm/db');
          await updateBookingEventId(c.env.DB, booking.id, eventId);
        } catch (dbErr) {
          // DB更新失敗 → GCalイベントを補償削除
          console.error('updateBookingEventId 失敗。GCalイベントを補償削除:', dbErr);
          gcal.deleteEvent(eventId).catch((e) => console.error('補償GCal削除エラー:', e));
        }
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
      await registerBookingReminder(c.env.DB, friend.id, date, booking, lineAccountId);
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

// ---- キャンセル期限チェック共通関数 ----------------------------------------

/**
 * キャンセル・日時変更が期限内かチェック。
 * 期限内なら true、期限切れなら false を返す。
 */
function isWithinCancelDeadline(booking: BookingRow, deadlineHours: number): boolean {
  const msUntilStart = new Date(booking.start_at).getTime() - Date.now();
  return msUntilStart / 3_600_000 >= deadlineHours;
}

// ---- Google Calendarクライアント生成共通関数 --------------------------------

async function getGcalClient(
  db: D1Database,
  googleCalendarConnectionId: string | null,
): Promise<{ gcal: import('../services/google-calendar.js').GoogleCalendarClient } | null> {
  if (!googleCalendarConnectionId) return null;
  const conn = await getCalendarConnectionById(db, googleCalendarConnectionId);
  if (!conn?.access_token) return null;
  const { GoogleCalendarClient } = await import('../services/google-calendar.js');
  return { gcal: new GoogleCalendarClient({ calendarId: conn.calendar_id, accessToken: conn.access_token }) };
}

// ---- GET /api/public/my-bookings -------------------------------------------

bookingPublic.get('/api/public/my-bookings', async (c) => {
  const lineAccountId = c.req.query('line_account_id');
  if (!lineAccountId) return c.json({ success: false, error: 'line_account_id is required' }, 400);

  const idToken = c.req.header('X-LIFF-ID-Token');
  if (!idToken) return c.json({ success: false, error: 'X-LIFF-ID-Token header is required' }, 401);

  const lineUserId = await verifyLiffIdTokenForAccount(c.env.DB, idToken, lineAccountId, c.env.LINE_LOGIN_CHANNEL_ID);
  if (!lineUserId) return c.json({ success: false, error: 'Invalid ID token' }, 401);

  const friend = await getFriendByLineUserId(c.env.DB, lineUserId);
  if (!friend) return c.json({ success: true, data: [] });

  // JST 今日の 00:00 以降
  const todayJst = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 10);
  const from = `${todayJst}T00:00:00+09:00`;

  const bookings = await getBookingsByFriendId(c.env.DB, friend.id, lineAccountId, { from, status: 'confirmed' });

  return c.json({
    success: true,
    data: bookings.map((b) => ({
      id: b.id,
      startAt: b.start_at,
      endAt: b.end_at,
      menuId: b.menu_id,
      menuName: b.menu_name_snapshot,
      menuDuration: b.menu_duration_snapshot,
      menuPrice: b.menu_price_snapshot,
      customerNote: b.customer_note,
    })),
  });
});

// ---- POST /api/public/my-bookings/:id/cancel --------------------------------

bookingPublic.post('/api/public/my-bookings/:id/cancel', async (c) => {
  const lineAccountId = c.req.query('line_account_id');
  if (!lineAccountId) return c.json({ success: false, error: 'line_account_id is required' }, 400);

  const idToken = c.req.header('X-LIFF-ID-Token');
  if (!idToken) return c.json({ success: false, error: 'X-LIFF-ID-Token header is required' }, 401);

  const lineUserId = await verifyLiffIdTokenForAccount(c.env.DB, idToken, lineAccountId, c.env.LINE_LOGIN_CHANNEL_ID);
  if (!lineUserId) return c.json({ success: false, error: 'Invalid ID token' }, 401);

  const friend = await getFriendByLineUserId(c.env.DB, lineUserId);
  if (!friend) return c.json({ success: false, error: 'Unauthorized' }, 401);

  const bookingId = c.req.param('id');
  const booking = await getBookingById(c.env.DB, bookingId);
  if (!booking) return c.json({ success: false, error: 'Booking not found' }, 404);

  // 権限確認: 自分の予約かつ同じ院
  if (booking.friend_id !== friend.id || booking.line_account_id !== lineAccountId) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }
  if (booking.status !== 'confirmed') {
    return c.json({ success: false, error: 'この予約はキャンセルできません' }, 400);
  }

  const account = await getLineAccountById(c.env.DB, lineAccountId);
  if (!account) return c.json({ success: false, error: 'Account not found' }, 404);

  // キャンセル期限チェック
  if (!isWithinCancelDeadline(booking, account.cancel_deadline_hours)) {
    return c.json({ success: false, error: 'キャンセル期限を過ぎています' }, 400);
  }

  // ステータス更新
  await updateBookingStatus(c.env.DB, bookingId, 'cancelled');

  // GCal削除（ベストエフォート）
  let gcalWarning: string | undefined;
  if (booking.event_id) {
    const gcalResult = await getGcalClient(c.env.DB, account.google_calendar_connection_id);
    if (!gcalResult) {
      // MEDIUM-3: GCal連携済みなのにクライアント取得失敗 → カレンダーに旧イベントが残る可能性を記録
      console.warn(`GCal削除スキップ（接続取得失敗）: bookingId=${bookingId} eventId=${booking.event_id}`);
      gcalWarning = 'Googleカレンダーの削除に失敗しました';
    } else {
      try {
        await gcalResult.gcal.deleteEvent(booking.event_id);
      } catch (err) {
        console.error('GCal削除エラー（キャンセル）:', err);
        gcalWarning = 'Googleカレンダーの削除に失敗しました';
      }
    }
  }

  // リマインダーキャンセル（ベストエフォート）
  try {
    await cancelReminderByBookingId(c.env.DB, bookingId, {
      friendId: friend.id,
      targetDate: booking.start_at.slice(0, 10),
    });
  } catch (err) {
    console.error('リマインダーキャンセルエラー:', err);
  }

  // 院長通知（ベストエフォート）
  if (account.admin_line_user_id) {
    c.executionCtx.waitUntil(
      notifyAdminBookingCancelled(c.env.DB, account.channel_access_token, account.admin_line_user_id, booking, lineAccountId)
        .then(() => { if (gcalWarning && account.admin_line_user_id) {
          new LineClient(account.channel_access_token)
            .pushMessage(account.admin_line_user_id, [{ type: 'text', text: `[注意] ${gcalWarning}（予約ID: ${bookingId}）` }])
            .catch(console.warn);
        }})
        .catch(console.warn),
    );
  }

  return c.json({ success: true });
});

// ---- PUT /api/public/my-bookings/:id/reschedule ----------------------------

bookingPublic.put('/api/public/my-bookings/:id/reschedule', async (c) => {
  const lineAccountId = c.req.query('line_account_id');
  if (!lineAccountId) return c.json({ success: false, error: 'line_account_id is required' }, 400);

  const idToken = c.req.header('X-LIFF-ID-Token');
  if (!idToken) return c.json({ success: false, error: 'X-LIFF-ID-Token header is required' }, 401);

  const lineUserId = await verifyLiffIdTokenForAccount(c.env.DB, idToken, lineAccountId, c.env.LINE_LOGIN_CHANNEL_ID);
  if (!lineUserId) return c.json({ success: false, error: 'Invalid ID token' }, 401);

  const friend = await getFriendByLineUserId(c.env.DB, lineUserId);
  if (!friend) return c.json({ success: false, error: 'Unauthorized' }, 401);

  const bookingId = c.req.param('id');
  const booking = await getBookingById(c.env.DB, bookingId);
  if (!booking) return c.json({ success: false, error: 'Booking not found' }, 404);

  if (booking.friend_id !== friend.id || booking.line_account_id !== lineAccountId) {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }
  if (booking.status !== 'confirmed') {
    return c.json({ success: false, error: 'この予約は変更できません' }, 400);
  }

  const account = await getLineAccountById(c.env.DB, lineAccountId);
  if (!account) return c.json({ success: false, error: 'Account not found' }, 404);

  if (!isWithinCancelDeadline(booking, account.cancel_deadline_hours)) {
    return c.json({ success: false, error: '変更期限を過ぎています' }, 400);
  }

  const body = await c.req.json<{ date: string; time: string }>();
  const { date, time } = body;
  if (!date || !time) return c.json({ success: false, error: 'date and time are required' }, 400);

  // 新しい start/end を計算（既存メニューの duration を使用）
  const duration = booking.menu_duration_snapshot ?? 60;
  const newStartAt = `${date}T${time}:00+09:00`;
  const [h, m] = time.split(':').map(Number);
  const endMinutes = h * 60 + m + duration;
  const newEndAt = `${date}T${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00+09:00`;

  // H2: サーバー側での日時バリデーション
  const newStartMs = new Date(newStartAt).getTime();
  // RES-M1: 不正な日時文字列の場合 NaN になるため先にチェック
  if (!Number.isFinite(newStartMs)) {
    return c.json({ success: false, error: '不正な日時形式です' }, 400);
  }
  const nowMs = Date.now();
  const minBookingHours = account.min_booking_hours ?? 3;
  const maxBookingDays = account.max_booking_days ?? 14;
  if (newStartMs - nowMs < minBookingHours * 3_600_000) {
    return c.json({ success: false, error: `予約は${minBookingHours}時間以上前にお申込みください` }, 400);
  }
  if (newStartMs - nowMs > maxBookingDays * 86_400_000) {
    return c.json({ success: false, error: `予約は${maxBookingDays}日以内でお申込みください` }, 400);
  }

  // MEDIUM-1: サーバー側でスロット可否を再検証（営業時間・休日・スロット単位・GCal含む）
  // GCal資格情報を先に取得してslot計算に渡す
  let slotGcalId: string | undefined;
  let slotGcalToken: string | undefined;
  if (account.google_calendar_connection_id) {
    const slotConn = await getCalendarConnectionById(c.env.DB, account.google_calendar_connection_id);
    if (slotConn?.access_token) {
      slotGcalId = slotConn.calendar_id;
      slotGcalToken = slotConn.access_token;
    }
  }
  const validSlots = await calculateSlots(
    {
      db: c.env.DB,
      lineAccountId,
      googleCalendarId: slotGcalId,
      googleAccessToken: slotGcalToken,
      slotUnit: account.slot_unit || 30,
      minBookingHours,
      maxBookingDays,
      excludeBookingId: bookingId,  // DB競合チェックから自分自身を除外
      // GCal連携済みの予約のみ FreeBusy フィルタを適用（event_id がない場合は除外対象なし）
      excludeBusyInterval: booking.event_id ? { start: booking.start_at, end: booking.end_at } : undefined,
    },
    date,
    duration,
  );
  const isValidSlot = validSlots.some((s) => s.time === time && s.available);
  if (!isValidSlot) {
    return c.json({ success: false, error: 'この時間帯は予約できません。別の時間を選択してください。' }, 400);
  }

  // 空き枠チェック（MEDIUM-2: TOCTOU 軽減。reschedule は後段の楽観的ロックでも保護。自分自身を除外）
  const conflicts = (await getConfirmedBookingsInRange(c.env.DB, lineAccountId, newStartAt, newEndAt))
    .filter((b) => b.id !== bookingId);
  if (conflicts.length > 0) {
    return c.json({ success: false, error: 'この時間帯はすでに予約が入っています。別の時間を選択してください。' }, 409);
  }

  // GCal新イベント作成（M2: 失敗したらリスケ全体を失敗にする）
  let newEventId: string | undefined;
  const gcalResult = await getGcalClient(c.env.DB, account.google_calendar_connection_id);
  // RES-M2: GCal連携済み予約なのにクライアント取得失敗した場合もリスケ失敗
  if (booking.event_id && !gcalResult) {
    return c.json({ success: false, error: 'カレンダーへの接続に失敗しました。しばらくしてから再試行してください。' }, 503);
  }
  if (gcalResult && booking.event_id) {
    try {
      const { eventId } = await gcalResult.gcal.createEvent({
        summary: booking.title,
        start: newStartAt,
        end: newEndAt,
        description: booking.customer_note ?? undefined,
      });
      newEventId = eventId;
    } catch (err) {
      console.error('GCal新イベント作成エラー:', err);
      return c.json({ success: false, error: 'カレンダーへの登録に失敗しました。しばらくしてから再試行してください。' }, 503);
    }
  }

  // DB更新（楽観的ロック + NOT EXISTS による原子的競合チェック: MEDIUM-2）
  let updatedBooking: BookingRow | null = null;
  try {
    updatedBooking = await updateBookingSchedule(
      c.env.DB, bookingId, newStartAt, newEndAt, newEventId, booking.event_id,
      { lineAccountId, startAt: newStartAt, endAt: newEndAt },
    );
  } catch (err) {
    // DB更新例外 → 新GCalイベントをベストエフォート削除
    if (newEventId && gcalResult) {
      gcalResult.gcal.deleteEvent(newEventId).catch((e) => console.error('補償GCal削除エラー:', e));
    }
    throw err;
  }

  if (!updatedBooking) {
    // 楽観的ロック競合（同時リスケ）→ 新GCalイベントをベストエフォート削除
    if (newEventId && gcalResult) {
      gcalResult.gcal.deleteEvent(newEventId).catch((e) => console.error('補償GCal削除エラー:', e));
    }
    return c.json({ success: false, error: '予約が別の操作で変更されました。画面を更新してください。' }, 409);
  }

  // 旧GCalイベント削除（ベストエフォート）
  let gcalDeleteWarning: string | undefined;
  if (booking.event_id && gcalResult && newEventId) {
    try {
      await gcalResult.gcal.deleteEvent(booking.event_id);
    } catch (err) {
      console.error('旧GCalイベント削除エラー:', err);
      gcalDeleteWarning = 'Googleカレンダーの旧予約が残っている可能性があります';
    }
  }

  // リマインダーのtarget_date更新（ベストエフォート）
  try {
    await updateReminderTargetDateByBookingId(
      c.env.DB,
      bookingId,
      `${date}T00:00:00+09:00`,
      { friendId: friend.id, oldTargetDate: booking.start_at.slice(0, 10) },
    );
  } catch (err) {
    console.error('リマインダー更新エラー:', err);
  }

  // 院長通知（ベストエフォート）
  if (account.admin_line_user_id) {
    c.executionCtx.waitUntil(
      notifyAdminBookingRescheduled(
        c.env.DB, account.channel_access_token, account.admin_line_user_id,
        booking, updatedBooking, lineAccountId,
      ).then(() => { if (gcalDeleteWarning && account.admin_line_user_id) {
        // LineClient is imported at top of file
        new LineClient(account.channel_access_token)
          .pushMessage(account.admin_line_user_id, [{ type: 'text', text: `[注意] ${gcalDeleteWarning}（予約ID: ${bookingId}）` }])
          .catch(console.warn);
      }})
      .catch(console.warn),
    );
  }

  return c.json({
    success: true,
    data: {
      id: updatedBooking.id,
      startAt: updatedBooking.start_at,
      endAt: updatedBooking.end_at,
    },
  });
});

export { bookingPublic };
