import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

type StaffContext = { id: string; name: string; role: 'owner' | 'admin' | 'staff'; lineAccountId: string | null };

/** query param の命名が route ごとに不統一なので1つのヘルパーで正規化する */
export function resolveLineAccountId(c: Context<Env>): string | null {
  const staff = c.get('staff');
  if (!staff) return null;
  // admin/staff は常に自院のIDを使う（ユーザー入力を信用しない）
  if (staff.role !== 'owner' && staff.lineAccountId) {
    return staff.lineAccountId;
  }
  // owner は query param から取得
  return (
    c.req.query('lineAccountId') ||
    c.req.query('line_account_id') ||
    c.req.query('accountId') ||
    null
  );
}

/** テナントスコープが必要なルートに適用するミドルウェア */
export async function requireTenant(c: Context<Env>, next: Next): Promise<Response | void> {
  // auth skip された公開ルートでは staff が未設定 → そのまま通過
  const staff = c.get('staff');
  if (!staff) return next();

  if (staff.role === 'owner') {
    c.set('resolvedLineAccountId', resolveLineAccountId(c));
    return next();
  }

  // admin/staff は lineAccountId 必須
  if (!staff.lineAccountId) {
    return c.json({ success: false, error: '院が未割り当てです。オーナーに連絡してください' }, 403);
  }

  // query param で別院を指定していたら拒否
  const queryId =
    c.req.query('lineAccountId') ||
    c.req.query('line_account_id') ||
    c.req.query('accountId');
  if (queryId && queryId !== staff.lineAccountId) {
    return c.json({ success: false, error: '他院のデータにはアクセスできません' }, 403);
  }

  c.set('resolvedLineAccountId', staff.lineAccountId);
  return next();
}

/** 単体リソースの所有権チェック */
export function checkOwnership(staff: StaffContext, recordLineAccountId: string | null): boolean {
  if (staff.role === 'owner') return true;
  // legacy NULL レコードは scoped user からアクセス不可
  if (recordLineAccountId === null) return false;
  return staff.lineAccountId === recordLineAccountId;
}
