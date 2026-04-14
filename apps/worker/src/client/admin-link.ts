/**
 * 管理者LIFF — LINE連携画面
 *
 * 院長がこのページを LINE アプリ内で開くと、
 * LIFF IDトークンとワンタイムトークンを使って
 * admin_line_user_id の紐付けを行う。
 */

declare const liff: {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(opts?: { redirectUri?: string }): void;
  getIDToken(): string | null;
  isInClient(): boolean;
  closeWindow(): void;
};

function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

function renderLoading(): void {
  getApp().innerHTML = `
    <div class="admin-page">
      <div class="loading-spinner"></div>
      <p>連携中...</p>
    </div>
  `;
}

function renderSuccess(): void {
  getApp().innerHTML = `
    <div class="admin-page">
      <div class="card" style="text-align:center;">
        <div style="font-size:3rem;margin-bottom:1rem;">✅</div>
        <h2>LINE連携が完了しました</h2>
        <p style="color:#555;margin:1rem 0;">
          公式アカウントをまだ友達追加していない場合は、<br>
          友達追加してください。<br>
          院長専用メニューが表示されます。
        </p>
        <button id="close-btn" class="retry-btn">閉じる</button>
      </div>
    </div>
  `;
  document.getElementById('close-btn')?.addEventListener('click', () => {
    if (liff.isInClient()) liff.closeWindow();
  });
}

function renderError(message: string): void {
  getApp().innerHTML = `
    <div class="admin-page">
      <div class="card">
        <h2 style="color:#e53e3e;">エラー</h2>
        <p>${message}</p>
      </div>
    </div>
  `;
}

export async function initAdminLink(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (!token) {
    renderError('リンクトークンが指定されていません。管理者に連絡してください。');
    return;
  }

  renderLoading();

  const idToken = liff.getIDToken();
  if (!idToken) {
    renderError('LINEログインが必要です。LINEアプリ内で開いてください。');
    return;
  }

  try {
    const res = await fetch('/api/public/admin-liff/link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LIFF-ID-Token': idToken,
      },
      body: JSON.stringify({ token }),
    });

    if (res.status === 401) {
      renderError('リンクが無効または期限切れです。管理者に新しいURLを発行してもらってください。');
      return;
    }
    if (res.status === 409) {
      renderError('このリンクは既に使用されています。管理者に新しいURLを発行してもらってください。');
      return;
    }
    if (!res.ok) {
      const json = await res.json().catch(() => ({})) as { error?: string };
      renderError(json.error ?? '連携に失敗しました。もう一度お試しください。');
      return;
    }

    renderSuccess();
  } catch {
    renderError('通信エラーが発生しました。インターネット接続を確認してください。');
  }
}
