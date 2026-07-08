'use client'

import { useState } from 'react'

export default function HesapPage() {
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== password2) {
      setMessage({ ok: false, text: 'Şifreler birbirini tutmuyor.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setMessage({ ok: false, text: body?.error ?? 'Şifre değiştirilemedi.' })
        return
      }
      setMessage({ ok: true, text: 'Şifreniz güncellendi.' })
      setPassword('')
      setPassword2('')
    } catch {
      setMessage({ ok: false, text: 'Sunucuya ulaşılamadı.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-md">
      <h1 className="text-lg font-bold text-slate-900">Hesap</h1>
      <p className="mt-1 text-sm text-slate-500">Şifrenizi buradan değiştirebilirsiniz.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-2xl bg-white p-6 shadow">
        <div>
          <label className="block text-sm font-medium text-slate-700">Yeni şifre</label>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Yeni şifre (tekrar)</label>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        {message && (
          <p
            className={
              'rounded-lg px-3 py-2 text-sm ' +
              (message.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')
            }
          >
            {message.text}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Kaydediliyor…' : 'Şifreyi Değiştir'}
        </button>
      </form>
    </div>
  )
}
