'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { BusinessHourInput } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'

const DAYS = ['日', '月', '火', '水', '木', '金', '土']

type DayState = {
  isOpen: boolean
  openTime: string
  closeTime: string
  breakStart: string
  breakEnd: string
}

const DEFAULT_DAY: DayState = { isOpen: false, openTime: '10:00', closeTime: '19:00', breakStart: '', breakEnd: '' }

function toHhmm(val: string | null | undefined): string {
  return val ?? ''
}

export default function BusinessHoursPage() {
  const { selectedAccountId } = useAccount()
  const [days, setDays] = useState<DayState[]>(DAYS.map(() => ({ ...DEFAULT_DAY })))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const loadHours = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError('')
    try {
      const res = await api.booking.getBusinessHours(selectedAccountId)
      if (!res.success) { setError('読み込みに失敗しました'); return }
      // Merge API data into local state
      const next: DayState[] = DAYS.map((_, i) => {
        const h = res.data.find((d) => d.dayOfWeek === i)
        if (!h) return { ...DEFAULT_DAY }
        return {
          isOpen: h.openTime !== null,
          openTime: toHhmm(h.openTime) || '10:00',
          closeTime: toHhmm(h.closeTime) || '19:00',
          breakStart: toHhmm(h.breakStart),
          breakEnd: toHhmm(h.breakEnd),
        }
      })
      setDays(next)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { loadHours() }, [loadHours])

  const handleSave = async () => {
    if (!selectedAccountId) return
    setSaving(true)
    setError('')
    setSuccess(false)
    try {
      const hours: BusinessHourInput[] = days.map((d, i) => ({
        dayOfWeek: i,
        openTime: d.isOpen ? d.openTime : null,
        closeTime: d.isOpen ? d.closeTime : null,
        breakStart: d.isOpen && d.breakStart ? d.breakStart : null,
        breakEnd: d.isOpen && d.breakEnd ? d.breakEnd : null,
      }))
      const res = await api.booking.updateBusinessHours(selectedAccountId, hours)
      if (!res.success) { setError('保存に失敗しました'); return }
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const update = (i: number, patch: Partial<DayState>) => {
    setDays((prev) => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d))
  }

  return (
    <div>
      <Header title="営業時間設定" />

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
          {DAYS.map((_, i) => (
            <div key={i} className="h-8 bg-gray-100 rounded w-full" />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="divide-y divide-gray-100">
            {DAYS.map((dayLabel, i) => (
              <div key={i} className="px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                {/* Day toggle */}
                <div className="flex items-center gap-3 min-w-[80px]">
                  <button
                    onClick={() => update(i, { isOpen: !days[i].isOpen })}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${days[i].isOpen ? 'bg-green-500' : 'bg-gray-200'}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform ${days[i].isOpen ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-sm font-medium text-gray-700 w-6">{dayLabel}曜</span>
                </div>

                {days[i].isOpen ? (
                  <div className="flex flex-col gap-2 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-8 shrink-0">営業</span>
                      <input
                        type="time"
                        value={days[i].openTime}
                        onChange={(e) => update(i, { openTime: e.target.value })}
                        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                      <span className="text-gray-400">〜</span>
                      <input
                        type="time"
                        value={days[i].closeTime}
                        onChange={(e) => update(i, { closeTime: e.target.value })}
                        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-8 shrink-0">休憩</span>
                      <input
                        type="time"
                        value={days[i].breakStart}
                        onChange={(e) => update(i, { breakStart: e.target.value })}
                        placeholder="--:--"
                        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-24"
                      />
                      <span className="text-gray-400">〜</span>
                      <input
                        type="time"
                        value={days[i].breakEnd}
                        onChange={(e) => update(i, { breakEnd: e.target.value })}
                        placeholder="--:--"
                        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-24"
                      />
                    </div>
                  </div>
                ) : (
                  <span className="text-sm text-gray-400">定休日</span>
                )}
              </div>
            ))}
          </div>

          <div className="px-4 py-4 border-t border-gray-100 bg-gray-50 flex justify-end">
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
