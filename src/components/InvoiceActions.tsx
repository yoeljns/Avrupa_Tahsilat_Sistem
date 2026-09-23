'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Ban, Pencil, Plus, Undo2, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import Modal from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatCents } from '@/lib/engine/money'
import { DAVRANISLAR, SINIFSIZ_KOD, atanabilirKategoriler, davranisOf, kategoriBul, type KategoriMeta } from '@/lib/kategoriMeta'

// Tahsilat Yöneticisi'nin irsaliye düzenleme penceresi.
// Yapılan her değişiklik sunucuda denetim kaydına işlenir ve ilgili firma
// yeniden hesaplanır.

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
    /** Yöneticinin daha önce girdiği plan (varsa) — ham plandan önceliklidir */
    planOverride?: string | null
    installments: Array<{ dueDate: string; amountCents: number; source: string }>
  }
  /** Satış kategorileri (yönetim panelinden); yoksa varsayılanlar */
  kategoriler?: readonly KategoriMeta[]
}

function trTarih(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}.${m}.${y}` : iso
}

export default function InvoiceActions({ invoice, kategoriler }: InvoiceActionsProps) {
  const router = useRouter()
  const toast = useToast()
  const etkinPlan = invoice.planOverride ?? invoice.odemePlaniRaw
  const elleTaksit = invoice.installments.some((t) => t.source === 'manual')
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

  const secenekler = atanabilirKategoriler(kategoriler, invoice.saleType)
  const secili = kategoriBul(kategoriler, saleType)
  const hesapDisi = saleType === SINIFSIZ_KOD || (!!secili && secili.taraf === null)

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
    const taksitDuzenle = editInstallments && !hesapDisi
    if (!hasPatch && !taksitDuzenle) {
      setError('Değişiklik yapmadınız.')
      return
    }
    if (hasPatch) {
      const ok = await send(`/api/invoices/${invoice.id}`, 'PATCH', patch)
      if (!ok) return
    }

    // 2) Elle taksitler
    if (taksitDuzenle) {
      const ok = await send(`/api/invoices/${invoice.id}/installments`, 'PUT', {
        installments: drafts,
        reason: reason.trim() || undefined,
      })
      if (!ok) return
    }

    close()
    toast(`${invoice.fisNo} kaydedildi; firma yeniden hesaplandı.`)
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
    toast(undo ? `${invoice.fisNo} iptali geri alındı.` : `${invoice.fisNo} iptal edildi.`)
    router.refresh()
  }

  function setDraft(i: number, field: keyof InstallmentDraft, value: string) {
    setDrafts((d) => d.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)))
  }

  return (
    <>
      <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => setOpen(true)}>
        Düzenle
      </Button>

      <Modal
        acik={open}
        onKapat={close}
        kapatilamaz={busy}
        baslik={cancelMode ? (invoice.isCancelled ? `İptali geri al — ${invoice.fisNo}` : `İrsaliyeyi iptal et — ${invoice.fisNo}`) : `İrsaliye düzenle — ${invoice.fisNo}`}
        altBilgi={
          cancelMode ? (
            <>
              <Button onClick={() => setCancelMode(false)} disabled={busy}>
                Geri
              </Button>
              <Button variant="danger" onClick={() => doCancel(invoice.isCancelled)} loading={busy}>
                {invoice.isCancelled ? 'İptali geri al' : 'İptal et'}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                className="mr-auto"
                icon={invoice.isCancelled ? <Undo2 className="h-4 w-4" aria-hidden="true" /> : <Ban className="h-4 w-4" aria-hidden="true" />}
                onClick={() => setCancelMode(true)}
                disabled={busy}
              >
                {invoice.isCancelled ? 'İptali geri al…' : 'İptal et…'}
              </Button>
              <Button onClick={close} disabled={busy}>
                Vazgeç
              </Button>
              <Button variant="primary" onClick={save} loading={busy}>
                Kaydet
              </Button>
            </>
          )
        }
      >
        {!cancelMode ? (
          <div className="space-y-4">
            <Field
              label="Satış kategorisi"
              hint={
                secili && saleType !== SINIFSIZ_KOD
                  ? `${DAVRANISLAR[davranisOf(secili.taraf)].ad} — ${DAVRANISLAR[davranisOf(secili.taraf)].sayfa ?? 'borç hesabına girmez'}`
                  : 'Sınıflandırılmamış irsaliye borç hesabına girmez.'
              }
            >
              <Select value={saleType} onChange={(e) => setSaleType(e.target.value)}>
                {invoice.saleType === SINIFSIZ_KOD && <option value={SINIFSIZ_KOD}>Sınıflandırılmadı</option>}
                {secenekler.map((o) => (
                  <option key={o.kod} value={o.kod}>
                    {o.ad}
                    {invoice.suggested === o.kod ? ' (önerilen)' : ''}
                    {o.aktif ? '' : ' (pasif)'}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Tutar (EUR)">
              <Input value={amountEur} onChange={(e) => setAmountEur(e.target.value)} placeholder="51.414,86" className="tabular-nums" inputMode="decimal" />
            </Field>

            <Field
              label={
                <>
                  Vade planı <span className="font-normal text-slate-400">(boş bırakılırsa değişmez)</span>
                </>
              }
              hint={
                <>
                  Biçimler: <code>05.03.2026</code> · <code>05/3-4-5</code> (aylar) · <code>05/ 4--8--12</code> (aralık) · <code>05/ 11-12-1</code> (yıl geçişi) ·{' '}
                  <code>NAKİT</code>
                  {elleTaksit && ' — Yeni plan girerseniz elle girilen taksitler bu plana göre yeniden kurulur.'}
                </>
              }
            >
              <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <div>
                  Şu anki plan: <strong>{etkinPlan || '— (tarih girilmedi)'}</strong>
                  {invoice.planOverride != null && <span className="ml-1 text-blue-700">(düzenlenmiş)</span>}
                </div>
                {invoice.installments.length > 0 && (
                  <div className="mt-0.5">
                    Mevcut vadeler: {invoice.installments.map((t) => trTarih(t.dueDate)).join(' · ')}
                    {elleTaksit && <span className="ml-1 text-blue-700">(elle girilmiş)</span>}
                  </div>
                )}
              </div>
              <Input value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="örn: 05/3-4-5 veya 05.03.2026" />
            </Field>

            <div>
              <label className={'flex items-center gap-2 text-sm font-medium ' + (hesapDisi ? 'text-slate-400' : 'text-slate-700')}>
                <input
                  type="checkbox"
                  checked={editInstallments && !hesapDisi}
                  disabled={hesapDisi}
                  onChange={(e) => setEditInstallments(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Taksitleri elle düzenle (tutarlar toplamı irsaliye tutarına eşit olmalı)
              </label>
              {hesapDisi && <p className="mt-1 text-xs text-slate-500">Seçili kategori borç hesabına girmediği için taksit girilmez.</p>}
              {editInstallments && !hesapDisi && (
                <div className="mt-2 space-y-2">
                  {drafts.map((d, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input type="date" boyut="sm" tam={false} value={d.dueDate} onChange={(e) => setDraft(i, 'dueDate', e.target.value)} aria-label={`${i + 1}. taksit tarihi`} />
                      <Input
                        boyut="sm"
                        tam={false}
                        value={d.amountEur}
                        onChange={(e) => setDraft(i, 'amountEur', e.target.value)}
                        className="w-32 tabular-nums"
                        inputMode="decimal"
                        aria-label={`${i + 1}. taksit tutarı`}
                      />
                      <button
                        type="button"
                        onClick={() => setDrafts((rows) => rows.filter((_, idx) => idx !== i))}
                        className="rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-700"
                        title="Taksiti sil"
                        aria-label={`${i + 1}. taksiti sil`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setDrafts((rows) => [...rows, { dueDate: '', amountEur: '0,00' }])}>
                    Taksit ekle
                  </Button>
                </div>
              )}
            </div>

            <Field
              label={
                <>
                  Sebep <span className="font-normal text-slate-400">(denetim kaydına yazılır)</span>
                </>
              }
            >
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {invoice.isCancelled
                ? 'İptal geri alınacak; irsaliye tekrar borç hesabına girecek.'
                : 'İrsaliye iptal edilecek; borç hesabından tamamen çıkacak. Bu işlem denetim kaydına işlenir.'}
            </p>
            {!invoice.isCancelled && (
              <Field label="Sebep (zorunlu)">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
              </Field>
            )}
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
        )}
      </Modal>
    </>
  )
}
