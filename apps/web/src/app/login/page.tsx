'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect') || '/'

  const handleLoginWithKey = async (key: string) => {
    setLoading(true)
    setError('')

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
      const res = await fetch(`${apiUrl}/api/friends/count`, {
        headers: { Authorization: `Bearer ${key}` },
      })

      if (res.ok) {
        localStorage.setItem('lh_api_key', key)
        // Fetch staff profile for name/role/lineAccountId display
        try {
          const profileRes = await fetch(`${apiUrl}/api/staff/me`, {
            headers: { Authorization: `Bearer ${key}` },
          })
          if (profileRes.ok) {
            const profileData = await profileRes.json()
            if (profileData.success && profileData.data) {
              localStorage.setItem('lh_staff_name', profileData.data.name)
              localStorage.setItem('lh_staff_role', profileData.data.role)
              if (profileData.data.lineAccountId) {
                localStorage.setItem('lh_line_account_id', profileData.data.lineAccountId)
              } else {
                localStorage.removeItem('lh_line_account_id')
              }
            }
          }
        } catch {
          // Profile fetch is best-effort
        }
        router.push(redirectTo)
      } else {
        setError('APIキーが正しくありません')
      }
    } catch {
      setError('接続に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  // URL の ?key= パラメータで自動ログイン、?redirect= でログイン後の遷移先を指定
  useEffect(() => {
    const urlKey = searchParams.get('key')
    if (urlKey) {
      // セキュリティ: URL から key を即削除（ブラウザ履歴・Referer 漏洩防止）
      window.history.replaceState({}, '', '/login')
      handleLoginWithKey(urlKey)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    await handleLoginWithKey(apiKey)
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#06C755' }}>
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-900">予約管理システム</h1>
          <p className="text-sm text-gray-500 mt-1">管理画面にログイン</p>
        </div>

        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="APIキーを入力"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !apiKey}
            className="w-full py-3 text-white font-medium rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#06C755' }}>
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm text-center text-gray-500">
          読み込み中...
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
