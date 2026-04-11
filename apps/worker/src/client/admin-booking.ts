/**
 * 管理者LIFF — 今日の予約一覧
 *
 * 院長のLINE内で起動するLIFF。
 * IDトークンで本人確認し、今日の予約を表示する。
 */

declare const liff: {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(opts?: { redirectUri?: string }): void;
  getIDToken(): string | null;
  isInClient(): boolean;
  closeWindow(): void;
};

interface Booking {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  menuName: string | null;
  menuDuration: number | null;
  customerName: string | null;
  customerPhone: string | null;
  customerNote: string | null;
}

interface AdminState {
  bookings: Booking[];
  selectedBooking: Booking | null;
  idToken: string | null;
  loading: boolean;
  errorMessage: string;
}

const state: AdminState = {
  bookings: [],
  selectedBooking: null,
  idToken: null,
  loading: true,
  errorMessage: '',
};

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateJa(isoStr: string): string {
  const d = new Date(isoStr);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}月${d.getDate()}日(${weekdays[d.getDay()]})`;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'confirmed': return '確定';
    case 'cancelled': return 'キャンセル';
    case 'completed': return '完了';
    case 'no_show': return '無断キャンセル';
    default: return status;
  }
}

function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

function render(): void {
  const app = getApp();

  if (state.loading) {
    app.innerHTML = `<div class="admin-page"><div class="loading-spinner"></div><p>読み込み中...</p></div>`;
    return;
  }

  if (state.errorMessage) {
    app.innerHTML = `
      <div class="admin-page">
        <div class="card">
          <h2 style="color:#e53e3e;">エラー</h2>
          <p>${escapeHtml(state.errorMessage)}</p>
          <button data-action="retry" class="retry-btn">再読み込み</button>
        </div>
      </div>
    `;
    getApp().querySelector('[data-action="retry"]')?.addEventListener('click', () => {
      state.errorMessage = ''; state.loading = true;
      render();
      fetchTodayBookings();
    });
    return;
  }

  if (state.selectedBooking) {
    renderDetail(app, state.selectedBooking);
    return;
  }

  renderList(app, state.bookings);
}

function renderList(app: HTMLElement, bookings: Booking[]): void {
  const now = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

  const items = bookings.length === 0
    ? `<p class="no-bookings">本日の予約はありません</p>`
    : bookings.map((b) => `
        <div class="booking-item ${b.status === 'cancelled' ? 'cancelled' : ''}" data-id="${b.id}">
          <div class="booking-time">${formatTime(b.startAt)}〜${formatTime(b.endAt)}</div>
          <div class="booking-info">
            <span class="customer-name">${escapeHtml(b.customerName || '（名前なし）')}</span>
            <span class="menu-name">${escapeHtml(b.menuName || '')}</span>
          </div>
          <div class="booking-status status-${b.status}">${statusLabel(b.status)}</div>
        </div>
      `).join('');

  app.innerHTML = `
    <div class="admin-page">
      <div class="admin-header">
        <h1>今日の予約</h1>
        <p>${dateStr}（${bookings.filter((b) => b.status === 'confirmed').length}件確定）</p>
        <button data-action="refresh" class="refresh-btn">更新</button>
      </div>
      <div class="booking-list">${items}</div>
    </div>
  `;

  app.querySelectorAll('.booking-item').forEach((item) => {
    item.addEventListener('click', () => {
      const id = (item as HTMLElement).dataset.id;
      state.selectedBooking = state.bookings.find((b) => b.id === id) ?? null;
      render();
    });
  });

  app.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
    state.loading = true; render(); fetchTodayBookings();
  });
}

function renderDetail(app: HTMLElement, booking: Booking): void {
  app.innerHTML = `
    <div class="admin-page">
      <div class="admin-header">
        <button data-action="back" class="back-btn">&lt; 一覧に戻る</button>
        <h2>予約詳細</h2>
      </div>
      <div class="detail-card">
        <div class="detail-row"><span class="detail-label">日時</span><span class="detail-value">${formatDateJa(booking.startAt)} ${formatTime(booking.startAt)}〜${formatTime(booking.endAt)}</span></div>
        <div class="detail-row"><span class="detail-label">ステータス</span><span class="detail-value status-${booking.status}">${statusLabel(booking.status)}</span></div>
        <div class="detail-row"><span class="detail-label">メニュー</span><span class="detail-value">${escapeHtml(booking.menuName || '')}（${booking.menuDuration}分）</span></div>
        <div class="detail-row"><span class="detail-label">お名前</span><span class="detail-value">${escapeHtml(booking.customerName || '（不明）')}</span></div>
        ${booking.customerPhone ? `<div class="detail-row"><span class="detail-label">電話番号</span><span class="detail-value"><a href="tel:${escapeHtml(booking.customerPhone)}">${escapeHtml(booking.customerPhone)}</a></span></div>` : ''}
        ${booking.customerNote ? `<div class="detail-row"><span class="detail-label">症状・お悩み</span><span class="detail-value">${escapeHtml(booking.customerNote)}</span></div>` : ''}
      </div>
    </div>
  `;

  app.querySelector('[data-action="back"]')?.addEventListener('click', () => {
    state.selectedBooking = null; render();
  });
}

// ========== API呼び出し ==========

async function fetchTodayBookings(): Promise<void> {
  try {
    const headers: Record<string, string> = {};
    if (state.idToken) headers['X-LIFF-ID-Token'] = state.idToken;

    const res = await fetch('/api/public/admin-liff/today', { headers });
    if (res.status === 401) {
      state.errorMessage = '認証に失敗しました。院長アカウントでLINEにログインしているか確認してください。';
      state.loading = false;
      render();
      return;
    }
    if (!res.ok) throw new Error('予約の取得に失敗しました');

    const json = await res.json() as { success: boolean; data: Booking[] };
    state.bookings = json.data;
  } catch (err) {
    state.errorMessage = err instanceof Error ? err.message : '読み込みに失敗しました';
  } finally {
    state.loading = false;
    render();
  }
}

// ========== 初期化 ==========

export async function initAdminBooking(): Promise<void> {
  state.idToken = liff.getIDToken();
  render();
  await fetchTodayBookings();
}
