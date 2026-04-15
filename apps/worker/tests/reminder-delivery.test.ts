/// <reference types="@cloudflare/workers-types" />
/**
 * Tests for reminder-delivery.ts
 *
 * Covers:
 *  - buildBookingReminderText: correct format with and without menu name
 *  - processReminderDeliveries:
 *      · dynamic text (booking_id present) is sent via pushMessage
 *      · static fallback text (no booking_id) is sent unchanged
 *      · unfollowed friend is skipped
 *      · friend_reminders status → 'completed' after all steps delivered
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/event-bus.js', () => ({ fireEvent: vi.fn() }));
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn(() => ({ pushMessage: vi.fn() })),
}));
vi.mock('../src/services/stealth.js', () => ({
  addJitter: vi.fn(() => 0),
  sleep: vi.fn(() => Promise.resolve()),
}));

import {
  buildBookingReminderText,
  processReminderDeliveries,
} from '../src/services/reminder-delivery.js';
import { FakeD1 } from './fake-d1.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedScenario(db: FakeD1, opts: {
  bookingId?: string;
  friendFollowing?: boolean;
  menuName?: string;
} = {}) {
  const {
    bookingId = 'bk-1',
    friendFollowing = true,
    menuName = 'テスト施術',
  } = opts;

  const reminderId = 'rem-1';
  const stepId = 'step-1';
  const frId = 'fr-1';
  const friendId = 'friend-1';
  const now = '2026-01-01T00:00:00+09:00';

  db.tables.reminders.push({
    id: reminderId, name: '予約前日リマインド_account-1',
    description: null, is_active: 1, created_at: now, updated_at: now,
  });
  db.tables.reminder_steps.push({
    id: stepId, reminder_id: reminderId, offset_minutes: -360,
    message_type: 'text',
    message_content: '【明日のご予約リマインド】\nお気をつけてお越しください。',
    created_at: now,
  });
  // target_date = 2026-04-16 00:00 JST → trigger = 2026-04-15 18:00 JST
  db.tables.friend_reminders.push({
    id: frId, friend_id: friendId, reminder_id: reminderId,
    target_date: '2026-04-16T00:00:00+09:00',
    booking_id: bookingId,
    status: 'active', created_at: now, updated_at: now,
  });
  db.tables.friends.push({
    id: friendId, line_user_id: 'Uabc123',
    is_following: friendFollowing ? 1 : 0,
    line_account_id: 'account-1', created_at: now, updated_at: now,
  });

  if (bookingId) {
    db.tables.calendar_bookings.push({
      id: bookingId,
      start_at: '2026-04-16T10:00:00+09:00',
      end_at: '2026-04-16T11:00:00+09:00',
      menu_name_snapshot: menuName,
      status: 'confirmed',
    });
  }

  return { reminderId, stepId, frId, friendId };
}

// ---------------------------------------------------------------------------
// buildBookingReminderText — pure unit tests
// ---------------------------------------------------------------------------

describe('buildBookingReminderText', () => {
  it('includes date, time range, menu name, and closing text', () => {
    const text = buildBookingReminderText(
      '2026-04-16T10:00:00+09:00',
      '2026-04-16T11:00:00+09:00',
      'テスト整体',
    );
    expect(text).toBe(
      '【明日のご予約リマインド】\n2026年4月16日(木)\n10:00〜11:00\nテスト整体\n\nご予約ありがとうございます。\nお気をつけてお越しください。',
    );
  });

  it('omits menu line when menu name is null', () => {
    const text = buildBookingReminderText(
      '2026-04-16T10:00:00+09:00',
      '2026-04-16T11:00:00+09:00',
      null,
    );
    expect(text).not.toContain('\nnull');
    expect(text).toContain('10:00〜11:00');
    expect(text).toContain('ご予約ありがとうございます。');
    // No blank line before closing when menu is absent — just verify no "null" appears
    const lines = text.split('\n');
    expect(lines).not.toContain('null');
  });

  it('matches the target format from the requirements exactly', () => {
    // Target: '【明日のご予約リマインド】\n2026年4月16日(木)\n10:00〜11:00\nテスト整体\n\nご予約ありがとうございます。\nお気をつけてお越しください。'
    const result = buildBookingReminderText(
      '2026-04-16T10:00:00+09:00',
      '2026-04-16T11:00:00+09:00',
      'テスト整体',
    );
    const lines = result.split('\n');
    expect(lines[0]).toBe('【明日のご予約リマインド】');
    expect(lines[1]).toBe('2026年4月16日(木)');
    expect(lines[2]).toBe('10:00〜11:00');
    expect(lines[3]).toBe('テスト整体');
    expect(lines[4]).toBe('');
    expect(lines[5]).toBe('ご予約ありがとうございます。');
    expect(lines[6]).toBe('お気をつけてお越しください。');
  });
});

// ---------------------------------------------------------------------------
// processReminderDeliveries — integration tests
// ---------------------------------------------------------------------------

describe('processReminderDeliveries', () => {
  let db: FakeD1;
  let pushMessage: ReturnType<typeof vi.fn>;
  let lineClient: { pushMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    db = new FakeD1();
    pushMessage = vi.fn().mockResolvedValue(undefined);
    lineClient = { pushMessage };
  });

  it('sends dynamic booking details when booking_id is present', async () => {
    seedScenario(db);

    await processReminderDeliveries(db as unknown as D1Database, lineClient as never);

    expect(pushMessage).toHaveBeenCalledOnce();
    const [, messages] = pushMessage.mock.calls[0] as [string, Array<{ type: string; text?: string }>];
    expect(messages[0].type).toBe('text');
    const text = messages[0].text ?? '';
    expect(text).toContain('2026年4月16日(木)');
    expect(text).toContain('10:00〜11:00');
    expect(text).toContain('テスト施術');
    expect(text).toContain('ご予約ありがとうございます。');
    expect(text).toContain('お気をつけてお越しください。');
    // Must NOT be the old static-only text
    expect(text).not.toBe('【明日のご予約リマインド】\nお気をつけてお越しください。');
  });

  it('falls back to static message_content when booking_id is null', async () => {
    seedScenario(db, { bookingId: undefined });
    // Override the friend_reminder to have null booking_id
    db.tables.friend_reminders[0].booking_id = null;

    await processReminderDeliveries(db as unknown as D1Database, lineClient as never);

    expect(pushMessage).toHaveBeenCalledOnce();
    const [, messages] = pushMessage.mock.calls[0] as [string, Array<{ type: string; text?: string }>];
    expect(messages[0].text).toBe('【明日のご予約リマインド】\nお気をつけてお越しください。');
  });

  it('falls back to static message_content when booking_id is set but booking is not found', async () => {
    seedScenario(db);
    // Remove the booking record to simulate a deleted booking
    db.tables.calendar_bookings.length = 0;

    await processReminderDeliveries(db as unknown as D1Database, lineClient as never);

    expect(pushMessage).toHaveBeenCalledOnce();
    const [, messages] = pushMessage.mock.calls[0] as [string, Array<{ type: string; text?: string }>];
    expect(messages[0].text).toBe('【明日のご予約リマインド】\nお気をつけてお越しください。');
  });

  it('skips unfollowed friends without sending a message', async () => {
    seedScenario(db, { friendFollowing: false });

    await processReminderDeliveries(db as unknown as D1Database, lineClient as never);

    expect(pushMessage).not.toHaveBeenCalled();
  });

  it('marks friend_reminder as completed after delivery', async () => {
    const { frId } = seedScenario(db);

    await processReminderDeliveries(db as unknown as D1Database, lineClient as never);

    const fr = db.tables.friend_reminders.find((r) => r.id === frId);
    expect(fr?.status).toBe('completed');
  });

  it('records the dynamic content (not template text) in messages_log', async () => {
    seedScenario(db);

    await processReminderDeliveries(db as unknown as D1Database, lineClient as never);

    expect(db.tables.messages_log).toHaveLength(1);
    const logged = db.tables.messages_log[0].content as string;
    expect(logged).toContain('2026年4月16日(木)');
    expect(logged).toContain('10:00〜11:00');
    expect(logged).toContain('テスト施術');
  });
});
