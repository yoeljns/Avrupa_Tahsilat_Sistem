import Link from 'next/link'
import ClearReviewButton from '@/components/ClearReviewButton'
import ReviewClassifyTable, { type ReviewRow } from '@/components/ReviewClassifyTable'
import { requireRole } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { eur, trDate } from '@/lib/format'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// İnceleme kuyruğu: içe aktarmanın kendi başına karar veremediği her şey
// burada Tahsilat Yöneticisi onayı bekler.

interface ReviewInvoice {
  id: string
  fis_no: string
  firm_id: string
  firm_code: string
  firm_name: string
  invoice_date: string
  belge_no_raw: string
  odeme_plani_raw: string
  amount_eur_cents: number | null
  sale_type: string
  suggested_sale_type: string | null
  classify_reason: string | null
  plan_parse_status: string
  plan_parse_note: string | null
  is_31_12: boolean
  is_cancelled: boolean
  fisno_nonstandard: boolean
  needs_review: boolean
  raw_changed_after_override: boolean
}

const TABS = [
  { key: 'siniflandirma', label: 'Sınıflandırma' },
  { key: 'plan', label: 'Plan Çözülemedi' },
  { key: 'cakisma', label: 'Çakışmalar' },
  { key: 'otuzbiraralik', label: '31/12 Hariçler' },
  { key: 'tarihsiz', label: 'Tarih Girilmedi' },
] as const

export default async function IncelemePage({ searchParams }: { searchParams: Promise<{ sekme?: string }> }) {
  await requireRole(['yonetici', 'tahsilat_yoneticisi'])
  const supabase = await createServerSupabase()
  const params = await searchParams
  const tab = TABS.some((t) => t.key === params.sekme) ? params.sekme! : 'siniflandirma'

  const invoices = await fetchAll<ReviewInvoice>((from, to) =>
    supabase
      .from('v_invoices_effective')
      .select(
        'id, fis_no, firm_id, firm_code, firm_name, invoice_date, belge_no_raw, odeme_plani_raw, amount_eur_cents, sale_type, suggested_sale_type, classify_reason, plan_parse_status, plan_parse_note, is_31_12, is_cancelled, fisno_nonstandard, needs_review, raw_changed_after_override',
      )
      .or('needs_review.eq.true,is_31_12.eq.true,raw_changed_after_override.eq.true')
      .order('invoice_date', { ascending: false })
      .range(from, to),
  )

  const active = invoices.filter((i) => !i.is_cancelled)
  const classification = active.filter((i) => i.sale_type === 'OTHER' && !i.is_31_12)
  const planIssues = active.filter((i) => i.plan_parse_status === 'unparsed' && i.sale_type !== 'OTHER' && !i.is_31_12)
  const conflicts = active.filter((i) => i.raw_changed_after_override)
  const dec31 = invoices.filter((i) => i.is_31_12)

  // Tarihsiz: açık taksitlerde no_date_flag
  const noDateRows = await fetchAll<{
    installment_id: string
    firm_code: string
    firm_name: string
    fis_no: string
    due_date: string
    remaining_eur_cents: number
    firm_id: string
  }>((from, to) =>
    supabase
      .from('v_open_installments')
      .select('installment_id, firm_id, firm_code, firm_name, fis_no, due_date, remaining_eur_cents')
      .eq('no_date_flag', true)
      .order('firm_code')
      .range(from, to),
  )

  const counts: Record<string, number> = {
    siniflandirma: classification.length,
    plan: planIssues.length,
    cakisma: conflicts.length,
    otuzbiraralik: dec31.length,
    tarihsiz: noDateRows.length,
  }

  return (
    <div>
      <h1 className="text-lg font-bold text-slate-900">İnceleme Kuyruğu</h1>
      <p className="mt-1 text-sm text-slate-500">
        İçe aktarmanın kendi başına karar veremediği kayıtlar burada onay bekler. Sınıflandırılmayan irsaliyeler borç
        hesabına <strong>dahil edilmez</strong>.
      </p>

      <nav className="mt-4 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/inceleme?sekme=${t.key}`}
            className={
              'rounded-t-lg px-3 py-2 text-sm font-medium ' +
              (tab === t.key ? 'border border-b-0 border-slate-200 bg-white text-blue-700' : 'text-slate-500 hover:text-slate-800')
            }
          >
            {t.label} {counts[t.key] > 0 && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-xs text-amber-700">{counts[t.key]}</span>}
          </Link>
        ))}
      </nav>

      <div className="mt-4">
        {tab === 'siniflandirma' && (
          <ReviewClassifyTable
            rows={classification.map(
              (i): ReviewRow => ({
                id: i.id,
                fisNo: i.fis_no,
                firmCode: i.firm_code,
                firmName: i.firm_name,
                invoiceDate: trDate(i.invoice_date),
                belgeNo: i.belge_no_raw,
                amountEur: eur(i.amount_eur_cents),
                suggested: i.suggested_sale_type,
                reason: i.classify_reason,
              }),
            )}
          />
        )}

        {tab === 'plan' && (
          <SimpleTable
            empty="Çözülemeyen ödeme planı yok."
            head={['Fiş No', 'Firma', 'Tarih', 'Plan', 'Not', 'Tutar €', '']}
            rows={planIssues.map((i) => [
              i.fis_no,
              `${i.firm_code} ${i.firm_name.slice(0, 20)}`,
              trDate(i.invoice_date),
              i.odeme_plani_raw,
              i.plan_parse_note ?? '',
              eur(i.amount_eur_cents),
              <Link key="l" href={`/firmalar/${i.firm_id}`} className="text-blue-700 hover:underline">
                Düzenle →
              </Link>,
            ])}
          />
        )}

        {tab === 'cakisma' && (
          <SimpleTable
            empty="Çakışma yok."
            head={['Fiş No', 'Firma', 'Tarih', 'Açıklama', 'Tutar €', '']}
            rows={conflicts.map((i) => [
              i.fis_no,
              `${i.firm_code} ${i.firm_name.slice(0, 20)}`,
              trDate(i.invoice_date),
              'Düzenleme sonrası içe aktarılan ham veri değişti — kontrol edin',
              eur(i.amount_eur_cents),
              <span key="a" className="inline-flex gap-2">
                <Link href={`/firmalar/${i.firm_id}`} className="text-blue-700 hover:underline">
                  İncele →
                </Link>
                <ClearReviewButton invoiceId={i.id} />
              </span>,
            ])}
          />
        )}

        {tab === 'otuzbiraralik' && (
          <>
            <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
              31 Aralık tarihli irsaliyeler kural gereği borç hesabına hiç katılmaz; bu liste yalnız bilgi amaçlıdır.
            </p>
            <SimpleTable
              empty="31/12 tarihli irsaliye yok."
              head={['Fiş No', 'Firma', 'Belge No', 'Plan', 'Tutar €']}
              rows={dec31.map((i) => [
                i.fis_no,
                `${i.firm_code} ${i.firm_name.slice(0, 20)}`,
                i.belge_no_raw,
                i.odeme_plani_raw,
                eur(i.amount_eur_cents),
              ])}
            />
          </>
        )}

        {tab === 'tarihsiz' && (
          <>
            <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
              Bu taksitlerde vade tarihi girilmediği için irsaliye tarihi kullanılıyor (hemen ödenebilir kabul edilir).
              Tarih girmek için irsaliyeyi düzenleyin.
            </p>
            <SimpleTable
              empty="Tarihsiz açık taksit yok."
              head={['Firma', 'Fiş No', 'Varsayılan Vade', 'Kalan €', '']}
              rows={noDateRows.map((r) => [
                `${r.firm_code} ${r.firm_name.slice(0, 24)}`,
                r.fis_no,
                trDate(r.due_date),
                eur(r.remaining_eur_cents),
                <Link key="l" href={`/firmalar/${r.firm_id}`} className="text-blue-700 hover:underline">
                  Düzenle →
                </Link>,
              ])}
            />
          </>
        )}
      </div>
    </div>
  )
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) {
    return <p className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm">{empty}</p>
  }
  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b border-slate-100">
              {cells.map((c, j) => (
                <td key={j} className="px-3 py-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
