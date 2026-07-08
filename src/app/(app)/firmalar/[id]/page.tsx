import Link from 'next/link'
import { notFound } from 'next/navigation'
import InvoiceActions from '@/components/InvoiceActions'
import { getSessionProfile, isStaffRole } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { SALE_TYPE_LABELS, eur, todayISO, trDate, trDateTime } from '@/lib/format'
import { currentRunId, type BalanceRow } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface InvoiceRow {
  id: string
  fis_no: string
  invoice_date: string
  belge_no_raw: string
  odeme_plani_raw: string
  sale_type: string
  sale_type_auto: string
  sale_type_override: string | null
  suggested_sale_type: string | null
  amount_eur_cents: number | null
  amount_eur_cents_override: number | null
  amount_tl: number | null
  plan_parse_status: string
  plan_parse_note: string | null
  is_31_12: boolean
  is_cancelled: boolean
  cancel_reason: string | null
  excluded_override: boolean | null
  is_excluded_firm: boolean
  is_allocatable: boolean
  needs_review: boolean
  raw_changed_after_override: boolean
}

interface InstRow {
  id: string
  invoice_id: string
  seq: number
  side: string
  due_date: string
  amount_eur_cents: number
  remaining_eur_cents: number | null
  source: string
  no_date_flag: boolean
}

interface PayRow {
  id: string
  islem_kodu: string
  sheet_side: string
  islem_tarihi: string | null
  gelen_tl: number | null
  doviz_eur_cents: number | null
  kur: number | null
  aciklama: string | null
  kayit_durumu: string | null
  is_alc: boolean
  allocatable: boolean
}

interface AllocRow {
  payment_id: string
  installment_id: string
  invoice_id: string
  amount_eur_cents: number
}

export default async function FirmaDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = (await getSessionProfile())!
  const staff = isStaffRole(session.role)
  const supabase = await createServerSupabase()

  const { data: firm } = await supabase
    .from('firms')
    .select('id, code_norm, code_raw, name, segment, city, phone, pazarlamaci_email, is_auto_created')
    .eq('id', id)
    .maybeSingle()
  if (!firm) notFound()

  const runId = await currentRunId(supabase)

  const [invoices, installments, payments, balances] = await Promise.all([
    fetchAll<InvoiceRow>((from, to) =>
      supabase
        .from('v_invoices_effective')
        .select(
          'id, fis_no, invoice_date, belge_no_raw, odeme_plani_raw, sale_type, sale_type_auto, sale_type_override, suggested_sale_type, amount_eur_cents, amount_eur_cents_override, amount_tl, plan_parse_status, plan_parse_note, is_31_12, is_cancelled, cancel_reason, excluded_override, is_excluded_firm, is_allocatable, needs_review, raw_changed_after_override',
        )
        .eq('firm_id', id)
        .order('invoice_date', { ascending: false })
        .order('fis_no', { ascending: false })
        .range(from, to),
    ),
    fetchAll<InstRow>((from, to) =>
      supabase
        .from('installments')
        .select('id, invoice_id, seq, side, due_date, amount_eur_cents, remaining_eur_cents, source, no_date_flag')
        .eq('firm_id', id)
        .order('due_date')
        .range(from, to),
    ),
    fetchAll<PayRow>((from, to) =>
      supabase
        .from('payments')
        .select('id, islem_kodu, sheet_side, islem_tarihi, gelen_tl, doviz_eur_cents, kur, aciklama, kayit_durumu, is_alc, allocatable')
        .eq('firm_id', id)
        .order('islem_tarihi', { ascending: false })
        .range(from, to),
    ),
    runId
      ? fetchAll<BalanceRow>((from, to) =>
          supabase
            .from('firm_side_balances')
            .select('firm_id, side, open_debt_eur_cents, overdue_eur_cents, credit_eur_cents, next_due_date, total_debt_eur_cents, total_paid_eur_cents')
            .eq('run_id', runId)
            .eq('firm_id', id)
            .order('side')
            .range(from, to),
        )
      : Promise.resolve([] as BalanceRow[]),
  ])

  const allocations = runId
    ? await fetchAll<AllocRow>((from, to) =>
        supabase
          .from('allocations')
          .select('payment_id, installment_id, invoice_id, amount_eur_cents')
          .eq('run_id', runId)
          .eq('firm_id', id)
          .order('id')
          .range(from, to),
      )
    : []

  const instByInvoice = new Map<string, InstRow[]>()
  for (const t of installments) {
    const arr = instByInvoice.get(t.invoice_id)
    if (arr) arr.push(t)
    else instByInvoice.set(t.invoice_id, [t])
  }
  const invoiceById = new Map(invoices.map((i) => [i.id, i]))
  const allocByPayment = new Map<string, AllocRow[]>()
  for (const a of allocations) {
    const arr = allocByPayment.get(a.payment_id)
    if (arr) arr.push(a)
    else allocByPayment.set(a.payment_id, [a])
  }

  const today = todayISO()
  const vadeli = balances.find((b) => b.side === 'VADELI')
  const pesin = balances.find((b) => b.side === 'PESIN')

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            {firm.code_norm} — {firm.name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {[firm.city, firm.segment && `Segment ${firm.segment}`, firm.phone, firm.pazarlamaci_email]
              .filter(Boolean)
              .join(' · ') || 'Detay bilgisi yok'}
          </p>
        </div>
        <Link href="/firmalar" className="text-sm text-blue-700 hover:underline">
          ← Firma listesi
        </Link>
      </div>

      {/* Bakiye kartları */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Konsinye Açık Borç</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{eur(vadeli?.open_debt_eur_cents ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Vadesi geçmiş: <span className="tabular-nums text-red-600">{eur(vadeli?.overdue_eur_cents ?? 0)}</span>
            {vadeli?.next_due_date && <> · İlk vade: {trDate(vadeli.next_due_date)}</>}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Peşin Açık Borç</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{eur(pesin?.open_debt_eur_cents ?? 0)}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Alacak (Vadeli)</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-600">{eur(vadeli?.credit_eur_cents ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">Sonraki vadeden düşülür</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Alacak (Peşin)</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-600">{eur(pesin?.credit_eur_cents ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">Sonraki peşin borçtan düşülür</p>
        </div>
      </div>

      {/* İrsaliyeler */}
      <section className="mt-8">
        <h2 className="font-semibold text-slate-900">İrsaliyeler ({invoices.length})</h2>
        <div className="mt-2 overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Fiş No</th>
                <th className="px-3 py-2">Tarih</th>
                <th className="px-3 py-2">Tip</th>
                <th className="px-3 py-2">Ödeme Planı</th>
                <th className="px-3 py-2 text-right">Tutar €</th>
                <th className="px-3 py-2 text-right">Kalan €</th>
                <th className="px-3 py-2">Durum</th>
                {staff && <th className="px-3 py-2 text-right">İşlem</th>}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const insts = instByInvoice.get(inv.id) ?? []
                const remaining = insts.reduce((s, t) => s + (t.remaining_eur_cents ?? 0), 0)
                return (
                  <tr key={inv.id} className={'border-b border-slate-100 ' + (inv.is_cancelled ? 'opacity-50' : '')}>
                    <td className="px-3 py-2 font-medium">{inv.fis_no}</td>
                    <td className="px-3 py-2">{trDate(inv.invoice_date)}</td>
                    <td className="px-3 py-2">
                      {SALE_TYPE_LABELS[inv.sale_type] ?? inv.sale_type}
                      {inv.sale_type_override && (
                        <span className="ml-1 rounded bg-blue-100 px-1 text-xs text-blue-700" title={`İçe aktarılan: ${SALE_TYPE_LABELS[inv.sale_type_auto]}`}>
                          düzenlendi
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500" title={inv.plan_parse_note ?? undefined}>
                      {inv.odeme_plani_raw || <span className="text-amber-600">tarih girilmedi</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {eur(inv.amount_eur_cents)}
                      {inv.amount_eur_cents_override !== null && (
                        <span className="ml-1 rounded bg-blue-100 px-1 text-xs text-blue-700">düzenlendi</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{inv.is_allocatable ? eur(remaining) : '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {inv.is_cancelled && <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700" title={inv.cancel_reason ?? ''}>İptal</span>}
                      {inv.is_31_12 && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-600" title="31 Aralık tarihli irsaliyeler sistemde dikkate alınmaz">31/12</span>}
                      {(inv.excluded_override ?? inv.is_excluded_firm) && !inv.is_31_12 && !inv.is_cancelled && (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-600">Takip dışı</span>
                      )}
                      {inv.sale_type === 'OTHER' && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">Sınıflandırma bekliyor</span>}
                      {inv.raw_changed_after_override && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700" title="Düzenleme sonrası içe aktarılan veri değişti — kontrol edin">Çakışma</span>
                      )}
                    </td>
                    {staff && (
                      <td className="px-3 py-2 text-right">
                        <InvoiceActions
                          invoice={{
                            id: inv.id,
                            fisNo: inv.fis_no,
                            saleType: inv.sale_type,
                            suggested: inv.suggested_sale_type,
                            amountEurCents: inv.amount_eur_cents,
                            isCancelled: inv.is_cancelled,
                            odemePlaniRaw: inv.odeme_plani_raw,
                            installments: insts.map((t) => ({ dueDate: t.due_date, amountCents: t.amount_eur_cents, source: t.source })),
                          }}
                        />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Açık taksitler */}
      <section className="mt-8" id="taksitler">
        <h2 className="font-semibold text-slate-900">Açık Taksitler</h2>
        <div className="mt-2 overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Vade</th>
                <th className="px-3 py-2">Fiş No</th>
                <th className="px-3 py-2">Taraf</th>
                <th className="px-3 py-2 text-right">Taksit €</th>
                <th className="px-3 py-2 text-right">Kalan €</th>
              </tr>
            </thead>
            <tbody>
              {installments
                .filter((t) => (t.remaining_eur_cents ?? 0) > 0)
                .map((t) => {
                  const inv = invoiceById.get(t.invoice_id)
                  const overdue = t.due_date < today
                  return (
                    <tr key={t.id} className="border-b border-slate-100">
                      <td className={'px-3 py-2 ' + (overdue ? 'font-semibold text-red-600' : '')}>
                        {trDate(t.due_date)}
                        {t.no_date_flag && <span className="ml-1 text-amber-500" title="Vade tarihi girilmedi — irsaliye tarihi kullanıldı">†</span>}
                      </td>
                      <td className="px-3 py-2">{inv?.fis_no}</td>
                      <td className="px-3 py-2">{t.side === 'PESIN' ? 'Peşin' : 'Konsinye'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{eur(t.amount_eur_cents)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{eur(t.remaining_eur_cents)}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Ödemeler ve eşleştirmeler */}
      <section className="mt-8">
        <h2 className="font-semibold text-slate-900">Ödemeler ({payments.length})</h2>
        <div className="mt-2 overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">İşlem Kodu</th>
                <th className="px-3 py-2">Tarih</th>
                <th className="px-3 py-2">Sayfa</th>
                <th className="px-3 py-2 text-right">EUR</th>
                <th className="px-3 py-2 text-right">TL</th>
                <th className="px-3 py-2">Eşleşen İrsaliyeler</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const allocs = allocByPayment.get(p.id) ?? []
                const allocated = allocs.reduce((s, a) => s + a.amount_eur_cents, 0)
                const unmatched = p.allocatable && p.doviz_eur_cents ? p.doviz_eur_cents - allocated : 0
                return (
                  <tr key={p.id} className={'border-b border-slate-100 ' + (!p.allocatable ? 'opacity-60' : '')}>
                    <td className="px-3 py-2 font-medium">
                      {p.islem_kodu}
                      {p.is_alc && <span className="ml-1 rounded bg-slate-200 px-1 text-xs text-slate-600" title="Eski sistemin alacak kaydı — tahsise girmez">ALC</span>}
                      {!p.is_alc && !p.allocatable && (
                        <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-700">Tamamlanmamış</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{p.islem_tarihi ? trDate(p.islem_tarihi.slice(0, 10)) : '—'}</td>
                    <td className="px-3 py-2">{p.sheet_side === 'PESIN' ? 'Peşin' : 'Vadeli'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(p.doviz_eur_cents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {p.gelen_tl !== null ? Number(p.gelen_tl).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {allocs.map((a) => {
                        const inv = invoiceById.get(a.invoice_id)
                        return (
                          <span key={a.installment_id} className="mr-2 whitespace-nowrap">
                            {inv?.fis_no}: <span className="tabular-nums">{eur(a.amount_eur_cents)}</span>
                          </span>
                        )
                      })}
                      {unmatched > 0 && (
                        <span className="whitespace-nowrap rounded bg-emerald-50 px-1 text-emerald-700">
                          Alacak: <span className="tabular-nums">{eur(unmatched)}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Eşleştirmeler her içe aktarma/düzenleme sonrası FIFO kuralıyla otomatik yeniden hesaplanır: peşin ödemeler en eski
          peşin borçtan, vadeli ödemeler en erken vadeli konsinye taksitinden düşülür. Son güncelleme: {trDateTime(new Date().toISOString())}
        </p>
      </section>
    </div>
  )
}
