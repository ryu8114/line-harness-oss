/**
 * LIFF My Bookings Page — 予約確認・キャンセル・日時変更
 *
 * Flow:
 * 1. 一覧画面（今後の確定予約）
 * 2. 詳細画面（タップで遷移）
 * 3a. キャンセル確認画面 → 完了
 * 3b. 日時変更フロー（カレンダー → スロット → 確認 → 完了）
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

function getLineAccountId(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('line_account_id') || import.meta.env?.VITE_LINE_ACCOUNT_ID || '';
}

const LINE_ACCOUNT_ID = getLineAccountId();

interface Booking {
  id: string;
  startAt: string;
  endAt: string;
  menuId: string | null;
  menuName: string | null;
  menuDuration: number | null;
  menuPrice: number | null;
  customerNote: string | null;
}

interface Slot {
  time: string;
  available: boolean;
}

type Page =
  | 'list'
  | 'detail'
  | 'cancel-confirm'
  | 'cancel-complete'
  | 'reschedule-calendar'
  | 'reschedule-slots'
  | 'reschedule-confirm'
  | 'reschedule-complete'
  | 'error';

interface MyBookingsState {
  page: Page;
  idToken: string | null;
  bookings: Booking[];
  selectedBooking: Booking | null;
  // 日時変更用
  weekStartDate: string;
  gridSlots: Record<string, Slot[]>;
  selectedDate: string | null;
  selectedTime: string | null;
  // UI状態
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

const state: MyBookingsState = {
  page: 'list',
  idToken: null,
  bookings: [],
  selectedBooking: null,
  weekStartDate: getTodayJst(),
  gridSlots: {},
  selectedDate: null,
  selectedTime: null,
  loading: false,
  submitting: false,
  errorMessage: '',
};

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function apiCall(path: string, options?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (state.idToken) headers['X-LIFF-ID-Token'] = state.idToken;
  return fetch(path, { ...options, headers: { ...headers, ...options?.headers } });
}

function formatDateJa(isoString: string): string {
  const datePart = isoString.slice(0, 10);
  const [year, month, day] = datePart.split('-').map(Number);
  const d = new Date(`${datePart}T12:00:00Z`);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${year}年${month}月${day}日(${weekdays[d.getUTCDay()]})`;
}

function formatTime(isoString: string): string {
  return isoString.slice(11, 16);
}

function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

// ========== 一覧画面 ==========

function renderListPage(): string {
  if (state.loading) {
    return `<div class="booking-page"><div class="loading-spinner"></div><p>読み込み中...</p></div>`;
  }
  if (state.bookings.length === 0) {
    return `
      <div class="booking-page">
        <div class="booking-header"><h1>予約確認</h1></div>
        <div class="card" style="text-align:center;padding:32px 16px;">
          <p>現在ご予約はありません</p>
          <button class="next-btn" data-action="go-to-booking" style="margin-top:16px;">新しく予約する</button>
        </div>
      </div>
    `;
  }

  const items = state.bookings.map((b) => `
    <div class="menu-card" data-booking-id="${escapeHtml(b.id)}" style="cursor:pointer;">
      <div class="menu-name">${escapeHtml(b.menuName ?? '')}</div>
      <div class="menu-meta">
        <span>${formatDateJa(b.startAt)} ${formatTime(b.startAt)}〜${formatTime(b.endAt)}</span>
      </div>
      ${b.menuPrice != null ? `<div class="menu-desc">¥${b.menuPrice.toLocaleString()}</div>` : ''}
    </div>
  `).join('');

  return `
    <div class="booking-page">
      <div class="booking-header"><h1>予約確認</h1></div>
      <div class="menu-list">${items}</div>
    </div>
  `;
}

// ========== 詳細画面 ==========

function renderDetailPage(): string {
  const b = state.selectedBooking!;
  return `
    <div class="booking-page">
      <div class="booking-header">
        <button class="back-btn" data-action="back-to-list">&lt; 一覧に戻る</button>
        <h2>予約詳細</h2>
      </div>
      <div class="confirm-card">
        <div class="confirm-row"><span class="confirm-label">メニュー</span><span class="confirm-value">${escapeHtml(b.menuName ?? '')}</span></div>
        <div class="confirm-row"><span class="confirm-label">日時</span><span class="confirm-value">${formatDateJa(b.startAt)} ${formatTime(b.startAt)}〜${formatTime(b.endAt)}</span></div>
        ${b.menuDuration ? `<div class="confirm-row"><span class="confirm-label">所要時間</span><span class="confirm-value">${b.menuDuration}分</span></div>` : ''}
        ${b.menuPrice != null ? `<div class="confirm-row"><span class="confirm-label">料金</span><span class="confirm-value">¥${b.menuPrice.toLocaleString()}</span></div>` : ''}
        ${b.customerNote ? `<div class="confirm-row"><span class="confirm-label">備考</span><span class="confirm-value">${escapeHtml(b.customerNote)}</span></div>` : ''}
        <div style="margin-top:24px;display:flex;flex-direction:column;gap:12px;">
          <button class="next-btn" data-action="go-to-reschedule">日時を変更</button>
          <button class="outline-btn" data-action="go-to-cancel" style="color:#e53e3e;border-color:#e53e3e;">キャンセル</button>
        </div>
      </div>
    </div>
  `;
}

// ========== キャンセル確認画面 ==========

function renderCancelConfirmPage(): string {
  const b = state.selectedBooking!;
  return `
    <div class="booking-page">
      <div class="booking-header">
        <button class="back-btn" data-action="back-to-detail">&lt; 戻る</button>
        <h2>キャンセルの確認</h2>
      </div>
      <div class="confirm-card">
        <p style="margin-bottom:16px;">以下の予約をキャンセルしますか？</p>
        <div class="confirm-row"><span class="confirm-label">メニュー</span><span class="confirm-value">${escapeHtml(b.menuName ?? '')}</span></div>
        <div class="confirm-row"><span class="confirm-label">日時</span><span class="confirm-value">${formatDateJa(b.startAt)} ${formatTime(b.startAt)}〜${formatTime(b.endAt)}</span></div>
        <div style="margin-top:24px;display:flex;gap:12px;">
          <button class="outline-btn" data-action="back-to-detail" style="flex:1;">やめる</button>
          <button class="book-btn${state.submitting ? ' loading' : ''}" data-action="execute-cancel" style="flex:1;background:#e53e3e;border-color:#e53e3e;" ${state.submitting ? 'disabled' : ''}>
            ${state.submitting ? 'キャンセル中...' : 'キャンセル実行'}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ========== キャンセル完了画面 ==========

function renderCancelCompletePage(): string {
  return `
    <div class="booking-page">
      <div class="success-card">
        <div class="success-icon">✓</div>
        <h2>キャンセルを受け付けました</h2>
        <p class="success-message">ご利用ありがとうございました。<br>またのご利用をお待ちしております。</p>
        <button class="close-btn" data-action="back-to-list">予約一覧に戻る</button>
      </div>
    </div>
  `;
}

// ========== 日時変更: 週グリッド画面 ==========

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

function renderRescheduleGridPage(): string {
  const b = state.selectedBooking!;
  const today = getTodayJst();
  const isPrevDisabled = state.weekStartDate <= today;
  const isNextDisabled = addDays(state.weekStartDate, 7) > addDays(today, 14);

  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) weekDates.push(addDays(state.weekStartDate, i));

  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

  const headerCells = weekDates.map((d) => {
    const dt = new Date(`${d}T12:00:00Z`);
    const dow = dt.getUTCDay();
    const dowCls = dow === 0 ? ' sun' : dow === 6 ? ' sat' : '';
    const todayCls = d === today ? ' today' : '';
    return `<th class="date-header${dowCls}${todayCls}">${dt.getUTCDate()}<br><span class="dow">(${weekdays[dow]})</span></th>`;
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
          <button class="back-btn" data-action="back-to-detail">&lt; 予約詳細に戻る</button>
          <h2>日時変更</h2>
          <p>${escapeHtml(b.menuName ?? '')}</p>
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

  const allTimes = getAllTimeSlots(state.gridSlots);
  let tableHtml = '';
  if (allTimes.length === 0) {
    tableHtml = `<div class="week-grid-empty"><p>この期間に空き枠がありません</p></div>`;
  } else {
    const bodyRows = allTimes.map((time) => {
      const cells = weekDates.map((d) => {
        const daySlots = state.gridSlots[d];
        if (!daySlots) return `<td class="grid-cell no-slot"></td>`;
        const slot = daySlots.find((s) => s.time === time);
        if (!slot) return `<td class="grid-cell no-slot"></td>`;
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
          <thead><tr><th class="time-col-header"></th>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    `;
  }

  return `
    <div class="booking-page">
      <div class="booking-header">
        <button class="back-btn" data-action="back-to-detail">&lt; 予約詳細に戻る</button>
        <h2>日時変更</h2>
        <p>${escapeHtml(b.menuName ?? '')} / 新しい日時をタップしてください</p>
      </div>
      <div class="week-grid-container">
        ${navHtml}
        ${tableHtml}
      </div>
    </div>
  `;
}

// ========== 日時変更: 確認画面 ==========

function renderRescheduleConfirmPage(): string {
  const b = state.selectedBooking!;
  return `
    <div class="booking-page">
      <div class="booking-header">
        <button class="back-btn" data-action="back-to-reschedule-calendar">&lt; 日時選択に戻る</button>
        <h2>日時変更の確認</h2>
      </div>
      <div class="confirm-card">
        <p style="margin-bottom:16px;">以下の内容で日時を変更しますか？</p>
        <div class="confirm-row"><span class="confirm-label">メニュー</span><span class="confirm-value">${escapeHtml(b.menuName ?? '')}</span></div>
        <div class="confirm-row"><span class="confirm-label">変更前</span><span class="confirm-value">${formatDateJa(b.startAt)} ${formatTime(b.startAt)}〜${formatTime(b.endAt)}</span></div>
        <div class="confirm-row"><span class="confirm-label">変更後</span><span class="confirm-value">${formatDateJa(state.selectedDate! + 'T00:00:00')} ${state.selectedTime}</span></div>
        <button class="book-btn${state.submitting ? ' loading' : ''}" data-action="execute-reschedule" ${state.submitting ? 'disabled' : ''}>
          ${state.submitting ? '変更中...' : '日時を変更する'}
        </button>
      </div>
    </div>
  `;
}

// ========== 日時変更: 完了画面 ==========

function renderRescheduleCompletePage(): string {
  return `
    <div class="booking-page">
      <div class="success-card">
        <div class="success-icon">✓</div>
        <h2>予約を変更しました</h2>
        <div class="confirm-details">
          <div class="confirm-row"><span class="confirm-label">日時</span><span class="confirm-value">${formatDateJa(state.selectedDate! + 'T00:00:00')} ${state.selectedTime}</span></div>
        </div>
        <button class="close-btn" data-action="back-to-list">予約一覧に戻る</button>
      </div>
    </div>
  `;
}

// ========== エラー画面 ==========

function renderErrorPage(): string {
  return `
    <div class="booking-page">
      <div class="card">
        <h2 style="color:#e53e3e;">エラー</h2>
        <p>${escapeHtml(state.errorMessage)}</p>
        <button class="close-btn" data-action="retry">再読み込み</button>
      </div>
    </div>
  `;
}

// ========== メインレンダリング ==========

function render(): void {
  const app = getApp();
  switch (state.page) {
    case 'list': app.innerHTML = renderListPage(); break;
    case 'detail': app.innerHTML = renderDetailPage(); break;
    case 'cancel-confirm': app.innerHTML = renderCancelConfirmPage(); break;
    case 'cancel-complete': app.innerHTML = renderCancelCompletePage(); break;
    case 'reschedule-calendar': app.innerHTML = renderRescheduleGridPage(); break;
    case 'reschedule-slots': app.innerHTML = renderRescheduleGridPage(); break;
    case 'reschedule-confirm': app.innerHTML = renderRescheduleConfirmPage(); break;
    case 'reschedule-complete': app.innerHTML = renderRescheduleCompletePage(); break;
    case 'error': app.innerHTML = renderErrorPage(); break;
  }
  attachEvents();
}

// ========== イベントハンドラ ==========

function attachEvents(): void {
  const app = getApp();

  // 予約一覧: 項目クリック → 詳細
  app.querySelectorAll('.menu-card[data-booking-id]').forEach((card) => {
    card.addEventListener('click', () => {
      const id = (card as HTMLElement).dataset.bookingId;
      const booking = state.bookings.find((b) => b.id === id);
      if (booking) {
        state.selectedBooking = booking;
        state.page = 'detail';
        render();
      }
    });
  });

  // 新規予約へ
  app.querySelector('[data-action="go-to-booking"]')?.addEventListener('click', () => {
    const params = new URLSearchParams(window.location.search);
    params.set('page', 'book');
    window.location.search = params.toString();
  });

  // 詳細: 戻る
  app.querySelector('[data-action="back-to-list"]')?.addEventListener('click', () => {
    state.page = 'list';
    render();
  });

  // キャンセルへ
  app.querySelector('[data-action="go-to-cancel"]')?.addEventListener('click', () => {
    state.page = 'cancel-confirm';
    render();
  });

  // 日時変更へ
  app.querySelector('[data-action="go-to-reschedule"]')?.addEventListener('click', () => {
    state.selectedDate = null;
    state.selectedTime = null;
    state.weekStartDate = getTodayJst();
    state.gridSlots = {};
    state.page = 'reschedule-calendar';
    fetchRescheduleWeekSlots(state.weekStartDate);
  });

  // キャンセル確認: 戻る
  app.querySelectorAll('[data-action="back-to-detail"]').forEach((el) => {
    el.addEventListener('click', () => {
      state.page = 'detail';
      render();
    });
  });

  // キャンセル実行
  app.querySelector('[data-action="execute-cancel"]')?.addEventListener('click', () => executeCancel());

  // 日時変更: 週ナビ
  app.querySelector('[data-action="prev-week"]')?.addEventListener('click', () => {
    const prev = addDays(state.weekStartDate, -7);
    const today = getTodayJst();
    state.weekStartDate = prev < today ? today : prev;
    state.selectedDate = null;
    state.selectedTime = null;
    fetchRescheduleWeekSlots(state.weekStartDate);
  });
  app.querySelector('[data-action="next-week"]')?.addEventListener('click', () => {
    state.weekStartDate = addDays(state.weekStartDate, 7);
    state.selectedDate = null;
    state.selectedTime = null;
    fetchRescheduleWeekSlots(state.weekStartDate);
  });

  // グリッドセル（◎）タップ → 確認へ
  app.querySelectorAll('.grid-cell.available').forEach((cell) => {
    cell.addEventListener('click', () => {
      const el = cell as HTMLElement;
      state.selectedDate = el.dataset.date!;
      state.selectedTime = el.dataset.time!;
      state.page = 'reschedule-confirm';
      render();
    });
  });

  // 日時変更確認: 戻る
  app.querySelector('[data-action="back-to-reschedule-calendar"]')?.addEventListener('click', () => {
    state.page = 'reschedule-calendar';
    fetchRescheduleWeekSlots(state.weekStartDate);
  });

  // 日時変更実行
  app.querySelector('[data-action="execute-reschedule"]')?.addEventListener('click', () => executeReschedule());

  // エラー: 再読み込み
  app.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
    state.errorMessage = '';
    state.page = 'list';
    state.loading = true;
    render();
    fetchBookings();
  });
}

// ========== API呼び出し ==========

async function fetchBookings(): Promise<void> {
  try {
    const params = new URLSearchParams({ line_account_id: LINE_ACCOUNT_ID });
    const res = await apiCall(`/api/public/my-bookings?${params}`);
    // M10: 認証エラーは「予約なし」として隠さず、再ログインへ誘導
    if (res.status === 401) {
      liff.login();
      return;
    }
    if (!res.ok) throw new Error('予約の取得に失敗しました');
    const json = await res.json() as { success: boolean; data: Booking[] };
    state.bookings = json.data;
  } catch (err) {
    console.error('fetchBookings error:', err);
    state.errorMessage = err instanceof Error ? err.message : '予約の取得に失敗しました';
    state.page = 'error';
  } finally {
    state.loading = false;
    render();
  }
}

async function fetchRescheduleWeekSlots(fromDate: string): Promise<void> {
  const b = state.selectedBooking!;
  if (!b.menuId) {
    state.gridSlots = {};
    state.loading = false;
    render();
    return;
  }
  state.loading = true;
  state.gridSlots = {};
  render();
  try {
    const toDate = addDays(fromDate, 6);
    const params = new URLSearchParams({
      line_account_id: LINE_ACCOUNT_ID,
      menu_id: b.menuId,
      from: fromDate,
      to: toDate,
    });
    const res = await fetch(`/api/public/slots?${params}`);
    if (!res.ok) throw new Error('空き状況の取得に失敗しました');
    const json = await res.json() as { success: boolean; data: Record<string, Slot[]> };
    state.gridSlots = json.data;
  } catch (err) {
    console.error('fetchRescheduleWeekSlots error:', err);
    state.gridSlots = {};
  } finally {
    state.loading = false;
    render();
  }
}

async function executeCancel(): Promise<void> {
  if (state.submitting) return;
  state.submitting = true;
  render();

  try {
    const b = state.selectedBooking!;
    const params = new URLSearchParams({ line_account_id: LINE_ACCOUNT_ID });
    const res = await apiCall(`/api/public/my-bookings/${encodeURIComponent(b.id)}/cancel?${params}`, { method: 'POST' });

    if (!res.ok) {
      const err = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(err?.error || 'キャンセルに失敗しました');
    }

    state.submitting = false;
    state.page = 'cancel-complete';
    // 一覧から削除
    state.bookings = state.bookings.filter((b2) => b2.id !== b.id);
    render();
  } catch (err) {
    state.submitting = false;
    state.errorMessage = err instanceof Error ? err.message : 'キャンセルに失敗しました';
    state.page = 'error';
    render();
  }
}

async function executeReschedule(): Promise<void> {
  if (state.submitting) return;
  state.submitting = true;
  render();

  try {
    const b = state.selectedBooking!;
    const params = new URLSearchParams({ line_account_id: LINE_ACCOUNT_ID });
    const res = await apiCall(`/api/public/my-bookings/${encodeURIComponent(b.id)}/reschedule?${params}`, {
      method: 'PUT',
      body: JSON.stringify({ date: state.selectedDate!, time: state.selectedTime! }),
    });

    if (res.status === 409) {
      state.submitting = false;
      state.selectedDate = null;
      state.selectedTime = null;
      state.page = 'reschedule-calendar';
      const err = await res.json().catch(() => null) as { error?: string } | null;
      alert(err?.error || 'この時間帯はすでに予約が入っています。別の時間を選択してください。');
      fetchRescheduleWeekSlots(state.weekStartDate);
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(err?.error || '日時変更に失敗しました');
    }

    state.submitting = false;
    // 一覧の該当予約を更新
    const updatedData = (await res.json() as { success: boolean; data: { id: string; startAt: string; endAt: string } }).data;
    state.bookings = state.bookings.map((bk) =>
      bk.id === b.id ? { ...bk, startAt: updatedData.startAt, endAt: updatedData.endAt } : bk,
    );
    state.page = 'reschedule-complete';
    render();
  } catch (err) {
    state.submitting = false;
    state.errorMessage = err instanceof Error ? err.message : '日時変更に失敗しました';
    state.page = 'error';
    render();
  }
}

// ========== 初期化 ==========

export async function initMyBookings(): Promise<void> {
  // M10: getIDToken() が null の場合（未ログイン）はログインにリダイレクト
  const idToken = liff.getIDToken();
  if (!idToken) {
    liff.login();
    return;
  }
  state.idToken = idToken;
  state.loading = true;
  render();
  await fetchBookings();
}
