'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { BookingSettings } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'

type ShopInfo = NonNullable<BookingSettings['shopInfo']>

const DEFAULT_SHOP_INFO: ShopInfo = { address: '', phone: '', hours: '', mapUrl: '' }

export default function ShopInfoPage() {
  const { selectedAccountId } = useAccount()
  const [shopInfo, setShopInfo] = useState<ShopInfo>({ ...DEFAULT_SHOP_INFO })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const loadSettings = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError('')
    try {
      const res = await api.booking.getSettings()
      if (!res.success) { setError('読み込みに失敗しました'); return }
      setShopInfo(res.data.shopInfo ?? { ...DEFAULT_SHOP_INFO })
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { loadSettings() }, [loadSettings])

  const handleSave = async () => {
    if (!selectedAccountId) return
    setSaving(true)
    setError('')
    setSuccess(false)
    try {
      const res = await api.booking.updateSettings({
        shopInfo: {
          address: shopInfo.address || undefined,
          phone: shopInfo.phone || undefined,
          hours: shopInfo.hours || undefined,
          mapUrl: shopInfo.mapUrl || undefined,
        },
      })
      if (!res.success) { setError('保存に失敗しました'); return }
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const updateShopInfo = (patch: Partial<ShopInfo>) => {
    setShopInfo((prev) => ({ ...prev, ...patch }))
  }

  return (
    <div>
      <Header title="店舗情報" />

      {!selectedAccountId && (
        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
          LINEアカウントを選択してください
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}
      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">保存しました</div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 bg-gray-100 rounded w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-xs text-gray-400 mb-4">リッチメニューの「お店情報」ボタンを押したときに表示される情報です。</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">住所</label>
                <input
                  type="text"
                  value={shopInfo.address ?? ''}
                  onChange={(e) => updateShopInfo({ address: e.target.value })}
                  placeholder="奈良県橿原市..."
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">電話番号</label>
                <input
                  type="tel"
                  value={shopInfo.phone ?? ''}
                  onChange={(e) => updateShopInfo({ phone: e.target.value })}
                  placeholder="0744-XX-XXXX"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">営業時間</label>
                <textarea
                  value={shopInfo.hours ?? ''}
                  onChange={(e) => updateShopInfo({ hours: e.target.value })}
                  placeholder={'月〜金 10:00〜20:00\n土 10:00〜18:00\n日曜 定休'}
                  rows={3}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <p className="mt-1 text-xs text-gray-400">改行で区切ってください。</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Google マップ URL</label>
                <input
                  type="url"
                  value={shopInfo.mapUrl ?? ''}
                  onChange={(e) => updateShopInfo({ mapUrl: e.target.value })}
                  placeholder="https://maps.google.com/..."
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving || !selectedAccountId}
              className="px-6 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#06C755' }}
            >
              {saving ? '保存中...' : '保存する'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
