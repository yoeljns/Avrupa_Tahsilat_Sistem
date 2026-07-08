'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function RecomputeButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/recompute', { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? 'Hesaplama başarısız.')
        return
      }
      router.refresh()
    } catch {
      setError('Sunucuya ulaşılamadı.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? 'Hesaplanıyor…' : 'Yeniden Hesapla'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}
