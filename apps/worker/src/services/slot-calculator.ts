/**
 * 空き枠計算サービス
 *
 * 「営業時間 - 例外 - 休憩 - 既存予約 - Google FreeBusy」から
 * 予約可能スロットを計算する。
 */

import {
  getBusinessHourByDay,
  getScheduleExceptionByDate,
  getConfirmedBookingsInRange,
  type BusinessHourRow,
} from '@line-crm/db';
import { GoogleCalendarClient, type BusyInterval } from './google-calendar.js';

export interface SlotResult {
  time: string;     // "HH:MM"
  available: boolean;
}

export interface SlotCalculatorOptions {
  db: D1Database;
  lineAccountId: string;
  /** カレンダー接続のアクセストークン（ある場合にGoogle FreeBusy取得） */
  googleCalendarId?: string;
  googleAccessToken?: string;
  /** スロット単位（分）デフォルト30 */
  slotUnit?: number;
  /** 現在時刻からN時間後以降のみ予約可能（デフォルト3） */
  minBookingHours?: number;
  /** 今日からN日先まで予約可能（デフォルト14） */
  maxBookingDays?: number;
  /**
   * リスケジュール時: この予約IDを既存予約の競合チェックから除外する。
   * 自分自身の予約との重複で誤拒否されないようにするため。
   */
  excludeBookingId?: string;
  /**
   * リスケジュール時: このインターバルを Google FreeBusy チェックから除外する。
   * 元予約のGCalイベントが FreeBusy に含まれることで誤拒否されないようにするため。
   * start/end は ISO 8601 形式（タイムゾーン付き）。
   */
  excludeBusyInterval?: { start: string; end: string };
}

/**
 * 指定日の空き枠を計算して返す。
 * @param date "YYYY-MM-DD"
 * @param durationMinutes 選択したメニューの長さ（分）
 */
export async function calculateSlots(
  opts: SlotCalculatorOptions,
  date: string,
  durationMinutes: number,
): Promise<SlotResult[]> {
  const slotUnit = opts.slotUnit ?? 30;
  const minBookingHours = opts.minBookingHours ?? 3;
  const maxBookingDays = opts.maxBookingDays ?? 14;

  // --- 1. 予約可能範囲チェック ---
  const today = getTodayJst();
  // Use UTC noon to keep date arithmetic correct regardless of runtime timezone
  const target = new Date(`${date}T12:00:00Z`);
  const todayDate = new Date(`${today}T12:00:00Z`);
  const maxDate = new Date(todayDate);
  maxDate.setUTCDate(maxDate.getUTCDate() + maxBookingDays);

  if (target < todayDate || target > maxDate) return [];

  // --- 2. 曜日の営業時間取得 ---
  const dayOfWeek = target.getUTCDay(); // 0=日曜
  const bh = await getBusinessHourByDay(opts.db, opts.lineAccountId, dayOfWeek);
  if (!bh || !bh.open_time || !bh.close_time) return []; // 定休日

  // --- 3. 例外日チェック ---
  const exception = await getScheduleExceptionByDate(opts.db, opts.lineAccountId, date);
  if (exception?.type === 'closed') return [];

  let openTime = bh.open_time;
  let closeTime = bh.close_time;
  let breakStart = bh.break_start;
  let breakEnd = bh.break_end;

  if (exception?.type === 'partial' && exception.open_time && exception.close_time) {
    openTime = exception.open_time;
    closeTime = exception.close_time;
    breakStart = null;
    breakEnd = null;
  }

  // --- 4. 既存予約を一括取得 ---
  const dayStart = `${date}T00:00:00+09:00`;
  const dayEnd = `${date}T23:59:59+09:00`;
  const existingBookings = await getConfirmedBookingsInRange(opts.db, opts.lineAccountId, dayStart, dayEnd);

  // --- 5. Google FreeBusy 取得（ベストエフォート）---
  let googleBusy: BusyInterval[] = [];
  if (opts.googleCalendarId && opts.googleAccessToken) {
    try {
      const gcal = new GoogleCalendarClient({
        calendarId: opts.googleCalendarId,
        accessToken: opts.googleAccessToken,
      });
      const timeMin = `${date}T${openTime}:00+09:00`;
      const timeMax = `${date}T${closeTime}:00+09:00`;
      googleBusy = await gcal.getFreeBusy(timeMin, timeMax);
    } catch (err) {
      console.warn('Google FreeBusy API error (falling back to DB only):', err);
    }
  }

  // --- 6. 候補スロット生成 ---
  const nowJst = new Date(getNowJst());
  const minBookingMs = minBookingHours * 60 * 60 * 1000;
  const earliestBookableMs = nowJst.getTime() + minBookingMs;

  const [openH, openM] = openTime.split(':').map(Number);
  const [closeH, closeM] = closeTime.split(':').map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  const breakStartMinutes = breakStart ? (() => { const [h, m] = breakStart.split(':').map(Number); return h * 60 + m; })() : null;
  const breakEndMinutes = breakEnd ? (() => { const [h, m] = breakEnd.split(':').map(Number); return h * 60 + m; })() : null;

  const slots: SlotResult[] = [];

  for (let slotStart = openMinutes; slotStart + durationMinutes <= closeMinutes; slotStart += slotUnit) {
    const slotEnd = slotStart + durationMinutes;
    const timeStr = minutesToTime(slotStart);

    const slotStartDate = new Date(`${date}T${minutesToTime(slotStart)}:00+09:00`);
    const slotEndDate = new Date(`${date}T${minutesToTime(slotEnd)}:00+09:00`);

    // a. 最短予約時間チェック（当日のみ）
    if (date === today && slotStartDate.getTime() < earliestBookableMs) {
      slots.push({ time: timeStr, available: false });
      continue;
    }

    // b. 休憩時間との重複チェック
    if (breakStartMinutes !== null && breakEndMinutes !== null) {
      if (slotStart < breakEndMinutes && slotEnd > breakStartMinutes) {
        slots.push({ time: timeStr, available: false });
        continue;
      }
    }

    // c. 既存予約との重複チェック（excludeBookingId はリスケジュール時に自分自身を除外）
    const hasBookingConflict = existingBookings
      .filter((b) => opts.excludeBookingId === undefined || b.id !== opts.excludeBookingId)
      .some((b) => {
        const bStart = new Date(b.start_at).getTime();
        const bEnd = new Date(b.end_at).getTime();
        return slotStartDate.getTime() < bEnd && slotEndDate.getTime() > bStart;
      });
    if (hasBookingConflict) {
      slots.push({ time: timeStr, available: false });
      continue;
    }

    // d. Google FreeBusy との重複チェック（元予約のインターバルは除外）
    const excBusyStart = opts.excludeBusyInterval ? new Date(opts.excludeBusyInterval.start).getTime() : null;
    const excBusyEnd   = opts.excludeBusyInterval ? new Date(opts.excludeBusyInterval.end).getTime()   : null;
    const hasGoogleConflict = googleBusy
      .filter((interval) => {
        if (excBusyStart === null || excBusyEnd === null) return true;
        const gStart = new Date(interval.start).getTime();
        const gEnd   = new Date(interval.end).getTime();
        // 元予約と完全に一致するインターバルを除外
        return !(gStart === excBusyStart && gEnd === excBusyEnd);
      })
      .some((interval) => {
        const gStart = new Date(interval.start).getTime();
        const gEnd = new Date(interval.end).getTime();
        return slotStartDate.getTime() < gEnd && slotEndDate.getTime() > gStart;
      });
    if (hasGoogleConflict) {
      slots.push({ time: timeStr, available: false });
      continue;
    }

    slots.push({ time: timeStr, available: true });
  }

  return slots;
}

/**
 * 複数日の空き枠を一括計算する。
 * @param from "YYYY-MM-DD"
 * @param to   "YYYY-MM-DD"
 */
export async function calculateSlotsMultiDay(
  opts: SlotCalculatorOptions,
  from: string,
  to: string,
  durationMinutes: number,
): Promise<Record<string, SlotResult[]>> {
  const result: Record<string, SlotResult[]> = {};
  const dates = getDateRange(from, to);

  // 期間内の予約を一括取得（N+1回避）
  const rangeStart = `${from}T00:00:00+09:00`;
  const rangeEnd = `${to}T23:59:59+09:00`;
  const allBookings = await getConfirmedBookingsInRange(opts.db, opts.lineAccountId, rangeStart, rangeEnd);

  // 日付ごとに予約を振り分ける
  const bookingsByDate = new Map<string, typeof allBookings>();
  for (const b of allBookings) {
    const d = b.start_at.slice(0, 10);
    if (!bookingsByDate.has(d)) bookingsByDate.set(d, []);
    bookingsByDate.get(d)!.push(b);
  }

  for (const date of dates) {
    // 単日計算（既存予約はbookingsByDateから渡す）
    result[date] = await calculateSlotsForDate(opts, date, durationMinutes, bookingsByDate.get(date) ?? []);
  }

  return result;
}

/** 単日計算（既存予約をキャッシュから受け取る内部関数） */
async function calculateSlotsForDate(
  opts: SlotCalculatorOptions,
  date: string,
  durationMinutes: number,
  existingBookings: Awaited<ReturnType<typeof getConfirmedBookingsInRange>>,
): Promise<SlotResult[]> {
  const slotUnit = opts.slotUnit ?? 30;
  const minBookingHours = opts.minBookingHours ?? 3;
  const maxBookingDays = opts.maxBookingDays ?? 14;

  const today = getTodayJst();
  // Use UTC noon to keep date arithmetic correct regardless of runtime timezone
  const target = new Date(`${date}T12:00:00Z`);
  const todayDate = new Date(`${today}T12:00:00Z`);
  const maxDate = new Date(todayDate);
  maxDate.setUTCDate(maxDate.getUTCDate() + maxBookingDays);

  if (target < todayDate || target > maxDate) return [];

  const dayOfWeek = target.getUTCDay();
  const bh = await getBusinessHourByDay(opts.db, opts.lineAccountId, dayOfWeek);
  if (!bh || !bh.open_time || !bh.close_time) return [];

  const exception = await getScheduleExceptionByDate(opts.db, opts.lineAccountId, date);
  if (exception?.type === 'closed') return [];

  let openTime = bh.open_time;
  let closeTime = bh.close_time;
  let breakStart = bh.break_start;
  let breakEnd = bh.break_end;

  if (exception?.type === 'partial' && exception.open_time && exception.close_time) {
    openTime = exception.open_time;
    closeTime = exception.close_time;
    breakStart = null;
    breakEnd = null;
  }

  const nowJst = new Date(getNowJst());
  const minBookingMs = minBookingHours * 60 * 60 * 1000;
  const earliestBookableMs = nowJst.getTime() + minBookingMs;

  const [openH, openM] = openTime.split(':').map(Number);
  const [closeH, closeM] = closeTime.split(':').map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  const breakStartMinutes = breakStart ? (() => { const [h, m] = breakStart.split(':').map(Number); return h * 60 + m; })() : null;
  const breakEndMinutes = breakEnd ? (() => { const [h, m] = breakEnd.split(':').map(Number); return h * 60 + m; })() : null;

  const slots: SlotResult[] = [];

  for (let slotStart = openMinutes; slotStart + durationMinutes <= closeMinutes; slotStart += slotUnit) {
    const slotEnd = slotStart + durationMinutes;
    const timeStr = minutesToTime(slotStart);
    const slotStartDate = new Date(`${date}T${minutesToTime(slotStart)}:00+09:00`);
    const slotEndDate = new Date(`${date}T${minutesToTime(slotEnd)}:00+09:00`);

    if (date === today && slotStartDate.getTime() < earliestBookableMs) {
      slots.push({ time: timeStr, available: false }); continue;
    }
    if (breakStartMinutes !== null && breakEndMinutes !== null) {
      if (slotStart < breakEndMinutes && slotEnd > breakStartMinutes) {
        slots.push({ time: timeStr, available: false }); continue;
      }
    }
    const hasConflict = existingBookings
      .filter((b) => opts.excludeBookingId === undefined || b.id !== opts.excludeBookingId)
      .some((b) => {
        const bStart = new Date(b.start_at).getTime();
        const bEnd = new Date(b.end_at).getTime();
        return slotStartDate.getTime() < bEnd && slotEndDate.getTime() > bStart;
      });
    slots.push({ time: timeStr, available: !hasConflict });
  }

  return slots;
}

// ---- ユーティリティ --------------------------------------------------------

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getTodayJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function getNowJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, -1) + '+09:00';
}

function getDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  // Use UTC noon to avoid any timezone-related date shift in toISOString() / getDay()
  const current = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}
