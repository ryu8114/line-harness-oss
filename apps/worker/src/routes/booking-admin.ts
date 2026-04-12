/**
 * 管理者API — 予約システム
 *
 * 認証: 既存の Bearer + staff_members テーブルをそのまま使用。
 * 院ごとに staff_members レコードを作成し、APIキーを発行する。
 */

import { Hono } from 'hono';
import {
  getMenusByAccount,
  getMenuById,
  createMenu,
  updateMenu,
  deleteMenu,
  getBusinessHoursByAccount,
  upsertBusinessHour,
  getScheduleExceptionsByAccount,
  createScheduleException,
  deleteScheduleException,
  getBookingsByAccount,
  getBookingById,
  updateBookingStatus,
} from '@line-crm/db';
import { checkOwnership } from '../middleware/tenant.js';
import type { Env } from '../index.js';

const bookingAdmin = new Hono<Env>();

// ---- メニュー管理 ----------------------------------------------------------

bookingAdmin.get('/api/booking/admin/menus', async (c) => {
  const lineAccountId = c.get('resolvedLineAccountId') ?? c.req.query('line_account_id');
  if (!lineAccountId) return c.json({ success: false, error: 'line_account_id is required' }, 400);

  const menus = await getMenusByAccount(c.env.DB, lineAccountId);
  return c.json({
    success: true,
    data: menus.map((m) => ({
      id: m.id, name: m.name, duration: m.duration, price: m.price,
      description: m.description, isActive: Boolean(m.is_active), sortOrder: m.sort_order,
      createdAt: m.created_at, updatedAt: m.updated_at,
    })),
  });
});

bookingAdmin.post('/api/booking/admin/menus', async (c) => {
  const body = await c.req.json<{
    lineAccountId: string; name: string; duration: number;
    price?: number; description?: string; sortOrder?: number;
  }>();
  if (!body.name || !body.duration) {
    return c.json({ success: false, error: 'name, duration are required' }, 400);
  }
  const staff = c.get('staff');
  // admin/staff は body の lineAccountId を無視して自院IDを使う
  const resolvedAccountId = staff.role !== 'owner' ? staff.lineAccountId : body.lineAccountId;
  if (!resolvedAccountId) {
    return c.json({ success: false, error: 'lineAccountId is required' }, 400);
  }
  const menu = await createMenu(c.env.DB, {
    lineAccountId: resolvedAccountId, name: body.name, duration: body.duration,
    price: body.price, description: body.description, sortOrder: body.sortOrder,
  });
  return c.json({ success: true, data: { id: menu.id, name: menu.name, duration: menu.duration } }, 201);
});

bookingAdmin.put('/api/booking/admin/menus/:id', async (c) => {
  const id = c.req.param('id');
  const menu = await getMenuById(c.env.DB, id);
  if (!menu) return c.json({ success: false, error: 'Menu not found' }, 404);
  if (!checkOwnership(c.get('staff'), menu.line_account_id ?? null)) {
    return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
  }
  const body = await c.req.json<{
    name?: string; duration?: number; price?: number | null;
    description?: string | null; isActive?: number; sortOrder?: number;
  }>();
  const updated = await updateMenu(c.env.DB, id, {
    name: body.name, duration: body.duration, price: body.price,
    description: body.description, isActive: body.isActive, sortOrder: body.sortOrder,
  });
  if (!updated) return c.json({ success: false, error: 'Menu not found' }, 404);
  return c.json({ success: true, data: { id: updated.id, name: updated.name, duration: updated.duration } });
});

bookingAdmin.delete('/api/booking/admin/menus/:id', async (c) => {
  const id = c.req.param('id');
  const menu = await getMenuById(c.env.DB, id);
  if (!menu) return c.json({ success: false, error: 'Menu not found' }, 404);
  if (!checkOwnership(c.get('staff'), menu.line_account_id ?? null)) {
    return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
  }
  await deleteMenu(c.env.DB, id);
  return c.json({ success: true, data: null });
});

// ---- 営業時間管理 ----------------------------------------------------------

bookingAdmin.get('/api/booking/admin/business-hours', async (c) => {
  const lineAccountId = c.get('resolvedLineAccountId') ?? c.req.query('line_account_id');
  if (!lineAccountId) return c.json({ success: false, error: 'line_account_id is required' }, 400);

  const hours = await getBusinessHoursByAccount(c.env.DB, lineAccountId);
  return c.json({
    success: true,
    data: hours.map((h) => ({
      id: h.id, dayOfWeek: h.day_of_week, openTime: h.open_time, closeTime: h.close_time,
      breakStart: h.break_start, breakEnd: h.break_end,
    })),
  });
});

bookingAdmin.put('/api/booking/admin/business-hours', async (c) => {
  const body = await c.req.json<{
    lineAccountId: string;
    hours: Array<{
      dayOfWeek: number; openTime: string | null; closeTime: string | null;
      breakStart?: string | null; breakEnd?: string | null;
    }>;
  }>();
  if (!Array.isArray(body.hours)) {
    return c.json({ success: false, error: 'hours[] is required' }, 400);
  }
  const staff = c.get('staff');
  // admin/staff は body の lineAccountId を無視して自院IDを使う
  const resolvedAccountId = staff.role !== 'owner' ? staff.lineAccountId : body.lineAccountId;
  if (!resolvedAccountId) {
    return c.json({ success: false, error: 'lineAccountId is required' }, 400);
  }
  for (const h of body.hours) {
    await upsertBusinessHour(c.env.DB, {
      lineAccountId: resolvedAccountId, dayOfWeek: h.dayOfWeek,
      openTime: h.openTime, closeTime: h.closeTime,
      breakStart: h.breakStart, breakEnd: h.breakEnd,
    });
  }
  return c.json({ success: true, data: null });
});

// ---- 例外日管理 ------------------------------------------------------------

bookingAdmin.get('/api/booking/admin/schedule-exceptions', async (c) => {
  const lineAccountId = c.get('resolvedLineAccountId') ?? c.req.query('line_account_id');
  if (!lineAccountId) return c.json({ success: false, error: 'line_account_id is required' }, 400);

  const exceptions = await getScheduleExceptionsByAccount(c.env.DB, lineAccountId);
  return c.json({
    success: true,
    data: exceptions.map((e) => ({
      id: e.id, date: e.date, type: e.type,
      openTime: e.open_time, closeTime: e.close_time, note: e.note,
      createdAt: e.created_at,
    })),
  });
});

bookingAdmin.post('/api/booking/admin/schedule-exceptions', async (c) => {
  const body = await c.req.json<{
    lineAccountId: string; date: string; type: 'closed' | 'partial';
    openTime?: string; closeTime?: string; note?: string;
  }>();
  if (!body.date || !body.type) {
    return c.json({ success: false, error: 'date, type are required' }, 400);
  }
  if (body.type === 'partial' && (!body.openTime || !body.closeTime)) {
    return c.json({ success: false, error: 'openTime and closeTime are required for partial exceptions' }, 400);
  }
  const staff = c.get('staff');
  const resolvedAccountId = staff.role !== 'owner' ? staff.lineAccountId : body.lineAccountId;
  if (!resolvedAccountId) {
    return c.json({ success: false, error: 'lineAccountId is required' }, 400);
  }
  const exception = await createScheduleException(c.env.DB, {
    lineAccountId: resolvedAccountId, date: body.date, type: body.type,
    openTime: body.openTime, closeTime: body.closeTime, note: body.note,
  });
  return c.json({ success: true, data: { id: exception.id, date: exception.date, type: exception.type } }, 201);
});

bookingAdmin.delete('/api/booking/admin/schedule-exceptions/:id', async (c) => {
  const id = c.req.param('id');
  // 所有権確認のために対象レコードを取得
  const exception = await c.env.DB
    .prepare('SELECT line_account_id FROM schedule_exceptions WHERE id = ?')
    .bind(id)
    .first<{ line_account_id: string | null }>();
  if (!exception) return c.json({ success: false, error: 'Schedule exception not found' }, 404);
  if (!checkOwnership(c.get('staff'), exception.line_account_id ?? null)) {
    return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
  }
  await deleteScheduleException(c.env.DB, id);
  return c.json({ success: true, data: null });
});

// ---- 予約管理 --------------------------------------------------------------

bookingAdmin.get('/api/booking/admin/bookings', async (c) => {
  const lineAccountId = c.get('resolvedLineAccountId') ?? c.req.query('line_account_id');
  if (!lineAccountId) return c.json({ success: false, error: 'line_account_id is required' }, 400);

  const from = c.req.query('from');
  const toRaw = c.req.query('to');
  const status = c.req.query('status');

  // Date-only strings (YYYY-MM-DD) must include end-of-day time for correct comparison
  // against stored ISO datetime strings (e.g. '2026-04-15T10:00:00' > '2026-04-15')
  const to = toRaw && !toRaw.includes('T') ? `${toRaw}T23:59:59` : toRaw;

  const bookings = await getBookingsByAccount(c.env.DB, lineAccountId, { from, to, status });
  return c.json({
    success: true,
    data: bookings.map((b) => ({
      id: b.id, startAt: b.start_at, endAt: b.end_at, status: b.status,
      menuName: b.menu_name_snapshot, menuDuration: b.menu_duration_snapshot,
      customerName: b.customer_name, customerPhone: b.customer_phone,
      customerNote: b.customer_note, createdAt: b.created_at,
    })),
  });
});

bookingAdmin.get('/api/booking/admin/bookings/:id', async (c) => {
  const booking = await getBookingById(c.env.DB, c.req.param('id'));
  if (!booking) return c.json({ success: false, error: 'Booking not found' }, 404);
  if (!checkOwnership(c.get('staff'), booking.line_account_id ?? null)) {
    return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
  }
  return c.json({
    success: true,
    data: {
      id: booking.id, startAt: booking.start_at, endAt: booking.end_at, status: booking.status,
      menuName: booking.menu_name_snapshot, menuDuration: booking.menu_duration_snapshot,
      menuPrice: booking.menu_price_snapshot, customerName: booking.customer_name,
      customerPhone: booking.customer_phone, customerNote: booking.customer_note,
      googleEventId: booking.event_id, createdAt: booking.created_at,
    },
  });
});

bookingAdmin.put('/api/booking/admin/bookings/:id', async (c) => {
  const id = c.req.param('id');
  const booking = await getBookingById(c.env.DB, id);
  if (!booking) return c.json({ success: false, error: 'Booking not found' }, 404);
  if (!checkOwnership(c.get('staff'), booking.line_account_id ?? null)) {
    return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
  }

  const { status } = await c.req.json<{ status: string }>();
  if (!status) return c.json({ success: false, error: 'status is required' }, 400);

  // キャンセル時はGoogleカレンダーからも削除（ベストエフォート）
  if (status === 'cancelled' && booking.event_id) {
    try {
      const { getCalendarConnectionById } = await import('@line-crm/db');
      const { getLineAccountById } = await import('@line-crm/db');
      const account = booking.line_account_id ? await getLineAccountById(c.env.DB, booking.line_account_id) : null;
      if (account?.google_calendar_connection_id) {
        const conn = await getCalendarConnectionById(c.env.DB, account.google_calendar_connection_id);
        if (conn?.access_token) {
          const { GoogleCalendarClient } = await import('../services/google-calendar.js');
          const gcal = new GoogleCalendarClient({ calendarId: conn.calendar_id, accessToken: conn.access_token });
          await gcal.deleteEvent(booking.event_id);
        }
      }
    } catch (err) {
      console.warn('Googleカレンダーイベント削除エラー:', err);
    }
  }

  await updateBookingStatus(c.env.DB, id, status);
  return c.json({ success: true, data: null });
});

export { bookingAdmin };
