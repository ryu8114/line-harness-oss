/**
 * LIFF Booking Page — 整体院予約システム
 *
 * Flow:
 * 1. メニュー選択
 * 2. カレンダーで日付選択
 * 3. 時間帯選択
 * 4. 顧客情報入力（名前・電話・症状メモ）
 * 5. 確認画面
 * 6. 予約完了
 */

declare const liff: {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(opts?: { redirectUri?: string }): void;
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getIDToken(): string | null;
  getDecodedIDToken(): { sub: string; name?: string; email?: string; picture?: string } | null;
  isInClient(): boolean;
  closeWindow(): void;
};

// LINE_ACCOUNT_ID は LIFF URLのクエリパラメータから取得
function getLineAccountId(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('line_account_id') || import.meta.env?.VITE_LINE_ACCOUNT_ID || '';
}

interface Menu {
  id: string;
  name: string;
  duration: number;
  price: number | null;
  description: string | null;
}

interface Slot {
  time: string;
  available: boolean;
}

type Page = 'menu' | 'calendar' | 'form' | 'confirm' | 'complete' | 'error';

interface BookingState {
  page: Page;
  menus: Menu[];
  selectedMenu: Menu | null;
  weekStartDate: string;
  gridSlots: Record<string, Slot[]>;
  selectedDate: string | null;
  selectedTime: string | null;
  profile: { userId: string; displayName: string } | null;
  idToken: string | null;
  // 顧客情報
  customerName: string;
  customerPhone: string;
  customerNote: string;
  loading: boolean;
  submitting: boolean;
  errorMessage: string;
}

function getTodayJst(): string {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const state: BookingState = {
  page: 'menu',
  menus: [],
  selectedMenu: null,
  weekStartDate: getTodayJst(),
  gridSlots: {},
  selectedDate: null,
  selectedTime: null,
  profile: null,
  idToken: null,
  customerName: '',
  customerPhone: '',
  customerNote: '',
  loading: false,
  submitting: false,
  errorMessage: '',
};

const LINE_ACCOUNT_ID = getLineAccountId();

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function apiCall(path: string, options?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
}

function formatTime(time: string): string {
  return time;
}

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatDateJa(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${weekdays[d.getDay()]})`;
}

function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

// ========== メニュー選択画面 ==========

function renderMenuPage(): string {
  if (state.loading) {
    return `<div class="booking-page"><div class="loading-spinner"></div><p>読み込み中...</p></div>`;
  }
  if (state.menus.length === 0) {
    return `<div class="booking-page"><div class="card"><p>メニューが登録されていません。</p></div></div>`;
  }

  const menuCards = state.menus.map((m) => `
    <div class="menu-card" data-menu-id="${escapeHtml(m.id)}">
      <div class="menu-name">${escapeHtml(m.name)}</div>
      <div class="menu-meta">
        <span class="menu-duration">${m.duration}分</span>
        ${m.price != null ? `<span class="menu-price">¥${m.price.toLocaleString()}</span>` : ''}
      </div>
      ${m.description ? `<div class="menu-desc">${escapeHtml(m.description)}</div>` : ''}
    </div>
  `).join('');

  return `
    <div class="booking-page">
      <div class="booking-header">
        <h1>メニュー選択</h1>
        <p>ご希望のメニューをお選びください</p>
      </div>
      <div class="menu-list">${menuCards}</div>
    </div>
  `;
}

// ========== 週間グリッド画面 ==========

function getWeekNavTitle(startDate: string): string {
  const end = addDays(startDate, 6);
  const s = new Date(`${startDate}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  const sy = s.getUTCFullYear(), sm = s.getUTCMonth() + 1;
  const ey = e.getUTCFullYear(), em = e.getUTCMonth() + 1;
  if (sy === ey && sm === em) return `${sy}年${sm}月`;
  if (sy === ey) return `${sy}年${sm}月〜${em}月`;
  return `${sy}年${sm}月〜${ey}年${em}月`;
}

function getAllTimeSlots(gridSlots: Record<string, Slot[]>): string[] {
  const timeSet = new Set<string>();
  for (const slots of Object.values(gridSlots)) {
    for (const s of slots) timeSet.add(s.time);
  }
  return [...timeSet].sort();
}

function renderGridPage(): string {
  const today = getTodayJst();
  const isPrevDisabled = state.weekStartDate <= today;
  const nextStart = addDays(state.weekStartDate, 7);
  // サーバー側の maxBookingDays=14 を超える週は空データになるので次ボタンは常時表示
  const isNextDisabled = nextStart > addDays(today, 14);

  // 週の7日分の日付を生成
  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) weekDates.push(addDays(state.weekStartDate, i));

  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

  // ヘッダー行
  const headerCells = weekDates.map((d) => {
    const dt = new Date(`${d}T12:00:00Z`);
    const dow = dt.getUTCDay();
    const dowCls = dow === 0 ? ' sun' : dow === 6 ? ' sat' : '';
    const todayCls = d === today ? ' today' : '';
    const dayNum = dt.getUTCDate();
    return `<th class="date-header${dowCls}${todayCls}">${dayNum}<br><span class="dow">(${weekdays[dow]})</span></th>`;
  }).join('');

  const navHtml = `
    <div class="week-nav">
      <button class="week-nav-btn" data-action="prev-week"${isPrevDisabled ? ' disabled' : ''}>◀ 前の週</button>
      <span class="week-nav-title">${getWeekNavTitle(state.weekStartDate)}</span>
      <button class="week-nav-btn" data-action="next-week"${isNextDisabled ? ' disabled' : ''}>次の週 ▶</button>
    </div>
  `;

  if (state.loading) {
    return `
      <div class="booking-page">
        <div class="booking-header">
          <button class="back-btn" data-action="back-to-menu">&lt; メニュー選択に戻る</button>
          <h2>${escapeHtml(state.selectedMenu?.name ?? '')}</h2>
        </div>
        <div class="week-grid-container">
          ${navHtml}
          <div class="week-grid-loading">
            <div class="loading-spinner"></div>
            <p>空き状況を確認中...</p>
          </div>
        </div>
      </div>
    `;
  }

  // 全時間帯の収集（グリッドの行を決める）
  const allTimes = getAllTimeSlots(state.gridSlots);

  let tableHtml = '';
  if (allTimes.length === 0) {
    tableHtml = `<div class="week-grid-empty"><p>この期間に空き枠がありません</p></div>`;
  } else {
    const bodyRows = allTimes.map((time) => {
      const cells = weekDates.map((d) => {
        const daySlots = state.gridSlots[d];
        if (!daySlots) {
          return `<td class="grid-cell no-slot"></td>`;
        }
        const slot = daySlots.find((s) => s.time === time);
        if (!slot) {
          return `<td class="grid-cell no-slot"></td>`;
        }
        if (slot.available) {
          return `<td class="grid-cell available" data-date="${d}" data-time="${time}">◎</td>`;
        }
        return `<td class="grid-cell unavailable">×</td>`;
      }).join('');
      return `<tr><td class="time-label">${time}</td>${cells}</tr>`;
    }).join('');

    tableHtml = `
      <div class="week-grid-scroll">
        <table class="week-grid">
          <thead>
            <tr>
              <th class="time-col-header"></th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    `;
  }

  return `
    <div class="booking-page">
      <div class="booking-header">
        <button class="back-btn" data-action="back-to-menu">&lt; メニュー選択に戻る</button>
        <h2>${escapeHtml(state.selectedMenu?.name ?? '')}</h2>
        <p>日時をタップして予約してください</p>
      </div>
      <div class="week-grid-container">
        ${navHtml}
        ${tableHtml}
      </div>
    </div>
  `;
}

// ========== 顧客情報入力画面 ==========

function renderFormPage(): string {
  return `
    <div class="booking-page">
      <div class="booking-header">
        <button class="back-btn" data-action="back-to-calendar">&lt; 日時選択に戻る</button>
        <h2>お客様情報の入力</h2>
      </div>
      <div class="form-section">
        <div class="form-summary">
          <p>${escapeHtml(state.selectedMenu?.name ?? '')} / ${state.selectedMenu?.duration}分</p>
          <p>${formatDateJa(state.selectedDate!)} ${state.selectedTime}</p>
        </div>
        <div class="form-group">
          <label for="customer-name">お名前 <span class="required">*</span></label>
          <input type="text" id="customer-name" placeholder="田中 太郎" value="${escapeHtml(state.customerName)}" />
        </div>
        <div class="form-group">
          <label for="customer-phone">電話番号</label>
          <input type="tel" id="customer-phone" placeholder="090-0000-0000" value="${escapeHtml(state.customerPhone)}" />
        </div>
        <div class="form-group">
          <label for="customer-note">症状・お悩み（任意）</label>
          <textarea id="customer-note" placeholder="腰痛がひどい、肩こりがひどい など" rows="3">${escapeHtml(state.customerNote)}</textarea>
        </div>
        <button class="next-btn" data-action="go-to-confirm">確認画面へ</button>
      </div>
    </div>
  `;
}

// ========== 確認画面 ==========

function renderConfirmPage(): string {
  const menu = state.selectedMenu!;
  return `
    <div class="booking-page">
      <div class="booking-header">
        <button class="back-btn" data-action="back-to-form">&lt; 入力に戻る</button>
        <h2>予約内容の確認</h2>
      </div>
      <div class="confirm-card">
        <div class="confirm-row"><span class="confirm-label">メニュー</span><span class="confirm-value">${escapeHtml(menu.name)}</span></div>
        <div class="confirm-row"><span class="confirm-label">時間</span><span class="confirm-value">${menu.duration}分</span></div>
        ${menu.price != null ? `<div class="confirm-row"><span class="confirm-label">料金</span><span class="confirm-value">¥${menu.price.toLocaleString()}</span></div>` : ''}
        <div class="confirm-row"><span class="confirm-label">日付</span><span class="confirm-value">${formatDateJa(state.selectedDate!)}</span></div>
        <div class="confirm-row"><span class="confirm-label">時間帯</span><span class="confirm-value">${state.selectedTime}〜${addMinutesToTime(state.selectedTime!, menu.duration)}</span></div>
        <div class="confirm-row"><span class="confirm-label">お名前</span><span class="confirm-value">${escapeHtml(state.customerName)}</span></div>
        ${state.customerPhone ? `<div class="confirm-row"><span class="confirm-label">電話番号</span><span class="confirm-value">${escapeHtml(state.customerPhone)}</span></div>` : ''}
        ${state.customerNote ? `<div class="confirm-row"><span class="confirm-label">症状・お悩み</span><span class="confirm-value">${escapeHtml(state.customerNote)}</span></div>` : ''}
        <button class="book-btn${state.submitting ? ' loading' : ''}" data-action="submit-booking" style="margin-top:20px;" ${state.submitting ? 'disabled' : ''}>
          ${state.submitting ? '送信中...' : '予約を確定する'}
        </button>
      </div>
    </div>
  `;
}

// ========== 完了画面 ==========

function renderCompletePage(): string {
  return `
    <div class="booking-page">
      <div class="success-card">
        <div class="success-icon">✓</div>
        <h2>予約が完了しました</h2>
        <div class="confirm-details">
          <div class="confirm-row"><span class="confirm-label">メニュー</span><span class="confirm-value">${escapeHtml(state.selectedMenu?.name ?? '')}</span></div>
          <div class="confirm-row"><span class="confirm-label">日時</span><span class="confirm-value">${formatDateJa(state.selectedDate!)} ${state.selectedTime}〜${addMinutesToTime(state.selectedTime!, state.selectedMenu?.duration ?? 0)}</span></div>
        </div>
        <p class="success-message">ご予約ありがとうございます。<br>LINEに確認メッセージをお送りしました。<br>当日のお越しをお待ちしております。</p>
        <button class="close-btn" data-action="close">閉じる</button>
      </div>
    </div>
  `;
}

function renderErrorPage(): string {
  return `
    <div class="booking-page">
      <div class="card">
        <h2 style="color:#e53e3e;">エラー</h2>
        <p>${escapeHtml(state.errorMessage)}</p>
        <button class="close-btn" data-action="retry">やり直す</button>
      </div>
    </div>
  `;
}

// ========== メインレンダリング ==========

function render(): void {
  const app = getApp();
  switch (state.page) {
    case 'menu': app.innerHTML = renderMenuPage(); break;
    case 'calendar': app.innerHTML = renderGridPage(); break;
    case 'form': app.innerHTML = renderFormPage(); break;
    case 'confirm': app.innerHTML = renderConfirmPage(); break;
    case 'complete': app.innerHTML = renderCompletePage(); break;
    case 'error': app.innerHTML = renderErrorPage(); break;
  }
  attachEvents();
}

// ========== イベントハンドラ ==========

function attachEvents(): void {
  const app = getApp();

  // メニュー選択
  app.querySelectorAll('.menu-card').forEach((card) => {
    card.addEventListener('click', () => {
      const menuId = (card as HTMLElement).dataset.menuId;
      const menu = state.menus.find((m) => m.id === menuId);
      if (menu) {
        state.selectedMenu = menu;
        state.selectedDate = null;
        state.selectedTime = null;
        state.weekStartDate = getTodayJst();
        state.gridSlots = {};
        state.page = 'calendar';
        fetchWeekSlots(state.weekStartDate);
      }
    });
  });

  // 週ナビ
  app.querySelector('[data-action="prev-week"]')?.addEventListener('click', () => {
    const prev = addDays(state.weekStartDate, -7);
    const today = getTodayJst();
    state.weekStartDate = prev < today ? today : prev;
    state.selectedDate = null;
    state.selectedTime = null;
    fetchWeekSlots(state.weekStartDate);
  });
  app.querySelector('[data-action="next-week"]')?.addEventListener('click', () => {
    state.weekStartDate = addDays(state.weekStartDate, 7);
    state.selectedDate = null;
    state.selectedTime = null;
    fetchWeekSlots(state.weekStartDate);
  });

  // グリッドセル（◎）タップ → 即フォームへ
  app.querySelectorAll('.grid-cell.available').forEach((cell) => {
    cell.addEventListener('click', () => {
      const el = cell as HTMLElement;
      state.selectedDate = el.dataset.date!;
      state.selectedTime = el.dataset.time!;
      state.page = 'form';
      render();
    });
  });

  // 確認画面へ
  app.querySelector('[data-action="go-to-confirm"]')?.addEventListener('click', () => {
    const name = (document.getElementById('customer-name') as HTMLInputElement)?.value.trim();
    if (!name) { alert('お名前を入力してください'); return; }
    state.customerName = name;
    state.customerPhone = (document.getElementById('customer-phone') as HTMLInputElement)?.value.trim() || '';
    state.customerNote = (document.getElementById('customer-note') as HTMLTextAreaElement)?.value.trim() || '';
    state.page = 'confirm';
    render();
  });

  // 予約送信
  app.querySelector('[data-action="submit-booking"]')?.addEventListener('click', () => submitBooking());

  // 戻るボタン
  app.querySelector('[data-action="back-to-menu"]')?.addEventListener('click', () => { state.page = 'menu'; render(); });
  app.querySelector('[data-action="back-to-calendar"]')?.addEventListener('click', () => {
    state.page = 'calendar';
    state.selectedDate = null;
    state.selectedTime = null;
    fetchWeekSlots(state.weekStartDate);
  });
  app.querySelector('[data-action="back-to-form"]')?.addEventListener('click', () => { state.page = 'form'; render(); });

  // 閉じる
  app.querySelector('[data-action="close"]')?.addEventListener('click', () => {
    if (liff.isInClient()) liff.closeWindow(); else window.close();
  });

  // やり直し
  app.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
    state.page = 'menu'; state.errorMessage = '';
    state.selectedMenu = null; state.selectedDate = null; state.selectedTime = null;
    render();
  });
}

// ========== API呼び出し ==========

async function fetchMenus(): Promise<void> {
  try {
    const res = await apiCall(`/api/public/menus?line_account_id=${encodeURIComponent(LINE_ACCOUNT_ID)}`);
    if (!res.ok) throw new Error('メニューの取得に失敗しました');
    const json = await res.json() as { success: boolean; data: Menu[] };
    state.menus = json.data;
  } catch (err) {
    console.error('fetchMenus error:', err);
    state.menus = [];
  } finally {
    state.loading = false;
    render();
  }
}

async function fetchWeekSlots(fromDate: string): Promise<void> {
  state.loading = true;
  state.gridSlots = {};
  render();
  try {
    const toDate = addDays(fromDate, 6);
    const params = new URLSearchParams({
      line_account_id: LINE_ACCOUNT_ID,
      menu_id: state.selectedMenu!.id,
      from: fromDate,
      to: toDate,
    });
    const res = await apiCall(`/api/public/slots?${params}`);
    if (!res.ok) throw new Error('空き状況の取得に失敗しました');
    const json = await res.json() as { success: boolean; data: Record<string, Slot[]> };
    state.gridSlots = json.data;
  } catch (err) {
    console.error('fetchWeekSlots error:', err);
    state.gridSlots = {};
  } finally {
    state.loading = false;
    render();
  }
}

async function submitBooking(): Promise<void> {
  if (state.submitting) return;
  state.submitting = true;
  render();

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (state.idToken) headers['X-LIFF-ID-Token'] = state.idToken;

    const res = await fetch('/api/public/bookings', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        lineAccountId: LINE_ACCOUNT_ID,
        menuId: state.selectedMenu!.id,
        date: state.selectedDate!,
        time: state.selectedTime!,
        customerName: state.customerName,
        customerPhone: state.customerPhone || undefined,
        customerNote: state.customerNote || undefined,
      }),
    });

    if (res.status === 409) {
      state.submitting = false;
      state.selectedDate = null;
      state.selectedTime = null;
      state.page = 'calendar';
      alert('この時間帯はすでに予約が入りました。別の時間を選択してください。');
      fetchWeekSlots(state.weekStartDate);
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(err?.error || '予約の送信に失敗しました');
    }

    state.page = 'complete';
    render();
  } catch (err) {
    state.submitting = false;
    state.errorMessage = err instanceof Error ? err.message : '予約に失敗しました';
    state.page = 'error';
    render();
  }
}

// ========== 初期化 ==========

export async function initBooking(): Promise<void> {
  const profile = await liff.getProfile();
  state.profile = { userId: profile.userId, displayName: profile.displayName };
  state.idToken = liff.getIDToken();

  // 氏名をLINEプロフィールから初期設定（書き換え可能）
  if (profile.displayName) state.customerName = profile.displayName;

  // メニューを取得
  state.loading = true;
  render();
  await fetchMenus();
}
