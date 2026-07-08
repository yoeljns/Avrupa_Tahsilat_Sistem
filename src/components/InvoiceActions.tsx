'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { formatCents } from '@/lib/engine/money'

// Tahsilat Yöneticisi'nin irsaliye düzenleme modalı.
// Yapılan her değişiklik sunucuda denetim kaydına işlenir ve mutabakat
// otomatik yeniden hesaplanır.

interface InstallmentDraft {
  dueDate: string
  amountEur: string
}

interface InvoiceActionsProps {
  invoice: {
    id: string
    fisNo: string
    saleType: string
    suggested: string | null
    amountEurCents: number | null
    isCancelled: boolean
    odemePlaniRaw: string
    installments: Array<{ dueDate: string; amountCents: number; source: string }>
  }
}

const TYPE_OPTIONS = [
  { value: 'PESIN', label: 'Peşin' },
  { value: 'KONSINYE', label: 'Konsinye' },
  { value: 'KONSINYE_PESIN', label: 'Konsinye Peşin' },
]

export default function InvoiceActions({ invoice }: InvoiceActionsProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [saleType, setSaleType] = useState(invoice.saleType)
  const [amountEur, setAmountEur] = useState(invoice.amountEurCents !== null ? formatCents(invoice.amountEurCents) : '')
  const [plan, setPlan] = useState('')
  const [reason, setReason] = useState('')
  const [editInstallments, setEditInstallments] = useState(false)
  const [drafts, setDrafts] = useState<InstallmentDraft[]>(
    invoice.installments.map((t) => ({ dueDate: t.dueDate, amountEur: formatCents(t.amountCents) })),
  )
  const [cancelMode, setCancelMode] = useState(false)

  function close() {
    setOpen(false)
    setError(null)
    setCancelMode(false)
  }

  async function send(path: string, method: string, body: unknown): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? 'İşlem başarısız.')
        return false
      }
      return true
    } catch {
      setError('Sunucuya ulaşılamadı.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    // 1) Alan değişiklikleri
    const patch: Record<string, unknown> = {}
    if (saleType !== invoice.saleType) patch.saleType = saleType
    const currentAmount = invoice.amountEurCents !== null ? formatCents(invoice.amountEurCents) : ''
    if (amountEur.trim() && amountEur.trim() !== currentAmount) patch.amountEur = amountEur.trim()
    if (plan.trim()) patch.plan = plan.trim()
    if (reason.trim()) patch.reason = reason.trim()

    const hasPatch = Object.keys(patch).some((k) => k !== 'reason')
    if (hasPatch) {
      const ok = await send(`/api/invoices/${invoice.id}`, 'PATCH', patch)
      if (!ok) return
    }

    // 2) Manuel taksitler
    if (editInstallments) {
      const ok = await send(`/api/invoices/${invoice.id}/installments`, 'PUT', {
        installments: drafts,
        reason: reason.trim() || undefined,
      })
      if (!ok) return
    }

    if (!hasPatch && !editInstallments) {
      setError('Değişiklik yapmadınız.')
      return
    }
    close()
    router.refresh()
  }

  async function doCancel(undo: boolean) {
    if (!undo && !reason.trim()) {
      setError('İptal için sebep zorunludur.')
      return
    }
    const ok = await send(`/api/invoices/${invoice.id}`, 'PATCH', {
      cancelled: !undo,
      reason: reason.trim() || undefined,
    })
    if (!ok) return
    close()
    router.refresh()
  }

  function setDraft(i: number, field: keyof InstallmentDraft, value: string) {
    setDrafts((d) => d.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)))
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
      >
        Düzenle
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900">İrsaliye Düzenle — {invoice.fisNo}</h3>

            {!cancelMode ? (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Satış Tipi</label>
                  <select
                    value={saleType}
                    onChange={(e) => setSaleType(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {invoice.saleType === 'OTHER' && <option value="OTHER">Sınıflandırılmadı</option>}
                    {TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                        {invoice.suggested === o.value ? ' (önerilen)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">Tutar (EUR)</label>
                  <input
                    value={amountEur}
                    onChange={(e) => setAmountEur(e.target.value)}
                    placeholder="51.414,86"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    Vade Planı <span className="font-normal text-slate-400">(boş bırakılırsa değişmez)</span>
                  </label>
                  <input
                    value={plan}
                    onChange={(e) => setPlan(e.target.value)}
                    placeholder={invoice.odemePlaniRaw || 'örn: 05/3-4-5 veya 05.03.2026'}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    Biçimler: <code>05.03.2026</code> · <code>05/3-4-5</code> (aylar) · <code>05/ 4--8--12</code> (aralık) ·{' '}
                    <code>NAKİT</code>
                  </p>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={editInstallments}
                      onChange={(e) => setEditInstallments(e.target.checked)}
                    />
                    Taksitleri elle düzenle (tutarlar toplamı irsaliye tutarına eşit olmalı)
                  </label>
                  {editInstallments && (
                    <div className="mt-2 space-y-2">
                      {drafts.map((d, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="date"
                            value={d.dueDate}
                            onChange={(e) => setDraft(i, 'dueDate', e.target.value)}
                            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                          />
                          <input
                            value={d.amountEur}
                            onChange={(e) => setDraft(i, 'amountEur', e.target.value)}
                            className="w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm tabular-nums"
                          />
                          <button
                            onClick={() => setDrafts((rows) => rows.filter((_, idx) => idx !== i))}
                            className="text-sm text-red-500 hover:text-red-700"
                            title="Taksiti sil"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => setDrafts((rows) => [...rows, { dueDate: '', amountEur: '0,00' }])}
                        className="text-sm font-medium text-blue-700 hover:underline"
                      >
                        + Taksit ekle
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    Sebep <span className="font-normal text-slate-400">(denetim kaydına yazılır)</span>
                  </label>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <button
                    onClick={() => setCancelMode(true)}
                    className="text-sm font-medium text-red-600 hover:underline"
                  >
                    {invoice.isCancelled ? 'İptali geri al…' : 'İrsaliyeyi iptal et…'}
                  </button>
                  <div className="flex gap-2">
                    <button onClick={close} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
                      Vazgeç
                    </button>
                    <button
                      onClick={save}
                      disabled={busy}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {busy ? 'Kaydediliyor…' : 'Kaydet'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <p className="text-sm text-slate-600">
                  {invoice.isCancelled
                    ? 'İptal geri alınacak; irsaliye tekrar borç hesabına girecek.'
                    : 'İrsaliye iptal edilecek; borç hesabından tamamen çıkacak. Bu işlem denetim kaydına işlenir.'}
                </p>
                {!invoice.isCancelled && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Sebep (zorunlu)</label>
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                )}
                {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setCancelMode(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
                    Geri
                  </button>
                  <button
                    onClick={() => doCancel(invoice.isCancelled)}
                    disabled={busy}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {busy ? 'İşleniyor…' : invoice.isCancelled ? 'İptali Geri Al' : 'İptal Et'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
