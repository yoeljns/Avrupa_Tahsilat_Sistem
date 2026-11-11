'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'

/** Çakışma/inceleme bayrağını kapatır (kontrol edildi işareti). */
export default function ClearReviewButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function clear() {
    setBusy(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearReviewFlag: true }),
      })
      if (!res.ok) {
        const r = (await res.json().catch(() => ({}))) as { error?: string }
        toast(r.error ?? 'İşaret kaldırılamadı.', 'hata')
        return
      }
      toast('Kontrol edildi olarak işaretlendi.')
      router.refresh()
    } catch {
      toast('Sunucuya ulaşılamadı; işaret kaldırılmadı.', 'hata')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={clear}
      disabled={busy}
      className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
    >
      {busy ? '…' : 'Kontrol edildi'}
    </button>
  )
}
