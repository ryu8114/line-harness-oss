/// <reference types="@cloudflare/workers-types" />
/**
 * Minimal in-memory D1 stub for unit tests.
 * Handles only the SQL patterns emitted by the reminder helpers used in
 * booking-notifications.ts.  Throws on any unrecognised query.
 *
 * KEEP IN SYNC WITH packages/db/tests/fake-d1.ts — both copies must handle
 * the same SQL strings.  If you change a query in packages/db/src/reminders.ts,
 * update both fakes.
 */

type Row = Record<string, unknown>;

interface Tables {
  reminders: Row[];
  reminder_steps: Row[];
  friend_reminders: Row[];
  friend_reminder_deliveries: Row[];
  calendar_bookings: Row[];
  friends: Row[];
  messages_log: Row[];
}

function norm(sql: string): string {
  return sql.trim().replace(/\s+/g, ' ');
}

class FakeStatement implements D1PreparedStatement {
  private args: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly tables: Tables,
  ) {}

  bind(...args: unknown[]): D1PreparedStatement {
    this.args = args;
    return this;
  }

  async all<T = Row>(): Promise<D1Result<T>> {
    return { results: this.execute() as T[], success: true, meta: {} };
  }

  async first<T = Row>(colName?: string): Promise<T | null> {
    const rows = this.execute();
    if (colName !== undefined) {
      return rows.length > 0 ? ((rows[0] as Row)[colName] as T) : null;
    }
    return (rows[0] as T) ?? null;
  }

  async run<T = Row>(): Promise<D1Result<T>> {
    this.execute();
    return { results: [], success: true, meta: {} };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    return this.execute() as T[];
  }

  private execute(): Row[] {
    const sql = norm(this.sql);
    const a = this.args;
    const t = this.tables;

    if (sql === 'SELECT * FROM reminders ORDER BY created_at DESC') {
      return [...t.reminders].sort((x, y) =>
        String(y.created_at).localeCompare(String(x.created_at)),
      );
    }
    if (sql === 'SELECT * FROM reminders WHERE id = ?') {
      return t.reminders.filter((r) => r.id === a[0]);
    }
    if (
      sql ===
      'INSERT INTO reminders (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ) {
      t.reminders.push({ id: a[0], name: a[1], description: a[2], is_active: 1, created_at: a[3], updated_at: a[4] });
      return [];
    }
    if (sql === 'SELECT * FROM reminder_steps WHERE id = ?') {
      return t.reminder_steps.filter((s) => s.id === a[0]);
    }
    if (sql === 'SELECT * FROM reminder_steps WHERE reminder_id = ? ORDER BY offset_minutes ASC') {
      return [...t.reminder_steps]
        .filter((s) => s.reminder_id === a[0])
        .sort((x, y) => (x.offset_minutes as number) - (y.offset_minutes as number));
    }
    if (
      sql ===
      'INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ) {
      t.reminder_steps.push({ id: a[0], reminder_id: a[1], offset_minutes: a[2], message_type: a[3], message_content: a[4], created_at: a[5] });
      return [];
    }
    if (sql === 'SELECT * FROM friend_reminders WHERE id = ?') {
      return t.friend_reminders.filter((fr) => fr.id === a[0]);
    }
    if (
      sql ===
      'INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date, booking_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ) {
      t.friend_reminders.push({ id: a[0], friend_id: a[1], reminder_id: a[2], target_date: a[3], booking_id: a[4], status: 'active', created_at: a[5], updated_at: a[6] });
      return [];
    }
    if (sql.startsWith('SELECT fr.* FROM friend_reminders fr INNER JOIN reminders r')) {
      const activeIds = new Set(t.reminders.filter((r) => r.is_active === 1).map((r) => r.id as string));
      return t.friend_reminders.filter((fr) => fr.status === 'active' && activeIds.has(fr.reminder_id as string));
    }
    if (sql === 'SELECT reminder_step_id FROM friend_reminder_deliveries WHERE friend_reminder_id = ?') {
      return t.friend_reminder_deliveries.filter((d) => d.friend_reminder_id === a[0]);
    }
    if (sql === 'SELECT * FROM calendar_bookings WHERE id = ?') {
      return t.calendar_bookings.filter((b) => b.id === a[0]);
    }
    if (sql === 'SELECT * FROM friends WHERE id = ?') {
      return t.friends.filter((f) => f.id === a[0]);
    }
    if (sql.startsWith('INSERT INTO messages_log')) {
      t.messages_log.push({ id: a[0], friend_id: a[1], message_type: a[2], content: a[3], created_at: a[4] });
      return [];
    }
    if (sql === 'INSERT OR IGNORE INTO friend_reminder_deliveries (id, friend_reminder_id, reminder_step_id) VALUES (?, ?, ?)') {
      const exists = t.friend_reminder_deliveries.some(
        (d) => d.friend_reminder_id === a[1] && d.reminder_step_id === a[2],
      );
      if (!exists) t.friend_reminder_deliveries.push({ id: a[0], friend_reminder_id: a[1], reminder_step_id: a[2] });
      return [];
    }
    if (sql === 'SELECT COUNT(*) as count FROM reminder_steps WHERE reminder_id = ?') {
      return [{ count: t.reminder_steps.filter((s) => s.reminder_id === a[0]).length }];
    }
    if (sql === 'SELECT COUNT(*) as count FROM friend_reminder_deliveries WHERE friend_reminder_id = ?') {
      return [{ count: t.friend_reminder_deliveries.filter((d) => d.friend_reminder_id === a[0]).length }];
    }
    if (sql === "UPDATE friend_reminders SET status = 'completed', updated_at = ? WHERE id = ?") {
      const fr = t.friend_reminders.find((r) => r.id === a[1]);
      if (fr) fr.status = 'completed';
      return [];
    }

    throw new Error(`FakeD1: unhandled SQL:\n  ${sql}`);
  }
}

export class FakeD1 implements D1Database {
  readonly tables: Tables = {
    reminders: [],
    reminder_steps: [],
    friend_reminders: [],
    friend_reminder_deliveries: [],
    calendar_bookings: [],
    friends: [],
    messages_log: [],
  };

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(sql, this.tables);
  }

  async dump(): Promise<ArrayBuffer> { throw new Error('FakeD1: not implemented'); }
  async batch<T>(_s: D1PreparedStatement[]): Promise<D1Result<T>[]> { throw new Error('FakeD1: not implemented'); }
  async exec(_q: string): Promise<D1ExecResult> { throw new Error('FakeD1: not implemented'); }
}
