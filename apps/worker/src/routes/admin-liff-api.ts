/**
 * 管理者LIFF向けAPI
 *
 * 認証: LIFF IDトークン検証 + admin_line_user_id 一致チェック
 */

import { Hono } from 'hono';
import {
  getLineAccounts,
  getLineAccountById,
  getBookingsByAccount,
  getBookingById,
} from '@line-crm/db';
import type { Env } from '../index.js';

const adminLiffApi = new Hono<Env>();

// ---- IDトークン検証 + admin_line_user_id チェック --------------------------

async function verifyAdminLiffToken(
  db: D1Database,
  idToken: string,
  envLoginChannelId: string,
): Promise<{ lineUserId: string; lineAccountId: string } | null> {
  const loginChannelIds = [envLoginChannelId];
  const accounts = await getLineAccounts(db);
  for (const acct of accounts) {
    if (acct.login_channel_id) loginChannelIds.push(acct.login_channel_id);
  }

  let lineUserId: string | null = null;
  for (const channelId of loginChannelIds) {
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (res.ok) {
      const data = await res.json<{ sub: string }>();
      lineUserId = data.sub;
      break;
    }
  }
  if (!lineUserId) return null;

  // admin_line_user_id と照合
  const matchingAccount = accounts.find(
    (a) => a.admin_line_user_id === lineUserId && a.booking_enabled,
  );
  if (!matchingAccount) return null;

  return { lineUserId, lineAccountId: matchingAccount.id };
}

// ---- GET /api/public/admin-liff/today --------------------------------------

adminLiffApi.get('/api/public/admin-liff/today', async (c) => {
  const idToken = c.req.header('X-LIFF-ID-Token');
  if (!idToken) return c.json({ success: false, error: 'X-LIFF-ID-Token is required' }, 401);

  const auth = await verifyAdminLiffToken(c.env.DB, idToken, c.env.LINE_LOGIN_CHANNEL_ID);
  if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

  // 今日（JST）の日付を取得
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const today = jstNow.toISOString().slice(0, 10);
  const from = `${today}T00:00:00+09:00`;
  const to = `${today}T23:59:59+09:00`;

  const bookings = await getBookingsByAccount(c.env.DB, auth.lineAccountId, { from, to });

  return c.json({
    success: true,
    data: bookings.map((b) => ({
      id: b.id,
      startAt: b.start_at,
      endAt: b.end_at,
      status: b.status,
      menuName: b.menu_name_snapshot,
      menuDuration: b.menu_duration_snapshot,
      customerName: b.customer_name,
      customerPhone: b.customer_phone,
      customerNote: b.customer_note,
    })),
  });
});

// ---- GET /api/public/admin-liff/bookings/:id --------------------------------

adminLiffApi.get('/api/public/admin-liff/bookings/:id', async (c) => {
  const idToken = c.req.header('X-LIFF-ID-Token');
  if (!idToken) return c.json({ success: false, error: 'X-LIFF-ID-Token is required' }, 401);

  const auth = await verifyAdminLiffToken(c.env.DB, idToken, c.env.LINE_LOGIN_CHANNEL_ID);
  if (!auth) return c.json({ success: false, error: 'Unauthorized' }, 401);

  const booking = await getBookingById(c.env.DB, c.req.param('id'));
  if (!booking || booking.line_account_id !== auth.lineAccountId) {
    return c.json({ success: false, error: 'Booking not found' }, 404);
  }

  return c.json({
    success: true,
    data: {
      id: booking.id,
      startAt: booking.start_at,
      endAt: booking.end_at,
      status: booking.status,
      menuName: booking.menu_name_snapshot,
      menuDuration: booking.menu_duration_snapshot,
      menuPrice: booking.menu_price_snapshot,
      customerName: booking.customer_name,
      customerPhone: booking.customer_phone,
      customerNote: booking.customer_note,
      createdAt: booking.created_at,
    },
  });
});

export { adminLiffApi };
