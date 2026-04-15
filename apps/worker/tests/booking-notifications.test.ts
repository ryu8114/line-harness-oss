/// <reference types="@cloudflare/workers-types" />
/**
 * Tests for booking-notifications service layer.
 *
 * Covers:
 *  - formatDateJa / formatTime pure utilities
 *  - registerBookingReminder end-to-end via FakeD1:
 *      · tenant-scoped reminder master creation
 *      · reminder step with correct offset (-360 min)
 *      · friend_reminders enrollment with correct target_date / booking_id
 *      · separate masters for different line_account_ids
 *      · master reuse on second call for the same tenant
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock heavy imports before the module under test is loaded
vi.mock('../src/services/event-bus.js', () => ({ fireEvent: vi.fn() }));
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn(() => ({ pushMessage: vi.fn() })),
}));

import {
  formatDateJa,
  formatTime,
  registerBookingReminder,
} from '../src/services/booking-notifications.js';
import { FakeD1 } from './fake-d1.js';
import type { BookingRow } from '@line-crm/db';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeBooking(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: 'booking-1',
    connection_id: 'conn-1',
    friend_id: 'friend-1',
    event_id: null,
    title: 'テスト施術',
    start_at: '2026-04-20T10:00:00+09:00',
    end_at: '2026-04-20T11:00:00+09:00',
    status: 'confirmed',
    metadata: null,
    menu_id: 'menu-1',
    menu_name_snapshot: 'テスト施術',
    menu_duration_snapshot: 60,
    menu_price_snapshot: 5000,
    customer_name: 'テスト 太郎',
    customer_phone: null,
    customer_note: null,
    line_account_id: 'account-1',
    created_at: '2026-04-15T09:00:00+09:00',
    updated_at: '2026-04-15T09:00:00+09:00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatDateJa
// ---------------------------------------------------------------------------

describe('formatDateJa', () => {
  it.each([
    ['2026-04-19T10:00:00+09:00', '2026年4月19日(日)'],
    ['2026-04-20T10:00:00+09:00', '2026年4月20日(月)'],
    ['2026-04-21T10:00:00+09:00', '2026年4月21日(火)'],
    ['2026-04-22T10:00:00+09:00', '2026年4月22日(水)'],
    ['2026-04-23T10:00:00+09:00', '2026年4月23日(木)'],
    ['2026-04-24T10:00:00+09:00', '2026年4月24日(金)'],
    ['2026-04-25T10:00:00+09:00', '2026年4月25日(土)'],
  ])('formats %s → %s', (input, expected) => {
    expect(formatDateJa(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------

describe('formatTime', () => {
  it.each([
    ['2026-04-20T10:00:00+09:00', '10:00'],
    ['2026-04-20T09:30:00+09:00', '09:30'],
    ['2026-04-20T18:00:00+09:00', '18:00'],
    ['2026-04-20T00:05:00+09:00', '00:05'],
  ])('extracts time from %s → %s', (input, expected) => {
    expect(formatTime(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// registerBookingReminder
// ---------------------------------------------------------------------------

describe('registerBookingReminder', () => {
  let db: FakeD1;

  beforeEach(() => {
    db = new FakeD1();
  });

  it('creates a tenant-scoped reminder master on first call', async () => {
    await registerBookingReminder(
      db as unknown as D1Database,
      'friend-1',
      '2026-04-20',
      makeBooking(),
      'account-1',
    );

    expect(db.tables.reminders).toHaveLength(1);
    expect(db.tables.reminders[0].name).toBe('予約前日リマインド_account-1');
    expect(db.tables.reminders[0].is_active).toBe(1);
  });

  it('attaches a single step with offset_minutes = -360', async () => {
    await registerBookingReminder(
      db as unknown as D1Database,
      'friend-1',
      '2026-04-20',
      makeBooking(),
      'account-1',
    );

    expect(db.tables.reminder_steps).toHaveLength(1);
    expect(db.tables.reminder_steps[0].offset_minutes).toBe(-360);
    expect(db.tables.reminder_steps[0].message_type).toBe('text');
  });

  it('enrolls the friend with the booking date and booking_id', async () => {
    await registerBookingReminder(
      db as unknown as D1Database,
      'friend-1',
      '2026-04-20',
      makeBooking({ id: 'bk-abc' }),
      'account-1',
    );

    expect(db.tables.friend_reminders).toHaveLength(1);
    const fr = db.tables.friend_reminders[0];
    expect(fr.friend_id).toBe('friend-1');
    expect(String(fr.target_date)).toContain('2026-04-20');
    expect(fr.booking_id).toBe('bk-abc');
    expect(fr.status).toBe('active');
  });

  it('creates separate reminder masters for different tenants', async () => {
    await registerBookingReminder(
      db as unknown as D1Database,
      'friend-1', '2026-04-20', makeBooking({ id: 'bk-1' }), 'account-A',
    );
    await registerBookingReminder(
      db as unknown as D1Database,
      'friend-2', '2026-04-20', makeBooking({ id: 'bk-2' }), 'account-B',
    );

    expect(db.tables.reminders).toHaveLength(2);
    const names = db.tables.reminders.map((r) => r.name as string);
    expect(names).toContain('予約前日リマインド_account-A');
    expect(names).toContain('予約前日リマインド_account-B');

    // Each friend is enrolled under its own tenant's reminder
    expect(db.tables.friend_reminders).toHaveLength(2);
    const frA = db.tables.friend_reminders.find((fr) => fr.friend_id === 'friend-1')!;
    const frB = db.tables.friend_reminders.find((fr) => fr.friend_id === 'friend-2')!;
    expect(frA.reminder_id).not.toBe(frB.reminder_id);
  });

  it('reuses the same reminder master on subsequent calls for the same tenant', async () => {
    await registerBookingReminder(
      db as unknown as D1Database,
      'friend-1', '2026-04-20', makeBooking({ id: 'bk-1' }), 'account-1',
    );
    await registerBookingReminder(
      db as unknown as D1Database,
      'friend-1', '2026-04-21', makeBooking({ id: 'bk-2' }), 'account-1',
    );

    // One master, one step, two enrollments
    expect(db.tables.reminders).toHaveLength(1);
    expect(db.tables.reminder_steps).toHaveLength(1);
    expect(db.tables.friend_reminders).toHaveLength(2);
  });

  it('self-heals: adds a missing step when master exists but has no steps', async () => {
    // Simulate a reminder master that somehow lost all its steps (e.g. manual deletion)
    const now = '2026-01-01T00:00:00+09:00';
    db.tables.reminders.push({
      id: 'rem-existing',
      name: '予約前日リマインド_account-1',
      description: null,
      is_active: 1,
      created_at: now,
      updated_at: now,
    });
    // No steps seeded — tables.reminder_steps is empty

    await registerBookingReminder(
      db as unknown as D1Database,
      'friend-1', '2026-04-20', makeBooking(), 'account-1',
    );

    // Master was reused (not duplicated), step was auto-created
    expect(db.tables.reminders).toHaveLength(1);
    expect(db.tables.reminder_steps).toHaveLength(1);
    expect(db.tables.reminder_steps[0].offset_minutes).toBe(-360);
    expect(db.tables.friend_reminders).toHaveLength(1);
  });
});
