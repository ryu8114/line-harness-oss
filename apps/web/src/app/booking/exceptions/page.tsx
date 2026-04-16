'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { ScheduleException } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { useConfirm } from '@/contexts/confirm-context'
import Header from '@/components/layout/header'

type FormState = {
  date: string
  type: 'closed' | 'partial'
  openTime: string
  closeTime: string
  note: string
}

const EMPTY_FORM: FormState = { date: '', type: 'closed', openTime: '', closeTime: '', note: '' }

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`
}

export default function BookingExceptionsPage() {
  const { selectedAccountId } = useAccount()
  const confirm = useConfirm()
  const [exceptions, setExceptions] = useState<ScheduleException[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const loadExceptions = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError('')
    try {
      const res = await api.booking.getExceptions(selectedAccountId)
      if (res.success) {
        setExceptions(res.data)
      } else {
        setError('読み込みに失敗しました')
      }
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { loadExceptions() }, [loadExceptions])

  const handleCreate = async () => {
    if (!selectedAccountId) return
    if (!form.date) { setFormError('日付を入力してください'); return }
    if (form.type === 'partial' && (!form.openTime || !form.closeTime)) {
      setFormError('部分営業の場合は時間を入力してください')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const res = await api.booking.createException({
        lineAccountId: selectedAccountId,
        date: form.date,
        type: form.type,
        openTime: form.type === 'partial' ? form.openTime : undefined,
        closeTime: form.type === 'partial' ? form.closeTime : undefined,
        note: form.note.trim() || undefined,
      })
      if (!res.success) { setFormError('登録に失敗しました'); return }
      setShowForm(false)
      setForm(EMPTY_FORM)
      loadExceptions()
    } catch {
      setFormError('登録に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (ex: ScheduleException) => {
    if (!await confirm({ message: `${formatDate(ex.date)} の例外設定を削除しますか？`, confirmLabel: '削除する', danger: true })) return
    try {
      await api.booking.deleteException(ex.id)
      loadExceptions()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div>
      <Header
        title="例外日管理"
        action={
          <button
            onClick={() => { setForm(EMPTY_FORM); setFormError(''); setShowForm(true) }}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 例外日を追加
          </button>
        }
      />

      {!selectedAccountId && (
        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
          LINEアカウントを選択してください
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {showForm && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">例外日を登録</h2>
          <div className="space-y-4 max-w-md">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">日付 <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={form.date}
                min={today}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">種別 <span className="text-red-500">*</span></label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    value="closed"
                    checked={form.type === 'closed'}
                    onChange={() => setForm({ ...form, type: 'closed' })}
                    className="text-green-600 focus:ring-green-500"
                  />
                  臨時休業
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    value="partial"
                    checked={form.type === 'partial'}
                    onChange={() => setForm({ ...form, type: 'partial' })}
                    className="text-green-600 focus:ring-green-500"
                  />
                  部分営業
                </label>
              </div>
            </div>
            {form.type === 'partial' && (
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">開始時刻</label>
                  <input
                    type="time"
                    value={form.openTime}
                    onChange={(e) => setForm({ ...form, openTime: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <span className="mt-5 text-gray-500">〜</span>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">終了時刻</label>
                  <input
                    type="time"
                    value={form.closeTime}
                    onChange={(e) => setForm({ ...form, closeTime: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">メモ（管理用）</label>
              <input
                type="text"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="例: 研修のため"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            {formError && <p className="text-xs text-red-600">{formError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={saving}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '登録中...' : '登録'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse flex gap-4">
              <div className="h-4 bg-gray-200 rounded w-1/3" />
              <div className="h-4 bg-gray-100 rounded w-1/4" />
            </div>
          ))}
        </div>
      ) : exceptions.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-sm">例外日はありません。臨時休業や部分営業を登録できます。</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">日付</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">種別</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">時間</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">メモ</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {exceptions.map((ex) => (
                <tr key={ex.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{formatDate(ex.date)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ex.type === 'closed' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                      {ex.type === 'closed' ? '臨時休業' : '部分営業'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                    {ex.type === 'partial' && ex.openTime && ex.closeTime
                      ? `${ex.openTime} 〜 ${ex.closeTime}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{ex.note ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(ex)}
                      className="px-2.5 py-1 text-xs font-medium text-red-600 bg-white border border-red-200 rounded hover:bg-red-50"
                    >
                      削除
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
