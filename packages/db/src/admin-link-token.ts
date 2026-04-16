import { jstNow, toJstString } from './utils.js';

export interface AdminLinkToken {
  id: string;
  line_account_id: string;
  token: string;
  used_at: string | null;
  expires_at: string;
  created_at: string;
}

/** ワンタイムリンクトークンを生成する（有効期限 24 時間）*/
export async function createAdminLinkToken(
  db: D1Database,
  lineAccountId: string,
): Promise<AdminLinkToken> {
  const id = crypto.randomUUID();
  const now = jstNow();

  // セキュアなランダムトークン（128bit hex）
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

  // 24時間後（JST）: toJstString で正しく JST オフセット付きに変換
  const expiresAt = toJstString(new Date(Date.now() + 24 * 60 * 60 * 1000));

  await db
    .prepare(
      `INSERT INTO admin_link_tokens (id, line_account_id, token, used_at, expires_at, created_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    )
    .bind(id, lineAccountId, token, expiresAt, now)
    .run();

  return (await db
    .prepare('SELECT * FROM admin_link_tokens WHERE id = ?')
    .bind(id)
    .first<AdminLinkToken>())!;
}

/**
 * 有効なトークンを検索する（消費しない）。
 * 無効（期限切れ・使用済み）なら null を返す。
 */
export async function findValidAdminLinkToken(
  db: D1Database,
  token: string,
): Promise<AdminLinkToken | null> {
  const now = jstNow();
  return db
    .prepare(
      `SELECT * FROM admin_link_tokens
       WHERE token = ? AND used_at IS NULL AND expires_at > ?`,
    )
    .bind(token, now)
    .first<AdminLinkToken>();
}

/**
 * トークンをアトミックに消費する。
 * 同時リクエストや期限切れで changes=0 の場合は false を返す。
 */
export async function consumeAdminLinkToken(
  db: D1Database,
  token: string,
): Promise<boolean> {
  const now = jstNow();
  const result = await db
    .prepare(
      `UPDATE admin_link_tokens SET used_at = ?
       WHERE token = ? AND used_at IS NULL AND expires_at > ?`,
    )
    .bind(now, token, now)
    .run();
  return result.meta.changes > 0;
}
