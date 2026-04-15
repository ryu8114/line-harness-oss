/// <reference types="@cloudflare/workers-types" />
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDueReminderDeliveries,
  enrollFriendInReminder,
  getReminderSteps,
} from '../src/reminders.js';
import { FakeD1 } from './fake-d1.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed a reminder master + one step directly into the fake tables. */
function seedReminder(
  db: FakeD1,
  name: string,
  offsetMinutes: number,
): { reminderId: string; stepId: string } {
  const reminderId = 'rem-' + name;
  const stepId = 'step-' + name;
  const now = '2026-01-01T00:00:00+09:00';
  db.tables.reminders.push({
    id: reminderId,
    name,
    description: null,
    is_active: 1,
    created_at: now,
    updated_at: now,
  });
  db.tables.reminder_steps.push({
    id: stepId,
    reminder_id: reminderId,
    offset_minutes: offsetMinutes,
    message_type: 'text',
    message_content: '【リマインド】',
    created_at: now,
  });
  return { reminderId, stepId };
}

/** Seed a friend_reminder linked to an existing reminder. */
function seedFriendReminder(
  db: FakeD1,
  opts: {
    id?: string;
    friendId: string;
    reminderId: string;
    targetDate: string;
    bookingId?: string;
    status?: string;
  },
): void {
  db.tables.friend_reminders.push({
    id: opts.id ?? 'fr-' + opts.friendId,
    friend_id: opts.friendId,
    reminder_id: opts.reminderId,
    target_date: opts.targetDate,
    booking_id: opts.bookingId ?? null,
    status: opts.status ?? 'active',
    created_at: '2026-01-01T00:00:00+09:00',
    updated_at: '2026-01-01T00:00:00+09:00',
  });
}

// ---------------------------------------------------------------------------
// getDueReminderDeliveries — core dispatch timing logic
// ---------------------------------------------------------------------------
//
// The offset maths: delivery_time = target_date_epoch + offset_minutes * 60_000
// With offset_minutes = -360:
//   target_date = 2026-04-20T00:00+09:00  (= 2026-04-19T15:00Z)
//   delivery    = 2026-04-19T18:00+09:00  (= 2026-04-19T09:00Z)

describe('getDueReminderDeliveries', () => {
  let db: FakeD1;

  beforeEach(() => {
    db = new FakeD1();
  });

  it('returns a step when now is after delivery time', async () => {
    const { reminderId, stepId } = seedReminder(db, 'booking-reminder', -360);
    seedFriendReminder(db, {
      friendId: 'f1',
      reminderId,
      targetDate: '2026-04-20T00:00:00+09:00',
      bookingId: 'b1',
    });

    // 19:00 JST on the eve of the booking → after 18:00 delivery
    const due = await getDueReminderDeliveries(
      db as unknown as D1Database,
      '2026-04-19T19:00:00+09:00',
    );

    expect(due).toHaveLength(1);
    expect(due[0].steps).toHaveLength(1);
    expect(due[0].steps[0].id).toBe(stepId);
    expect(due[0].booking_id).toBe('b1');
  });

  it('does not return a step when now is before delivery time', async () => {
    const { reminderId } = seedReminder(db, 'booking-reminder', -360);
    seedFriendReminder(db, {
      friendId: 'f1',
      reminderId,
      targetDate: '2026-04-20T00:00:00+09:00',
    });

    // 17:00 JST on the eve → before 18:00 delivery
    const due = await getDueReminderDeliveries(
      db as unknown as D1Database,
      '2026-04-19T17:00:00+09:00',
    );

    expect(due).toHaveLength(0);
  });

  it('returns a step when now equals the exact delivery time (boundary inclusive)', async () => {
    const { reminderId, stepId } = seedReminder(db, 'booking-reminder', -360);
    seedFriendReminder(db, {
      friendId: 'f1',
      reminderId,
      targetDate: '2026-04-20T00:00:00+09:00',
    });

    // Exactly 18:00 JST — should be included (targetTime <= now)
    const due = await getDueReminderDeliveries(
      db as unknown as D1Database,
      '2026-04-19T18:00:00+09:00',
    );

    expect(due).toHaveLength(1);
    expect(due[0].steps[0].id).toBe(stepId);
  });

  it('skips a step that was already delivered', async () => {
    const { reminderId, stepId } = seedReminder(db, 'booking-reminder', -360);
    seedFriendReminder(db, {
      id: 'fr-1',
      friendId: 'f1',
      reminderId,
      targetDate: '2026-04-20T00:00:00+09:00',
    });
    // Mark the step as already delivered
    db.tables.friend_reminder_deliveries.push({
      id: 'del-1',
      friend_reminder_id: 'fr-1',
      reminder_step_id: stepId,
      delivered_at: '2026-04-19T18:01:00+09:00',
    });

    const due = await getDueReminderDeliveries(
      db as unknown as D1Database,
      '2026-04-19T19:00:00+09:00',
    );

    expect(due).toHaveLength(0);
  });

  it('skips reminders whose master is_active = 0', async () => {
    const { reminderId } = seedReminder(db, 'inactive-reminder', -360);
    db.tables.reminders[0].is_active = 0; // deactivate the master
    seedFriendReminder(db, {
      friendId: 'f1',
      reminderId,
      targetDate: '2026-04-20T00:00:00+09:00',
    });

    const due = await getDueReminderDeliveries(
      db as unknown as D1Database,
      '2026-04-19T19:00:00+09:00',
    );

    expect(due).toHaveLength(0);
  });

  it('skips cancelled friend_reminders', async () => {
    const { reminderId } = seedReminder(db, 'booking-reminder', -360);
    seedFriendReminder(db, {
      friendId: 'f1',
      reminderId,
      targetDate: '2026-04-20T00:00:00+09:00',
      status: 'cancelled',
    });

    const due = await getDueReminderDeliveries(
      db as unknown as D1Database,
      '2026-04-19T19:00:00+09:00',
    );

    expect(due).toHaveLength(0);
  });

  it('handles multiple friends with independent delivery state', async () => {
    const { reminderId, stepId } = seedReminder(db, 'booking-reminder', -360);

    // friend-a: not yet delivered
    seedFriendReminder(db, {
      id: 'fr-a',
      friendId: 'friend-a',
      reminderId,
      targetDate: '2026-04-20T00:00:00+09:00',
    });
    // friend-b: already delivered
    seedFriendReminder(db, {
      id: 'fr-b',
      friendId: 'friend-b',
      reminderId,
      targetDate: '2026-04-20T00:00:00+09:00',
    });
    db.tables.friend_reminder_deliveries.push({
      id: 'del-b',
      friend_reminder_id: 'fr-b',
      reminder_step_id: stepId,
      delivered_at: '2026-04-19T18:01:00+09:00',
    });

    const due = await getDueReminderDeliveries(
      db as unknown as D1Database,
      '2026-04-19T19:00:00+09:00',
    );

    expect(due).toHaveLength(1);
    expect(due[0].friend_id).toBe('friend-a');
  });
});

// ---------------------------------------------------------------------------
// enrollFriendInReminder — registration data integrity
// ---------------------------------------------------------------------------

describe('enrollFriendInReminder', () => {
  it('inserts a row with the correct field values', async () => {
    const db = new FakeD1();
    const reminderId = 'rem-1';
    db.tables.reminders.push({
      id: reminderId,
      name: 'test',
      description: null,
      is_active: 1,
      created_at: '2026-01-01T00:00:00+09:00',
      updated_at: '2026-01-01T00:00:00+09:00',
    });

    const row = await enrollFriendInReminder(db as unknown as D1Database, {
      friendId: 'friend-1',
      reminderId,
      targetDate: '2026-04-20T00:00:00+09:00',
      bookingId: 'booking-abc',
    });

    expect(row.friend_id).toBe('friend-1');
    expect(row.reminder_id).toBe(reminderId);
    expect(row.target_date).toBe('2026-04-20T00:00:00+09:00');
    expect(row.booking_id).toBe('booking-abc');
    expect(row.status).toBe('active');
    expect(typeof row.id).toBe('string');
    expect(row.id.length).toBeGreaterThan(0);
  });

  it('stores null booking_id when omitted', async () => {
    const db = new FakeD1();
    db.tables.reminders.push({
      id: 'rem-1',
      name: 'test',
      description: null,
      is_active: 1,
      created_at: '2026-01-01T00:00:00+09:00',
      updated_at: '2026-01-01T00:00:00+09:00',
    });

    const row = await enrollFriendInReminder(db as unknown as D1Database, {
      friendId: 'friend-2',
      reminderId: 'rem-1',
      targetDate: '2026-04-21T00:00:00+09:00',
    });

    expect(row.booking_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getReminderSteps — offset ordering
// ---------------------------------------------------------------------------

describe('getReminderSteps', () => {
  it('returns steps sorted by offset_minutes ascending', async () => {
    const db = new FakeD1();
    const reminderId = 'rem-1';
    const now = '2026-01-01T00:00:00+09:00';
    db.tables.reminders.push({ id: reminderId, name: 'r', description: null, is_active: 1, created_at: now, updated_at: now });
    // Insert steps out of order
    db.tables.reminder_steps.push({ id: 's3', reminder_id: reminderId, offset_minutes: 0, message_type: 'text', message_content: 'c', created_at: now });
    db.tables.reminder_steps.push({ id: 's1', reminder_id: reminderId, offset_minutes: -1440, message_type: 'text', message_content: 'c', created_at: now });
    db.tables.reminder_steps.push({ id: 's2', reminder_id: reminderId, offset_minutes: -360, message_type: 'text', message_content: 'c', created_at: now });

    const steps = await getReminderSteps(db as unknown as D1Database, reminderId);

    expect(steps.map((s) => s.offset_minutes)).toEqual([-1440, -360, 0]);
  });
});
