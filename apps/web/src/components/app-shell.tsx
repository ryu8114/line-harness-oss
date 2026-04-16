'use client'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import AuthGuard from './auth-guard'
import { AccountProvider } from '@/contexts/account-context'
import { ConfirmProvider } from '@/contexts/confirm-context'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const initLiff = async () => {
      try {
        const liff = (await import('@line/liff')).default
        await liff.init({ liffId: '2009660165-iO7T7i2u' })

        if (liff.isInClient() && !localStorage.getItem('lh_api_key')) {
          const idToken = liff.getIDToken()
          if (idToken) {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
            const res = await fetch(`${apiUrl}/api/public/admin-liff/session`, {
              method: 'POST',
              headers: { 'X-LIFF-ID-Token': idToken },
            })
            if (res.ok) {
              const json = await res.json() as { data: { apiKey: string; staffName: string; role: string; lineAccountId: string } }
              localStorage.setItem('lh_api_key', json.data.apiKey)
              localStorage.setItem('lh_staff_name', json.data.staffName)
              localStorage.setItem('lh_staff_role', json.data.role)
              localStorage.setItem('lh_line_account_id', json.data.lineAccountId)
            }
          }
        }
      } catch {
        // LIFF初期化失敗 → 通常フローへ
      } finally {
        setReady(true)
      }
    }
    initLiff()
  }, [])

  // LIFF初期化完了まで全画面スピナーを表示（auth-guardより先に完了させる）
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-[3px] border-gray-200 border-t-green-500 rounded-full" />
      </div>
    )
  }

  if (pathname === '/login') {
    return <>{children}</>
  }

  return (
    <AuthGuard>
      <AccountProvider>
        <ConfirmProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 pt-20 px-4 pb-6 sm:px-6 lg:pt-8 lg:px-8 lg:pb-8 overflow-auto">
              {children}
            </main>
          </div>
        </ConfirmProvider>
      </AccountProvider>
    </AuthGuard>
  )
}
