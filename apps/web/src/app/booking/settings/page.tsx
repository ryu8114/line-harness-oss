'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'

export default function BookingSettingsPage() {
  const { selectedAccountId } = useAccount()
  const [cancelDeadlineHours, setCancelDeadlineHours] = useState(24)
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
      setCancelDeadlineHours(res.data.cancelDeadlineHours)
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
      const res = await api.booking.updateSettings({ cancelDeadlineHours })
      if (!res.success) { setError('保存に失敗しました'); return }
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header title="予約設定" />

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
          <div className="h-8 bg-gray-100 rounded w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">キャンセル期限</h2>
            <div className="flex items-center flex-wrap gap-3">
              <label className="text-sm text-gray-600">予約の</label>
              <input
                type="number"
                min={0}
                max={720}
                value={cancelDeadlineHours}
                onChange={(e) => setCancelDeadlineHours(Number(e.target.value))}
                className="w-20 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <label className="text-sm text-gray-600">時間前まで受付</label>
            </div>
            <p className="mt-2 text-xs text-gray-400">顧客がキャンセル・日時変更できる期限です。0 で無制限。</p>
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
