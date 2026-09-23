import Link from 'next/link'
import { notFound } from 'next/navigation'
import InvoiceActions from '@/components/InvoiceActions'
import MigrationNeeded, { isMissingRelationError } from '@/components/MigrationNeeded'
import { getSessionProfile, isStaffRole } from '@/lib/auth'
import { SALE_TYPE_LABELS, eur, todayISO, trDate } from '@/lib/format'
import { firmaDetay, type FirmaDetay, type FirmaDetayTahsis, type FirmaDetayTaksit } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** Vade listesini kısa yazar: aynı yıldaki tarihler '05.03 · 05.04 · 05.05.2026' */
function vadeListesi(taksitler: FirmaDetayTaksit[]): string {
  if (taksitler.length === 0) return ''
  const tarihler = taksitler.map((t) => t.due_date).sort()
  const yillar = new Set(tarihler.map((d) => d.slice(0, 4)))
  if (yillar.size === 1 && tarihler.length > 1) {
    const kisa = tarihler.map((d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`)
    return kisa.join(' · ') + '.' + tarihler[0].slice(0, 4)
  }
  return tarihler.map((d) => trDate(d)).join(' · ')
}

export default async function FirmaDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const session = (await getSessionProfile())!
  const staff = isStaffRole(session.role)
  const supabase = await createServerSupabase()

  // TEK ağ turu: firma + irsaliyeler + taksitler + ödemeler + tahsisler + bakiye
  let veri: FirmaDetay | null
  try {
    veri = await firmaDetay(supabase, id)
  } catch (e) {
    if (isMissingRelationError(e)) return <MigrationNeeded />
    throw e
  }
  if (!veri) notFound()

  const { firma: firm, irsaliyeler: invoices, taksitler: installments, odemeler: payments, tahsisler: allocations } = veri
  const bal = veri.bakiye

  const instByInvoice = new Map<string, FirmaDetayTaksit[]>()
  for (const t of installments) {
    const arr = instByInvoice.get(t.invoice_id)
    if (arr) arr.push(t)
    else instByInvoice.set(t.invoice_id, [t])
  }
  const invoiceById = new Map(invoices.map((i) => [i.id, i]))
  const allocByPayment = new Map<string, FirmaDetayTahsis[]>()
  for (const a of allocations) {
    const arr = allocByPayment.get(a.payment_id)
    if (arr) arr.push(a)
    else allocByPayment.set(a.payment_id, [a])
  }

  // Vadesi geçmiş ve ilk vade BUGÜNE göre canlı hesaplanır (son hesap anına göre değil)
  const today = todayISO()
  const acikVadeli = installments.filter((t) => t.side === 'VADELI' && (t.remaining_eur_cents ?? 0) > 0)
  const gecikmis = acikVadeli.filter((t) => t.due_date < today).reduce((s, t) => s + (t.remaining_eur_cents ?? 0), 0)
  const ilkVade = acikVadeli.map((t) => t.due_date).sort()[0] ?? null

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
          <p className="mt-2 text-2xl font-bold tabular-nums">{eur(bal?.vadeli_open_eur_cents ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">
            Vadesi geçmiş: <span className="tabular-nums text-red-600">{eur(gecikmis)}</span>
            {ilkVade && <> · İlk vade: {trDate(ilkVade)}</>}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Peşin Açık Borç</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{eur(bal?.pesin_open_eur_cents ?? 0)}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Toplam Ödeme</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-600">{eur(bal?.total_paid_eur_cents ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">Tahsise giren ödemeler (eşleşen KDV 1/5 dahil)</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Alacak</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-600">{eur(bal?.credit_eur_cents ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-500">Fazla ödeme — bir sonraki borçtan düşülür</p>
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
                <th className="px-3 py-2">Vade / Plan</th>
                <th className="px-3 py-2 text-right">Tutar €</th>
                <th className="px-3 py-2 text-right">Kalan €</th>
                <th className="px-3 py-2">Durum</th>
                {staff && <th className="px-3 py-2 text-right">İşlem</th>}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const insts = (instByInvoice.get(inv.id) ?? []).slice().sort((a, b) => a.seq - b.seq)
                const remaining = insts.reduce((s, t) => s + (t.remaining_eur_cents ?? 0), 0)
                const elle = insts.some((t) => t.source === 'manual')
                const tarihsiz = insts.some((t) => t.no_date_flag)
                const etkinPlan = inv.plan_override_note ?? inv.odeme_plani_raw
                return (
                  <tr key={inv.id} className={'border-b border-slate-100 align-top ' + (inv.is_cancelled ? 'opacity-50' : '')}>
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
                    <td className="px-3 py-2" title={inv.plan_parse_note ?? undefined}>
                      {/* Gerçek vade tarihleri (taksitlerden) — düzenleme anında burada görünür */}
                      {insts.length > 0 ? (
                        <span className={'tabular-nums ' + (tarihsiz ? 'text-amber-600' : 'text-slate-800')}>{vadeListesi(insts)}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                      <div className="mt-0.5 text-xs text-slate-500">
                        {elle ? (
                          <span className="rounded bg-blue-100 px-1 text-blue-700" title={`Dosyadaki plan: ${inv.odeme_plani_raw || '—'}`}>
                            elle girilen taksitler
                          </span>
                        ) : inv.plan_override_note !== null ? (
                          <>
                            Plan: {etkinPlan || '—'}{' '}
                            <span className="rounded bg-blue-100 px-1 text-blue-700" title={`Dosyadaki plan: ${inv.odeme_plani_raw || '—'}`}>
                              düzenlendi
                            </span>
                          </>
                        ) : etkinPlan ? (
                          <>Plan: {etkinPlan}</>
                        ) : (
                          <span className="text-amber-600">tarih girilmedi — irsaliye tarihi kullanıldı</span>
                        )}
                      </div>
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
                      {inv.is_iade && (
                        <span
                          className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-700"
                          title={inv.is_allocatable ? 'İade irsaliyesi — yönetici kararıyla borca dahil' : 'İade irsaliyesi — borca eklenmez'}
                        >
                          İade{inv.is_allocatable ? ' (borçta)' : ''}
                        </span>
                      )}
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
                            planOverride: inv.plan_override_note,
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
                        {t.source === 'manual' && <span className="ml-1 text-xs text-blue-600" title="Elle girilen taksit">✎</span>}
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
                const kdvEslesti = allocs.length > 0
                return (
                  <tr key={p.id} className={'border-b border-slate-100 ' + (!p.allocatable ? 'opacity-60' : '')}>
                    <td className="px-3 py-2 font-medium">
                      {p.islem_kodu}
                      {p.is_alc && <span className="ml-1 rounded bg-slate-200 px-1 text-xs text-slate-600" title="Eski sistemin alacak kaydı — tahsise girmez">ALC</span>}
                      {p.is_kdv && (
                        <span
                          className={'ml-1 rounded px-1 text-xs ' + (kdvEslesti ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-700')}
                          title={
                            kdvEslesti
                              ? 'KDV 1/5 ödemesi — referansındaki irsaliyeden düşüldü'
                              : 'KDV 1/5 ödemesi — irsaliye referansı çözülemedi, tahsise girmedi'
                          }
                        >
                          {kdvEslesti ? 'KDV 1/5' : 'KDV — eşleşmedi'}
                        </span>
                      )}
                      {!p.is_alc && !p.is_kdv && !p.allocatable && (
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
          Eşleştirme kuralı: KDV 1/5 ödemeleri referansındaki (son 4 hane) irsaliyeden tamamıyla düşülür; diğer tüm
          ödemeler tek havuzda toplanır, önce peşin borçlar (en eski önce), sonra en yakın vadeli konsinye taksitleri
          kapatılır. ALC kayıtları ve referansı çözülemeyen KDV ödemeleri tahsise girmez. Her düzenlemeden sonra bu firma
          anında yeniden hesaplanır.
        </p>
      </section>
    </div>
  )
}
