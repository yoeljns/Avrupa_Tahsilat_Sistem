'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

// Sınıflandırma bekleyen (OTHER) irsaliyeler için toplu onay tablosu.

export interface ReviewRow {
  id: string
  fisNo: string
  firmCode: string
  firmName: string
  invoiceDate: string
  belgeNo: string
  amountEur: string
  suggested: string | null
  reason: string | null
}

const TYPES = [
  { value: 'PESIN', label: 'Peşin' },
  { value: 'KONSINYE', label: 'Konsinye' },
  { value: 'KONSINYE_PESIN', label: 'Konsinye Peşin' },
]

export default function ReviewClassifyTable({ rows }: { rows: ReviewRow[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosenCount = useMemo(() => Object.keys(selected).length, [selected])

  function setChoice(id: string, value: string) {
    setSelected((s) => {
      const next = { ...s }
      if (value) next[id] = value
      else delete next[id]
      return next
    })
  }

  function applySuggestions() {
    const next: Record<string, string> = { ...selected }
    for (const r of rows) if (r.suggested && !next[r.id]) next[r.id] = r.suggested
    setSelected(next)
  }

  async function apply() {
    const items = Object.entries(selected).map(([invoiceId, saleType]) => ({ invoiceId, saleType }))
    if (items.length === 0) {
      setError('Önce en az bir irsaliye için tip seçin.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/review/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? 'Sınıflandırma başarısız.')
        return
      }
      setSelected({})
      router.refresh()
    } catch {
      setError('Sunucuya ulaşılamadı.')
    } finally {
      setBusy(false)
    }
  }

  if (rows.length === 0) {
    return <p className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm">Sınıflandırma bekleyen irsaliye yok. 🎉</p>
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={applySuggestions}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Önerileri doldur
        </button>
        <button
          onClick={apply}
          disabled={busy || chosenCount === 0}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Uygulanıyor…' : `Seçilenleri Onayla (${chosenCount})`}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Fiş No</th>
              <th className="px-3 py-2">Firma</th>
              <th className="px-3 py-2">Tarih</th>
              <th className="px-3 py-2">Belge No</th>
              <th className="px-3 py-2 text-right">Tutar €</th>
              <th className="px-3 py-2">Açıklama</th>
              <th className="px-3 py-2">Tip Seçimi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium">{r.fisNo}</td>
                <td className="px-3 py-2">
                  {r.firmCode} <span className="text-slate-500">{r.firmName.slice(0, 22)}</span>
                </td>
                <td className="px-3 py-2">{r.invoiceDate}</td>
                <td className="px-3 py-2 text-slate-500">{r.belgeNo || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.amountEur}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{r.reason}</td>
                <td className="px-3 py-2">
                  <select
                    value={selected[r.id] ?? ''}
                    onChange={(e) => setChoice(r.id, e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="">— seçin —</option>
                    {TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                        {r.suggested === t.value ? ' (önerilen)' : ''}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
