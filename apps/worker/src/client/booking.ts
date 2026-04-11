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

type Page = 'menu' | 'calendar' | 'slots' | 'form' | 'confirm' | 'complete' | 'error';

interface BookingState {
  page: Page;
  menus: Menu[];
  selectedMenu: Menu | null;
  currentYear: number;
  currentMonth: number;
  selectedDate: string | null;
  slots: Slot[];
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

const state: BookingState = {
  page: 'menu',
  menus: [],
  selectedMenu: null,
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),
  selectedDate: null,
  slots: [],
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

// ========== カレンダー画面 ==========

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function isPast(year: number, month: number, day: number): boolean {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return new Date(year, month, day) < now;
}

function dateToString(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function renderCalendarPage(): string {
  const { currentYear, currentMonth, selectedDate } = state;
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfWeek(currentYear, currentMonth);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

  let calHtml = `
    <div class="booking-calendar">
      <div class="calendar-header">
        <button class="cal-nav" data-action="prev-month">&lt;</button>
        <span class="cal-title">${currentYear}年${currentMonth + 1}月</span>
        <button class="cal-nav" data-action="next-month">&gt;</button>
      </div>
      <div class="cal-weekdays">
        ${weekdays.map((d, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</span>`).join('')}
      </div>
      <div class="cal-days">
  `;

  for (let i = 0; i < firstDay; i++) calHtml += '<span class="cal-day empty"></span>';
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = dateToString(currentYear, currentMonth, day);
    const past = isPast(currentYear, currentMonth, day);
    const selected = selectedDate === dateStr;
    const dow = new Date(currentYear, currentMonth, day).getDay();
    const classes = ['cal-day', past ? 'past' : 'active', selected ? 'selected' : '', dow === 0 ? 'sun' : '', dow === 6 ? 'sat' : ''].filter(Boolean).join(' ');
    calHtml += `<span class="${classes}" ${past ? '' : `data-date="${dateStr}"`}>${day}</span>`;
  }
  calHtml += '</div></div>';

  return `
    <div class="booking-page">
      <div class="booking-header">
        <button class="back-btn" data-action="back-to-menu">&lt; メニュー選択に戻る</button>
        <h2>${escapeHtml(state.selectedMenu?.name ?? '')}</h2>
        <p>ご希望の日付をお選びください</p>
      </div>
      ${calHtml}
      ${state.selectedDate ? renderSlotsSection() : ''}
    </div>
  `;
}

function renderSlotsSection(): string {
  if (state.loading) {
    return `<div class="slots-section"><div class="loading-spinner"></div><p>空き状況を確認中...</p></div>`;
  }
  if (state.slots.length === 0) {
    return `<div class="slots-section"><h3>${formatDateJa(state.selectedDate!)}</h3><p class="no-slots">この日は予約枠がありません</p></div>`;
  }

  const buttons = state.slots.map((slot) => {
    const isSelected = state.selectedTime === slot.time;
    const cls = slot.available ? (isSelected ? 'slot-btn selected' : 'slot-btn available') : 'slot-btn full';
    return `<button class="${cls}" ${slot.available ? `data-time="${slot.time}"` : 'disabled'}>${formatTime(slot.time)}</button>`;
  }).join('');

  return `
    <div class="slots-section">
      <h3>${formatDateJa(state.selectedDate!)}</h3>
      <div class="slots-grid">${buttons}</div>
      ${state.selectedTime ? `<button class="next-btn" data-action="go-to-form">次へ（顧客情報入力）</button>` : ''}
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
        <div class="confirm-row"><span class="confirm-label">時間帯</span><span class="confirm-value">${state.selectedTime}</span></div>
        <div class="confirm-row"><span class="confirm-label">お名前</span><span class="confirm-value">${escapeHtml(state.customerName)}</span></div>
        ${state.customerPhone ? `<div class="confirm-row"><span class="confirm-label">電話番号</span><span class="confirm-value">${escapeHtml(state.customerPhone)}</span></div>` : ''}
        ${state.customerNote ? `<div class="confirm-row"><span class="confirm-label">症状・お悩み</span><span class="confirm-value">${escapeHtml(state.customerNote)}</span></div>` : ''}
        <button class="book-btn${state.submitting ? ' loading' : ''}" data-action="submit-booking" ${state.submitting ? 'disabled' : ''}>
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
          <div class="confirm-row"><span class="confirm-label">日時</span><span class="confirm-value">${formatDateJa(state.selectedDate!)} ${state.selectedTime}</span></div>
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
    case 'calendar': app.innerHTML = renderCalendarPage(); break;
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
        state.slots = [];
        state.selectedTime = null;
        state.page = 'calendar';
        render();
      }
    });
  });

  // カレンダーナビ
  app.querySelector('[data-action="prev-month"]')?.addEventListener('click', () => {
    state.currentMonth--;
    if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
    state.selectedDate = null; state.slots = []; state.selectedTime = null;
    render();
  });
  app.querySelector('[data-action="next-month"]')?.addEventListener('click', () => {
    state.currentMonth++;
    if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
    state.selectedDate = null; state.slots = []; state.selectedTime = null;
    render();
  });

  // 日付選択
  app.querySelectorAll('.cal-day.active').forEach((el) => {
    el.addEventListener('click', () => {
      const date = (el as HTMLElement).dataset.date;
      if (date) {
        state.selectedDate = date;
        state.selectedTime = null;
        state.slots = [];
        state.loading = true;
        render();
        fetchSlots(date);
      }
    });
  });

  // スロット選択
  app.querySelectorAll('.slot-btn.available').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedTime = (btn as HTMLElement).dataset.time!;
      render();
    });
  });

  // 顧客情報入力へ
  app.querySelector('[data-action="go-to-form"]')?.addEventListener('click', () => {
    state.page = 'form';
    render();
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
  app.querySelector('[data-action="back-to-calendar"]')?.addEventListener('click', () => { state.page = 'calendar'; render(); });
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

async function fetchSlots(date: string): Promise<void> {
  try {
    const params = new URLSearchParams({
      line_account_id: LINE_ACCOUNT_ID,
      menu_id: state.selectedMenu!.id,
      date,
    });
    const res = await apiCall(`/api/public/slots?${params}`);
    if (!res.ok) throw new Error('空き状況の取得に失敗しました');
    const json = await res.json() as { success: boolean; data: Slot[] };
    state.slots = json.data;
  } catch (err) {
    console.error('fetchSlots error:', err);
    state.slots = [];
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
      state.slots = [];
      state.selectedTime = null;
      state.page = 'calendar';
      alert('この時間帯はすでに予約が入りました。別の時間を選択してください。');
      render();
      fetchSlots(state.selectedDate!);
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
