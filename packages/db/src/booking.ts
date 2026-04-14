import { jstNow } from './utils.js';

// =============================================================================
// Booking System — menus, business_hours, schedule_exceptions, calendar_bookings拡張
// =============================================================================

// ---- 型定義 ----------------------------------------------------------------

export interface MenuRow {
  id: string;
  line_account_id: string;
  name: string;
  duration: number;
  price: number | null;
  description: string | null;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BusinessHourRow {
  id: string;
  line_account_id: string;
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  break_start: string | null;
  break_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleExceptionRow {
  id: string;
  line_account_id: string;
  date: string;
  type: 'closed' | 'partial';
  open_time: string | null;
  close_time: string | null;
  note: string | null;
  created_at: string;
}

/** calendar_bookings の予約システム拡張カラムを含む型 */
export interface BookingRow {
  id: string;
  connection_id: string;
  friend_id: string | null;
  event_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  status: string;
  metadata: string | null;
  menu_id: string | null;
  menu_name_snapshot: string | null;
  menu_duration_snapshot: number | null;
  menu_price_snapshot: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_note: string | null;
  line_account_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---- menus -----------------------------------------------------------------

export async function getMenusByAccount(db: D1Database, lineAccountId: string): Promise<MenuRow[]> {
  const result = await db
    .prepare(`SELECT * FROM menus WHERE line_account_id = ? AND is_active = 1 ORDER BY sort_order ASC, created_at ASC`)
    .bind(lineAccountId)
    .all<MenuRow>();
  return result.results;
}

export async function getMenuById(db: D1Database, id: string): Promise<MenuRow | null> {
  return db.prepare(`SELECT * FROM menus WHERE id = ?`).bind(id).first<MenuRow>();
}

export async function createMenu(
  db: D1Database,
  input: { lineAccountId: string; name: string; duration: number; price?: number; description?: string; sortOrder?: number },
): Promise<MenuRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO menus (id, line_account_id, name, duration, price, description, is_active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(id, input.lineAccountId, input.name, input.duration, input.price ?? null, input.description ?? null, input.sortOrder ?? 0, now, now)
    .run();
  return (await getMenuById(db, id))!;
}

export async function updateMenu(
  db: D1Database,
  id: string,
  input: Partial<{ name: string; duration: number; price: number | null; description: string | null; isActive: number; sortOrder: number }>,
): Promise<MenuRow | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
  if (input.duration !== undefined) { fields.push('duration = ?'); values.push(input.duration); }
  if ('price' in input) { fields.push('price = ?'); values.push(input.price ?? null); }
  if ('description' in input) { fields.push('description = ?'); values.push(input.description ?? null); }
  if (input.isActive !== undefined) { fields.push('is_active = ?'); values.push(input.isActive); }
  if (input.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(input.sortOrder); }

  if (fields.length === 0) return getMenuById(db, id);

  fields.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);

  await db.prepare(`UPDATE menus SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  return getMenuById(db, id);
}

export async function deleteMenu(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE menus SET is_active = 0, updated_at = ? WHERE id = ?`).bind(jstNow(), id).run();
}

// ---- business_hours --------------------------------------------------------

export async function getBusinessHoursByAccount(db: D1Database, lineAccountId: string): Promise<BusinessHourRow[]> {
  const result = await db
    .prepare(`SELECT * FROM business_hours WHERE line_account_id = ? ORDER BY day_of_week ASC`)
    .bind(lineAccountId)
    .all<BusinessHourRow>();
  return result.results;
}

export async function getBusinessHourByDay(db: D1Database, lineAccountId: string, dayOfWeek: number): Promise<BusinessHourRow | null> {
  return db
    .prepare(`SELECT * FROM business_hours WHERE line_account_id = ? AND day_of_week = ?`)
    .bind(lineAccountId, dayOfWeek)
    .first<BusinessHourRow>();
}

export async function upsertBusinessHour(
  db: D1Database,
  input: { lineAccountId: string; dayOfWeek: number; openTime: string | null; closeTime: string | null; breakStart?: string | null; breakEnd?: string | null },
): Promise<void> {
  const now = jstNow();
  const existing = await getBusinessHourByDay(db, input.lineAccountId, input.dayOfWeek);
  if (existing) {
    await db
      .prepare(`UPDATE business_hours SET open_time = ?, close_time = ?, break_start = ?, break_end = ?, updated_at = ? WHERE id = ?`)
      .bind(input.openTime, input.closeTime, input.breakStart ?? null, input.breakEnd ?? null, now, existing.id)
      .run();
  } else {
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO business_hours (id, line_account_id, day_of_week, open_time, close_time, break_start, break_end, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, input.lineAccountId, input.dayOfWeek, input.openTime, input.closeTime, input.breakStart ?? null, input.breakEnd ?? null, now, now)
      .run();
  }
}

// ---- schedule_exceptions ---------------------------------------------------

export async function getScheduleExceptionsByAccount(db: D1Database, lineAccountId: string): Promise<ScheduleExceptionRow[]> {
  const result = await db
    .prepare(`SELECT * FROM schedule_exceptions WHERE line_account_id = ? ORDER BY date ASC`)
    .bind(lineAccountId)
    .all<ScheduleExceptionRow>();
  return result.results;
}

export async function getScheduleExceptionByDate(db: D1Database, lineAccountId: string, date: string): Promise<ScheduleExceptionRow | null> {
  return db
    .prepare(`SELECT * FROM schedule_exceptions WHERE line_account_id = ? AND date = ?`)
    .bind(lineAccountId, date)
    .first<ScheduleExceptionRow>();
}

export async function createScheduleException(
  db: D1Database,
  input: { lineAccountId: string; date: string; type: 'closed' | 'partial'; openTime?: string; closeTime?: string; note?: string },
): Promise<ScheduleExceptionRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO schedule_exceptions (id, line_account_id, date, type, open_time, close_time, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.lineAccountId, input.date, input.type, input.openTime ?? null, input.closeTime ?? null, input.note ?? null, now)
    .run();
  return (await db.prepare(`SELECT * FROM schedule_exceptions WHERE id = ?`).bind(id).first<ScheduleExceptionRow>())!;
}

export async function deleteScheduleException(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM schedule_exceptions WHERE id = ?`).bind(id).run();
}

// ---- calendar_bookings 予約システム拡張 ------------------------------------

export interface CreateBookingInput {
  connectionId: string | null;
  lineAccountId: string;
  friendId?: string;
  menuId: string;
  menuNameSnapshot: string;
  menuDurationSnapshot: number;
  menuPriceSnapshot?: number;
  title: string;
  startAt: string;
  endAt: string;
  customerName: string;
  customerPhone?: string;
  customerNote?: string;
}

/**
 * 予約を作成する。
 * CREATE-TOCTOU 対策: INSERT ... SELECT ... WHERE NOT EXISTS で競合チェックをアトミックに実施。
 * 同時刻に confirmed 予約が存在する場合は null を返す（呼び出し元が 409 を返すこと）。
 */
export async function createBooking(db: D1Database, input: CreateBookingInput): Promise<BookingRow | null> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    .prepare(
      `INSERT INTO calendar_bookings
         (id, connection_id, line_account_id, friend_id, title, start_at, end_at, status,
          menu_id, menu_name_snapshot, menu_duration_snapshot, menu_price_snapshot,
          customer_name, customer_phone, customer_note, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM calendar_bookings
         WHERE line_account_id = ? AND status = 'confirmed'
           AND start_at < ? AND end_at > ?
       )`,
    )
    .bind(
      id, input.connectionId, input.lineAccountId, input.friendId ?? null, input.title,
      input.startAt, input.endAt,
      input.menuId, input.menuNameSnapshot, input.menuDurationSnapshot, input.menuPriceSnapshot ?? null,
      input.customerName, input.customerPhone ?? null, input.customerNote ?? null,
      now, now,
      // NOT EXISTS 用パラメータ
      input.lineAccountId, input.endAt, input.startAt,
    )
    .run();

  if (result.meta.changes === 0) return null; // 競合により挿入されなかった
  return (await db.prepare(`SELECT * FROM calendar_bookings WHERE id = ?`).bind(id).first<BookingRow>())!;
}

export async function getBookingsByAccount(
  db: D1Database,
  lineAccountId: string,
  opts: { from?: string; to?: string; status?: string } = {},
): Promise<BookingRow[]> {
  const conditions = ['line_account_id = ?'];
  const values: unknown[] = [lineAccountId];

  if (opts.from) { conditions.push('start_at >= ?'); values.push(opts.from); }
  if (opts.to) { conditions.push('start_at <= ?'); values.push(opts.to); }
  if (opts.status) { conditions.push('status = ?'); values.push(opts.status); }

  const result = await db
    .prepare(`SELECT * FROM calendar_bookings WHERE ${conditions.join(' AND ')} ORDER BY start_at ASC`)
    .bind(...values)
    .all<BookingRow>();
  return result.results;
}

export async function getBookingById(db: D1Database, id: string): Promise<BookingRow | null> {
  return db.prepare(`SELECT * FROM calendar_bookings WHERE id = ?`).bind(id).first<BookingRow>();
}

/** 空き枠計算用: 期間内の確定予約を一括取得（重複判定修正版） */
export async function getConfirmedBookingsInRange(
  db: D1Database,
  lineAccountId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<BookingRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM calendar_bookings
       WHERE line_account_id = ?
         AND status = 'confirmed'
         AND start_at < ?
         AND end_at > ?
       ORDER BY start_at ASC`,
    )
    .bind(lineAccountId, rangeEnd, rangeStart)
    .all<BookingRow>();
  return result.results;
}

export async function updateBookingStatus(db: D1Database, id: string, status: string): Promise<void> {
  await db.prepare(`UPDATE calendar_bookings SET status = ?, updated_at = ? WHERE id = ?`).bind(status, jstNow(), id).run();
}

export async function updateBookingEventId(db: D1Database, id: string, eventId: string): Promise<void> {
  await db.prepare(`UPDATE calendar_bookings SET event_id = ?, updated_at = ? WHERE id = ?`).bind(eventId, jstNow(), id).run();
}

/** 顧客の予約一覧取得（lineAccountId でスコープ） */
export async function getBookingsByFriendId(
  db: D1Database,
  friendId: string,
  lineAccountId: string,
  opts: { from?: string; to?: string; status?: string } = {},
): Promise<BookingRow[]> {
  const conditions = ['friend_id = ?', 'line_account_id = ?'];
  const values: unknown[] = [friendId, lineAccountId];

  if (opts.from) { conditions.push('start_at >= ?'); values.push(opts.from); }
  if (opts.to) { conditions.push('start_at <= ?'); values.push(opts.to); }
  if (opts.status) { conditions.push('status = ?'); values.push(opts.status); }

  const result = await db
    .prepare(`SELECT * FROM calendar_bookings WHERE ${conditions.join(' AND ')} ORDER BY start_at ASC`)
    .bind(...values)
    .all<BookingRow>();
  return result.results;
}

/**
 * 予約の日時を更新（confirmed のみ）。
 * eventId を指定すると event_id も同時に更新。
 * expectedEventId を指定すると楽観的ロック（WHERE event_id = ?）を適用し、
 * 競合時（0行更新）は null を返す。
 */
export async function updateBookingSchedule(
  db: D1Database,
  id: string,
  startAt: string,
  endAt: string,
  eventId?: string,
  expectedEventId?: string | null,
  conflictCheck?: { lineAccountId: string; startAt: string; endAt: string },
): Promise<BookingRow | null> {
  const fields = ['start_at = ?', 'end_at = ?', 'updated_at = ?'];
  const values: unknown[] = [startAt, endAt, jstNow()];

  if (eventId !== undefined) {
    fields.push('event_id = ?');
    values.push(eventId);
  }

  let sql = `UPDATE calendar_bookings SET ${fields.join(', ')} WHERE id = ? AND status = 'confirmed'`;
  values.push(id);

  // 楽観的ロック: null は IS NULL、文字列は = ? で比較
  if (expectedEventId !== undefined) {
    if (expectedEventId === null) {
      sql += ' AND event_id IS NULL';
    } else {
      sql += ' AND event_id = ?';
      values.push(expectedEventId);
    }
  }

  // MEDIUM-2: 競合チェックをUPDATEと同一ステートメントでアトミックに実行
  if (conflictCheck) {
    sql += ` AND NOT EXISTS (
      SELECT 1 FROM calendar_bookings
      WHERE line_account_id = ? AND status = 'confirmed' AND id != ?
        AND start_at < ? AND end_at > ?
    )`;
    values.push(conflictCheck.lineAccountId, id, conflictCheck.endAt, conflictCheck.startAt);
  }

  const result = await db.prepare(sql).bind(...values).run();
  if (result.meta.changes === 0) return null;
  return db.prepare(`SELECT * FROM calendar_bookings WHERE id = ?`).bind(id).first<BookingRow>();
}
