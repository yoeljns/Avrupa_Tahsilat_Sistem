'use client'

import { useState } from 'react'

interface CreatedUser {
  email: string
  role: string
  tempPassword: string
}

export default function SetupPage() {
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<CreatedUser[] | null>(null)
  const [copied, setCopied] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? 'Kurulum başarısız oldu.')
        return
      }
      setUsers(body.users)
    } catch {
      setError('Sunucuya ulaşılamadı.')
    } finally {
      setBusy(false)
    }
  }

  function copyAll() {
    if (!users) return
    const text = users.map((u) => `${u.email}  |  ${u.tempPassword}  |  ${u.role}`).join('\n')
    navigator.clipboard.writeText(text).then(() => setCopied(true))
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="text-xl font-bold text-slate-900">Sistem Kurulumu</h1>

        {!users && (
          <>
            <p className="mt-2 text-sm text-slate-600">
              Bu sihirbaz başlangıç kullanıcılarını oluşturur: <strong>yy@avrupagroup.com</strong> (yönetici) ve 5
              pazarlamacı hesabı. Devam etmek için Vercel ortam değişkenlerinde tanımladığınız{' '}
              <code className="rounded bg-slate-100 px-1">SETUP_SECRET</code> değerini girin.
            </p>
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <input
                type="password"
                required
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Kurulum anahtarı (SETUP_SECRET)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? 'Kurulum yapılıyor…' : 'Kurulumu Başlat'}
              </button>
            </form>
          </>
        )}

        {users && (
          <div className="mt-4">
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              ⚠️ Geçici şifreler yalnızca <strong>bir kez</strong> gösterilir. Kopyalayıp güvenli bir yerde saklayın ve
              kullanıcılara iletin. Herkes ilk girişten sonra <strong>Hesap</strong> sayfasından şifresini
              değiştirmelidir.
            </p>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2">E-posta</th>
                  <th className="py-2">Geçici Şifre</th>
                  <th className="py-2">Rol</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.email} className="border-b border-slate-100">
                    <td className="py-2">{u.email}</td>
                    <td className="py-2 font-mono">{u.tempPassword}</td>
                    <td className="py-2">{u.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex gap-3">
              <button
                onClick={copyAll}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                {copied ? 'Kopyalandı ✓' : 'Tümünü Kopyala'}
              </button>
              <a
                href="/login"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Giriş sayfasına git
              </a>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
