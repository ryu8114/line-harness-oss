'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { BookingMenu } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'

const DAY_DURATION_OPTIONS = [30, 60, 90, 120]

type FormState = {
  name: string
  duration: number
  price: string
  description: string
}

const EMPTY_FORM: FormState = { name: '', duration: 60, price: '', description: '' }

export default function BookingMenusPage() {
  const { selectedAccountId } = useAccount()
  const [menus, setMenus] = useState<BookingMenu[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const loadMenus = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError('')
    try {
      const res = await api.booking.getMenus(selectedAccountId)
      if (res.success) {
        setMenus(res.data)
      } else {
        setError('メニューの読み込みに失敗しました')
      }
    } catch {
      setError('メニューの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { loadMenus() }, [loadMenus])

  const openCreate = () => {
    setEditId(null)
    setForm(EMPTY_FORM)
    setFormError('')
    setShowForm(true)
  }

  const openEdit = (m: BookingMenu) => {
    setEditId(m.id)
    setForm({
      name: m.name,
      duration: m.duration,
      price: m.price !== null ? String(m.price) : '',
      description: m.description ?? '',
    })
    setFormError('')
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!selectedAccountId) return
    if (!form.name.trim()) { setFormError('メニュー名を入力してください'); return }
    setSaving(true)
    setFormError('')
    try {
      if (editId) {
        const res = await api.booking.updateMenu(editId, {
          name: form.name.trim(),
          duration: form.duration,
          price: form.price !== '' ? Number(form.price) : null,
          description: form.description.trim() || null,
        })
        if (!res.success) { setFormError('更新に失敗しました'); return }
      } else {
        const res = await api.booking.createMenu({
          lineAccountId: selectedAccountId,
          name: form.name.trim(),
          duration: form.duration,
          price: form.price !== '' ? Number(form.price) : undefined,
          description: form.description.trim() || undefined,
        })
        if (!res.success) { setFormError('作成に失敗しました'); return }
      }
      setShowForm(false)
      setEditId(null)
      loadMenus()
    } catch {
      setFormError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (m: BookingMenu) => {
    try {
      await api.booking.updateMenu(m.id, { isActive: m.isActive ? 0 : 1 })
      loadMenus()
    } catch {
      setError('ステータスの変更に失敗しました')
    }
  }

  const handleDelete = async (m: BookingMenu) => {
    if (!confirm(`「${m.name}」を削除しますか？`)) return
    try {
      await api.booking.deleteMenu(m.id)
      loadMenus()
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="メニュー管理"
        action={
          <button
            onClick={openCreate}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + メニュー追加
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
          <h2 className="text-sm font-semibold text-gray-800 mb-4">{editId ? 'メニューを編集' : '新規メニューを作成'}</h2>
          <div className="space-y-4 max-w-md">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">メニュー名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例: 骨盤矯正60分"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">施術時間 <span className="text-red-500">*</span></label>
              <select
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {DAY_DURATION_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d}分</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">料金（円・税込）</label>
              <input
                type="number"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="例: 6600"
                min="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">説明</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                placeholder="メニューの説明（任意）"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
              />
            </div>
            {formError && <p className="text-xs text-red-600">{formError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={() => { setShowForm(false); setEditId(null) }}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse flex gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/3" />
                <div className="h-3 bg-gray-100 rounded w-1/4" />
              </div>
              <div className="h-8 bg-gray-100 rounded w-20" />
            </div>
          ))}
        </div>
      ) : menus.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-sm">メニューがありません。「+ メニュー追加」から追加してください。</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">メニュー名</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">時間</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">料金</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">状態</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {menus.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {m.name}
                    {m.description && <p className="text-xs text-gray-400 mt-0.5 font-normal">{m.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{m.duration}分</td>
                  <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">
                    {m.price !== null ? `¥${m.price.toLocaleString()}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs ${m.isActive ? 'text-green-700' : 'text-gray-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${m.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                      {m.isActive ? '有効' : '無効'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(m)}
                        className="px-2.5 py-1 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-50"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => handleToggleActive(m)}
                        className="px-2.5 py-1 text-xs font-medium text-blue-600 bg-white border border-blue-200 rounded hover:bg-blue-50"
                      >
                        {m.isActive ? '無効化' : '有効化'}
                      </button>
                      <button
                        onClick={() => handleDelete(m)}
                        className="px-2.5 py-1 text-xs font-medium text-red-600 bg-white border border-red-200 rounded hover:bg-red-50"
                      >
                        削除
                      </button>
                    </div>
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
