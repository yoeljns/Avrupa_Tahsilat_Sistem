'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/** Çakışma/inceleme bayrağını kapatır (kontrol edildi işareti). */
export default function ClearReviewButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function clear() {
    setBusy(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearReviewFlag: true }),
      })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={clear}
      disabled={busy}
      className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
    >
      {busy ? '…' : 'Kontrol edildi'}
    </button>
  )
}
