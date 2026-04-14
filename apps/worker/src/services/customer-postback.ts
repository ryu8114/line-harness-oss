/**
 * 顧客向けリッチメニューの postback ハンドラ
 *
 * action=customer_shop_info: 店舗情報をFlexで返す
 */

import { getLineAccountById } from '@line-crm/db';
import { LineClient, flexBubble, flexBox, flexText } from '@line-crm/line-sdk';

export async function handleCustomerPostback(
  db: D1Database,
  lineClient: LineClient,
  replyToken: string,
  postbackData: string,
  lineAccountId: string,
): Promise<void> {
  const params = new URLSearchParams(postbackData);
  const action = params.get('action');

  switch (action) {
    case 'customer_shop_info':
      await replyShopInfo(db, lineClient, replyToken, lineAccountId);
      break;
    default:
      console.warn(`Unknown customer postback action: ${action}`);
  }
}

async function replyShopInfo(
  db: D1Database,
  lineClient: LineClient,
  replyToken: string,
  lineAccountId: string,
): Promise<void> {
  const account = await getLineAccountById(db, lineAccountId);

  if (!account?.shop_info) {
    await lineClient.replyMessage(replyToken, [
      { type: 'text', text: '店舗情報が登録されていません。' },
    ]);
    return;
  }

  let info: { address?: string; phone?: string; hours?: string; mapUrl?: string };
  try {
    info = JSON.parse(account.shop_info);
  } catch {
    await lineClient.replyMessage(replyToken, [
      { type: 'text', text: '店舗情報の読み込みに失敗しました。' },
    ]);
    return;
  }

  // 本文ブロックの行を組み立て
  const bodyContents = [];

  if (info.address) {
    bodyContents.push(
      flexBox('horizontal', [
        flexText('住所', { color: '#888888', size: 'sm', flex: 2 }),
        flexText(info.address, { size: 'sm', flex: 5, wrap: true }),
      ]),
    );
  }
  if (info.phone) {
    bodyContents.push(
      flexBox('horizontal', [
        flexText('電話', { color: '#888888', size: 'sm', flex: 2 }),
        flexText(info.phone, { size: 'sm', flex: 5 }),
      ]),
    );
  }
  if (info.hours) {
    bodyContents.push(
      flexBox('horizontal', [
        flexText('営業時間', { color: '#888888', size: 'sm', flex: 2 }),
        flexText(info.hours, { size: 'sm', flex: 5, wrap: true }),
      ]),
    );
  }

  // フッターボタン
  const footerContents: ReturnType<typeof flexBox>[] = [];
  if (info.mapUrl) {
    footerContents.push(
      flexBox('vertical', [
        {
          type: 'button',
          action: { type: 'uri', uri: info.mapUrl, label: '地図を見る' },
          style: 'primary',
          color: '#00b900',
          height: 'sm',
        } as never,
      ]),
    );
  }
  if (info.phone) {
    footerContents.push(
      flexBox('vertical', [
        {
          type: 'button',
          action: { type: 'uri', uri: `tel:${info.phone.replace(/[-\s]/g, '')}`, label: '電話をかける' },
          style: 'secondary',
          height: 'sm',
        } as never,
      ]),
    );
  }

  const bubble = flexBubble({
    header: flexBox('vertical', [
      flexText(account.name, { weight: 'bold', size: 'lg' }),
    ]),
    body: flexBox('vertical', bodyContents, { spacing: 'md' }),
    footer: footerContents.length > 0 ? flexBox('vertical', footerContents, { spacing: 'sm' }) : undefined,
  });

  await lineClient.replyMessage(replyToken, [
    { type: 'flex', altText: `${account.name} 店舗情報`, contents: bubble },
  ]);
}
