'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { Booking } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'

const STATUS_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'confirmed', label: '確定' },
  { value: 'cancelled', label: 'キャンセル' },
  { value: 'completed', label: '完了' },
  { value: 'no_show', label: '無断キャンセル' },
]

function statusLabel(status: string): string {
  switch (status) {
    case 'confirmed': return '確定'
    case 'cancelled': return 'キャンセル'
    case 'completed': return '完了'
    case 'no_show': return '無断キャンセル'
    default: return status
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'confirmed': return 'bg-green-100 text-green-700'
    case 'cancelled': return 'bg-red-100 text-red-700'
    case 'completed': return 'bg-blue-100 text-blue-700'
    case 'no_show': return 'bg-yellow-100 text-yellow-700'
    default: return 'bg-gray-100 text-gray-600'
  }
}

function formatDatetime(isoStr: string): string {
  const d = new Date(isoStr)
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function toLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function BookingListPage() {
  const { selectedAccountId } = useAccount()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const today = toLocalDate(new Date())
  const oneMonthLater = (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return toLocalDate(d) })()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(oneMonthLater)
  const [statusFilter, setStatusFilter] = useState('')

  const [selected, setSelected] = useState<Booking | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  const loadBookings = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError('')
    try {
      const res = await api.booking.getBookings(selectedAccountId, {
        from,
        to,
        status: statusFilter || undefined,
      })
      if (res.success) {
        setBookings(res.data)
      } else {
        setError('予約の読み込みに失敗しました')
      }
    } catch {
      setError('予約の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, from, to, statusFilter])

  useEffect(() => { loadBookings() }, [loadBookings])

  const handleStatusChange = async (bookingId: string, newStatus: string) => {
    setUpdatingStatus(true)
    try {
      await api.booking.updateBookingStatus(bookingId, newStatus)
      // Refresh both the list and the selected booking
      const res = await api.booking.getBooking(bookingId)
      if (res.success) {
        setSelected(res.data)
        setBookings((prev) => prev.map((b) => b.id === bookingId ? res.data : b))
      }
    } catch {
      setError('ステータスの変更に失敗しました')
    } finally {
      setUpdatingStatus(false)
    }
  }

  if (selected) {
    return (
      <div>
        <Header title="予約詳細" />
        <div className="mb-4">
          <button
            onClick={() => setSelected(null)}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            &larr; 一覧に戻る
          </button>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 max-w-lg">
          <dl className="divide-y divide-gray-100">
            <div className="py-3 flex gap-4">
              <dt className="text-xs font-medium text-gray-500 w-28 shrink-0 pt-0.5">日時</dt>
              <dd className="text-sm text-gray-900">
                {formatDatetime(selected.startAt)} 〜 {String(new Date(selected.endAt).getHours()).padStart(2, '0')}:{String(new Date(selected.endAt).getMinutes()).padStart(2, '0')}
              </dd>
            </div>
            <div className="py-3 flex gap-4">
              <dt className="text-xs font-medium text-gray-500 w-28 shrink-0 pt-0.5">ステータス</dt>
              <dd className="flex items-center gap-3">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(selected.status)}`}>
                  {statusLabel(selected.status)}
                </span>
                <select
                  value={selected.status}
                  onChange={(e) => handleStatusChange(selected.id, e.target.value)}
                  disabled={updatingStatus}
                  className="border border-gray-300 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                >
                  {STATUS_OPTIONS.filter((o) => o.value && o.value !== 'completed' && o.value !== 'no_show').map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </dd>
            </div>
            <div className="py-3 flex gap-4">
              <dt className="text-xs font-medium text-gray-500 w-28 shrink-0 pt-0.5">メニュー</dt>
              <dd className="text-sm text-gray-900">
                {selected.menuName ?? '—'}
                {selected.menuDuration ? ` (${selected.menuDuration}分)` : ''}
                {selected.menuPrice ? ` / ¥${selected.menuPrice.toLocaleString()}` : ''}
              </dd>
            </div>
            <div className="py-3 flex gap-4">
              <dt className="text-xs font-medium text-gray-500 w-28 shrink-0 pt-0.5">お名前</dt>
              <dd className="text-sm text-gray-900">{selected.customerName ?? '—'}</dd>
            </div>
            {selected.customerPhone && (
              <div className="py-3 flex gap-4">
                <dt className="text-xs font-medium text-gray-500 w-28 shrink-0 pt-0.5">電話番号</dt>
                <dd className="text-sm text-gray-900">
                  <a href={`tel:${selected.customerPhone}`} className="text-blue-600 hover:underline">
                    {selected.customerPhone}
                  </a>
                </dd>
              </div>
            )}
            {selected.customerNote && (
              <div className="py-3 flex gap-4">
                <dt className="text-xs font-medium text-gray-500 w-28 shrink-0 pt-0.5">症状・メモ</dt>
                <dd className="text-sm text-gray-700 whitespace-pre-wrap">{selected.customerNote}</dd>
              </div>
            )}
            <div className="py-3 flex gap-4">
              <dt className="text-xs font-medium text-gray-500 w-28 shrink-0 pt-0.5">予約日時</dt>
              <dd className="text-sm text-gray-400">{formatDatetime(selected.createdAt)}</dd>
            </div>
          </dl>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header title="予約一覧" />

      {!selectedAccountId && (
        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
          LINEアカウントを選択してください
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3 bg-white border border-gray-200 rounded-lg p-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">期間（開始）</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">期間（終了）</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">ステータス</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={loadBookings}
          className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#06C755' }}
        >
          検索
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse flex gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/4" />
                <div className="h-3 bg-gray-100 rounded w-1/3" />
              </div>
              <div className="h-5 bg-gray-100 rounded-full w-16" />
            </div>
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-sm">この期間の予約はありません</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">日時</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">お名前</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">メニュー</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ステータス</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">詳細</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bookings.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-900 whitespace-nowrap">{formatDatetime(b.startAt)}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{b.customerName ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                    {b.menuName ?? '—'}
                    {b.menuDuration ? ` (${b.menuDuration}分)` : ''}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(b.status)}`}>
                      {statusLabel(b.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelected(b)}
                      className="px-2.5 py-1 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-50"
                    >
                      詳細
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
