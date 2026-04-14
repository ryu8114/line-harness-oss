import { jstNow } from './utils.js';
// =============================================================================
// LINE Accounts — Multi-Account Management
// =============================================================================

export interface LineAccount {
  id: string;
  channel_id: string;
  name: string;
  channel_access_token: string;
  channel_secret: string;
  login_channel_id: string | null;
  login_channel_secret: string | null;
  liff_id: string | null;
  is_active: number;
  token_expires_at: string | null;
  // Booking system columns (018_booking_system)
  admin_line_user_id: string | null;
  liff_id_admin: string | null;
  google_calendar_connection_id: string | null;
  booking_enabled: number;
  min_booking_hours: number;
  max_booking_days: number;
  slot_unit: number;
  plan: string;
  // Admin rich menu (023_admin_rich_menu)
  admin_rich_menu_id: string | null;
  // Customer booking (024_customer_booking)
  cancel_deadline_hours: number;
  shop_info: string | null;
  customer_rich_menu_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateLineAccountInput {
  channelId: string;
  name: string;
  channelAccessToken: string;
  channelSecret: string;
}

export async function createLineAccount(
  db: D1Database,
  input: CreateLineAccountInput,
): Promise<LineAccount> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, input.channelId, input.name, input.channelAccessToken, input.channelSecret, now, now)
    .run();

  return (await getLineAccountById(db, id))!;
}

export async function getLineAccountById(
  db: D1Database,
  id: string,
): Promise<LineAccount | null> {
  return db
    .prepare(`SELECT * FROM line_accounts WHERE id = ?`)
    .bind(id)
    .first<LineAccount>();
}

export async function getLineAccounts(db: D1Database): Promise<LineAccount[]> {
  const result = await db
    .prepare(`SELECT * FROM line_accounts ORDER BY created_at DESC`)
    .all<LineAccount>();
  return result.results;
}

export async function getLineAccountByChannelId(
  db: D1Database,
  channelId: string,
): Promise<LineAccount | null> {
  return db
    .prepare(`SELECT * FROM line_accounts WHERE channel_id = ?`)
    .bind(channelId)
    .first<LineAccount>();
}

export type UpdateLineAccountInput = Partial<
  Pick<LineAccount, 'name' | 'channel_access_token' | 'channel_secret' | 'is_active' | 'token_expires_at' | 'admin_line_user_id' | 'admin_rich_menu_id' | 'cancel_deadline_hours' | 'shop_info' | 'customer_rich_menu_id'>
>;

export async function updateLineAccount(
  db: D1Database,
  id: string,
  updates: UpdateLineAccountInput,
): Promise<LineAccount | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.channel_access_token !== undefined) {
    fields.push('channel_access_token = ?');
    values.push(updates.channel_access_token);
  }
  if (updates.channel_secret !== undefined) {
    fields.push('channel_secret = ?');
    values.push(updates.channel_secret);
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.is_active);
  }
  if (updates.token_expires_at !== undefined) {
    fields.push('token_expires_at = ?');
    values.push(updates.token_expires_at);
  }
  if (updates.admin_line_user_id !== undefined) {
    fields.push('admin_line_user_id = ?');
    values.push(updates.admin_line_user_id);
  }
  if (updates.admin_rich_menu_id !== undefined) {
    fields.push('admin_rich_menu_id = ?');
    values.push(updates.admin_rich_menu_id);
  }
  if (updates.cancel_deadline_hours !== undefined) {
    fields.push('cancel_deadline_hours = ?');
    values.push(updates.cancel_deadline_hours);
  }
  if (updates.shop_info !== undefined) {
    fields.push('shop_info = ?');
    values.push(updates.shop_info);
  }
  if (updates.customer_rich_menu_id !== undefined) {
    fields.push('customer_rich_menu_id = ?');
    values.push(updates.customer_rich_menu_id);
  }

  if (fields.length === 0) return getLineAccountById(db, id);

  fields.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);

  await db
    .prepare(`UPDATE line_accounts SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getLineAccountById(db, id);
}

export async function deleteLineAccount(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare(`DELETE FROM line_accounts WHERE id = ?`).bind(id).run();
}
