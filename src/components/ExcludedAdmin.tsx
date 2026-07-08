'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export interface ExcludedRow {
  code: string
  note: string | null
  addedBy: string | null
}

export default function ExcludedAdmin({ rows }: { rows: ExcludedRow[] }) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(action: 'add' | 'remove', c: string, n?: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/excluded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, code: c, note: n || undefined }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? 'İşlem başarısız.')
        return
      }
      setCode('')
      setNote('')
      router.refresh()
    } catch {
      setError('Sunucuya ulaşılamadı.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (code.trim()) call('add', code.trim(), note.trim())
        }}
        className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-5 shadow-sm"
      >
        <div>
          <label className="block text-xs font-medium text-slate-500">Firma Kodu</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="örn: 99 X01"
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grow">
          <label className="block text-xs font-medium text-slate-500">Not</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Kaydediliyor…' : 'Ekle'}
        </button>
      </form>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Kod</th>
              <th className="px-3 py-2">Not</th>
              <th className="px-3 py-2">Ekleyen</th>
              <th className="px-3 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium">{r.code}</td>
                <td className="px-3 py-2 text-slate-500">{r.note ?? ''}</td>
                <td className="px-3 py-2 text-slate-500">{r.addedBy ?? ''}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => call('remove', r.code)}
                    disabled={busy}
                    className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    Listeden çıkar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
