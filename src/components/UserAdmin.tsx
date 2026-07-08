'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

// Kullanıcı yönetim paneli (yalnız yönetici).

export interface UserRow {
  id: string
  email: string
  fullName: string | null
  role: string
  isActive: boolean
}

const ROLES = [
  { value: 'pazarlamaci', label: 'Pazarlamacı' },
  { value: 'tahsilat_yoneticisi', label: 'Tahsilat Yöneticisi' },
  { value: 'yonetici', label: 'Yönetici' },
]

export default function UserAdmin({ users, selfId }: { users: UserRow[]; selfId: string }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('pazarlamaci')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function call(body: unknown): Promise<{ ok: boolean; tempPassword?: string; error?: string }> {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) return { ok: false, error: data?.error ?? 'İşlem başarısız.' }
      return { ok: true, tempPassword: data?.tempPassword }
    } catch {
      return { ok: false, error: 'Sunucuya ulaşılamadı.' }
    } finally {
      setBusy(false)
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    const r = await call({ action: 'create', email, fullName: fullName || undefined, role })
    if (!r.ok) {
      setMessage({ ok: false, text: r.error! })
      return
    }
    setMessage({ ok: true, text: `${email} oluşturuldu. Geçici şifre: ${r.tempPassword} — bu şifreyi şimdi kopyalayıp iletin; bir daha gösterilmez.` })
    setEmail('')
    setFullName('')
    router.refresh()
  }

  async function updateUser(userId: string, patch: Record<string, unknown>, label: string) {
    const r = await call({ action: 'update', userId, ...patch })
    if (!r.ok) {
      setMessage({ ok: false, text: r.error! })
      return
    }
    setMessage({
      ok: true,
      text: r.tempPassword ? `${label} — yeni geçici şifre: ${r.tempPassword} (bir daha gösterilmez)` : `${label} tamamlandı.`,
    })
    router.refresh()
  }

  return (
    <div>
      <form onSubmit={createUser} className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">Yeni Kullanıcı</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500">E-posta</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="kisi@avrupagroup.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Ad Soyad</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Rol</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Oluştur
          </button>
        </div>
      </form>

      {message && (
        <p className={'mt-3 rounded-lg px-3 py-2 text-sm ' + (message.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>
          {message.text}
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">E-posta</th>
              <th className="px-3 py-2">Ad</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Durum</th>
              <th className="px-3 py-2 text-right">İşlemler</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={'border-b border-slate-100 ' + (!u.isActive ? 'opacity-50' : '')}>
                <td className="px-3 py-2 font-medium">{u.email}</td>
                <td className="px-3 py-2">{u.fullName ?? '—'}</td>
                <td className="px-3 py-2">
                  <select
                    value={u.role}
                    disabled={busy || u.id === selfId}
                    onChange={(e) => updateUser(u.id, { role: e.target.value }, 'Rol değişikliği')}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">{u.isActive ? 'Aktif' : 'Pasif'}</td>
                <td className="px-3 py-2 text-right">
                  <span className="inline-flex gap-2">
                    <button
                      onClick={() => updateUser(u.id, { resetPassword: true }, 'Şifre sıfırlama')}
                      disabled={busy}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                    >
                      Şifre sıfırla
                    </button>
                    {u.id !== selfId && (
                      <button
                        onClick={() => updateUser(u.id, { isActive: !u.isActive }, u.isActive ? 'Pasifleştirme' : 'Aktifleştirme')}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                      >
                        {u.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Pazarlamacılar yalnız bayi listesinde kendi e-postalarına atanmış firmaların borçlarını görür. Tahsilat
        Yöneticisi tüm firmaları görür, irsaliye düzenleyebilir ve Excel raporu indirebilir.
      </p>
    </div>
  )
}
