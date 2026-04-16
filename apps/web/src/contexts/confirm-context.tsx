'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

type ConfirmOptions = {
  message: string
  title?: string
  confirmLabel?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn>(async () => false)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    open: boolean
    message: string
    title?: string
    confirmLabel: string
    danger: boolean
    resolve?: (v: boolean) => void
  }>({ open: false, message: '', confirmLabel: 'OK', danger: false })

  const confirm = useCallback((opts: ConfirmOptions | string): Promise<boolean> => {
    const { message, title, confirmLabel = 'OK', danger = false } =
      typeof opts === 'string' ? { message: opts } : opts
    return new Promise((resolve) => {
      setState({ open: true, message, title, confirmLabel, danger, resolve })
    })
  }, [])

  const handleClose = (value: boolean) => {
    state.resolve?.(value)
    setState((prev) => ({ ...prev, open: false }))
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => handleClose(false)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            {state.title && (
              <h3 className="text-base font-semibold text-gray-900 mb-2">{state.title}</h3>
            )}
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{state.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => handleClose(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                キャンセル
              </button>
              <button
                onClick={() => handleClose(true)}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg ${
                  state.danger ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
                }`}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export const useConfirm = () => useContext(ConfirmContext)
