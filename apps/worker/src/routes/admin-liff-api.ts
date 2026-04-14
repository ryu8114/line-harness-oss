/**
 * 管理者LIFF向けAPI
 *
 * 認証:
 *   - /api/admin-liff/* → staff API key (system_admin or clinic_admin のみ)
 *   - /api/public/admin-liff/* → LIFF IDトークン検証 + admin_line_user_id 一致チェック
 */

import { Hono } from 'hono';
import {
  getLineAccounts,
  getLineAccountById,
  getBookingsByAccount,
  getBookingById,
  updateLineAccount,
  createAdminLinkToken,
  findValidAdminLinkToken,
  consumeAdminLinkToken,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { requireRole } from '../middleware/role-guard.js';
import { resolveLineAccountId } from '../middleware/tenant.js';
import type { Env } from '../index.js';

const adminLiffApi = new Hono<Env>();

// ---- IDトークン検証 + admin_line_user_id チェック ----------------------------

/**
 * LIFF IDトークンを検証して { lineUserId, lineAccountId } を返す。
 *
 * line_account_id が指定されている場合はそのアカウントの login_channel_id でのみ検証し、
 * admin_line_user_id === sub かつ booking_enabled をチェックする。
 * 未指定の場合は全アカウント走査にフォールバック（後方互換）。
 */
async function verifyAdminLiffToken(
  db: D1Database,
  idToken: string,
  envLoginChannelId: string,
  targetLineAccountId?: string | null,
): Promise<{ lineUserId: string; lineAccountId: string } | null> {
  const accounts = await getLineAccounts(db);

  // --- ターゲットアカウント指定あり ---
  if (targetLineAccountId) {
    const account = accounts.find(a => a.id === targetLineAccountId);
    if (!account || !account.booking_enabled) return null;

    const channelId = account.login_channel_id ?? envLoginChannelId;
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (!res.ok) return null;
    const data = await res.json<{ sub: string }>();
    if (account.admin_line_user_id !== data.sub) return null;
    return { lineUserId: data.sub, lineAccountId: account.id };
  }

  // --- 全アカウント走査（後方互換）---
  const loginChannelIds = [envLoginChannelId];
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

  const matchingAccount = accounts.find(
    (a) => a.admin_line_user_id === lineUserId && a.booking_enabled,
  );
  if (!matchingAccount) return null;

  return { lineUserId, lineAccountId: matchingAccount.id };
}

/** env.LIFF_URL（"https://liff.line.me/{id}"）から LIFF ID を抽出する */
function extractLiffId(liffUrl: string): string {
  // "https://liff.line.me/1234567890-abcdefgh" → "1234567890-abcdefgh"
  return liffUrl.replace(/^https:\/\/liff\.line\.me\//, '');
}

// ---- POST /api/admin-liff/link-token （認証必要）-----------------------------

adminLiffApi.post(
  '/api/admin-liff/link-token',
  requireRole('system_admin', 'clinic_admin'),
  async (c) => {
    const staff = c.get('staff');
    const db = c.env.DB;

    // lineAccountId 決定
    let lineAccountId: string | null = null;
    if (staff.role === 'system_admin') {
      const body = await c.req.json<{ lineAccountId?: string }>().catch(() => ({ lineAccountId: undefined }));
      lineAccountId = body.lineAccountId ?? null;
      if (!lineAccountId) {
        return c.json({ success: false, error: 'system_admin は lineAccountId が必要です' }, 400);
      }
    } else {
      // clinic_admin: 自院固定
      lineAccountId = staff.lineAccountId ?? resolveLineAccountId(c);
      if (!lineAccountId) {
        return c.json({ success: false, error: '院が未割り当てです' }, 400);
      }
    }

    const account = await getLineAccountById(db, lineAccountId);
    if (!account) return c.json({ success: false, error: 'アカウントが見つかりません' }, 404);
    if (!account.booking_enabled) {
      return c.json({ success: false, error: 'このアカウントは予約機能が有効ではありません' }, 400);
    }

    const linkToken = await createAdminLinkToken(db, lineAccountId);

    // LIFF ID 解決: liff_id_admin → liff_id → env.LIFF_URL から抽出
    const liffId =
      account.liff_id_admin ??
      account.liff_id ??
      extractLiffId(c.env.LIFF_URL);
    const liffUrl = `https://liff.line.me/${liffId}?liffId=${liffId}&page=admin-link&token=${linkToken.token}`;

    return c.json({
      success: true,
      data: {
        token: linkToken.token,
        liffUrl,
        expiresAt: linkToken.expires_at,
      },
    });
  },
);

// ---- POST /api/public/admin-liff/link （公開・LIFFから呼ばれる）--------------

adminLiffApi.post('/api/public/admin-liff/link', async (c) => {
  const idToken = c.req.header('X-LIFF-ID-Token');
  if (!idToken) return c.json({ success: false, error: 'X-LIFF-ID-Token is required' }, 401);

  const body = await c.req.json<{ token?: string }>().catch(() => ({ token: undefined }));
  const token = body.token;
  if (!token) return c.json({ success: false, error: 'token is required' }, 400);

  const db = c.env.DB;

  // 1. トークン検索（消費しない）
  const linkToken = await findValidAdminLinkToken(db, token);
  if (!linkToken) return c.json({ success: false, error: 'リンクが無効または期限切れです' }, 401);

  // 2. アカウント取得 + booking_enabled チェック
  const account = await getLineAccountById(db, linkToken.line_account_id);
  if (!account || !account.booking_enabled) {
    return c.json({ success: false, error: 'アカウントが無効です' }, 401);
  }

  // 3. そのアカウントの login_channel_id で ID トークン検証
  const channelId = account.login_channel_id ?? c.env.LINE_LOGIN_CHANNEL_ID;
  const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  if (!verifyRes.ok) return c.json({ success: false, error: '認証に失敗しました' }, 401);
  const { sub: lineUserId } = await verifyRes.json<{ sub: string }>();

  // 4. トークンをアトミックに消費
  const consumed = await consumeAdminLinkToken(db, token);
  if (!consumed) return c.json({ success: false, error: 'リンクが既に使用されています' }, 409);

  // 5. admin_line_user_id を保存
  await updateLineAccount(db, account.id, { admin_line_user_id: lineUserId });

  // 6. リッチメニューを適用（best-effort: 友達追加前だと LINE API が拒否する可能性）
  if (account.admin_rich_menu_id) {
    try {
      const lineClient = new LineClient(account.channel_access_token);
      await lineClient.linkRichMenuToUser(lineUserId, account.admin_rich_menu_id);
    } catch (err) {
      console.warn('リッチメニュー適用スキップ（友達追加前の可能性）:', err);
    }
  }

  return c.json({ success: true, data: { message: 'LINE連携が完了しました' } });
});

// ---- GET /api/public/admin-liff/today ----------------------------------------

adminLiffApi.get('/api/public/admin-liff/today', async (c) => {
  const idToken = c.req.header('X-LIFF-ID-Token');
  if (!idToken) return c.json({ success: false, error: 'X-LIFF-ID-Token is required' }, 401);

  const targetLineAccountId = c.req.query('line_account_id') ?? null;
  const auth = await verifyAdminLiffToken(
    c.env.DB,
    idToken,
    c.env.LINE_LOGIN_CHANNEL_ID,
    targetLineAccountId,
  );
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

// ---- GET /api/public/admin-liff/bookings/:id ---------------------------------

adminLiffApi.get('/api/public/admin-liff/bookings/:id', async (c) => {
  const idToken = c.req.header('X-LIFF-ID-Token');
  if (!idToken) return c.json({ success: false, error: 'X-LIFF-ID-Token is required' }, 401);

  const targetLineAccountId = c.req.query('line_account_id') ?? null;
  const auth = await verifyAdminLiffToken(
    c.env.DB,
    idToken,
    c.env.LINE_LOGIN_CHANNEL_ID,
    targetLineAccountId,
  );
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
