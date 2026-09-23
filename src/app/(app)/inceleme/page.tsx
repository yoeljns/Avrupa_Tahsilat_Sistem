import Link from 'next/link'
import ClearReviewButton from '@/components/ClearReviewButton'
import MigrationNeeded, { isMissingRelationError } from '@/components/MigrationNeeded'
import ReviewClassifyTable, { type ReviewRow } from '@/components/ReviewClassifyTable'
import { requireRole } from '@/lib/auth'
import { eur, trDate } from '@/lib/format'
import { incelemeVerisi, type IncelemeIrsaliye, type IncelemeVerisi } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// İnceleme kuyruğu: içe aktarmanın kendi başına karar veremediği her şey
// burada Tahsilat Yöneticisi onayı bekler. Veriler TEK ağ turunda gelir.

const TABS = [
  { key: 'siniflandirma', label: 'Sınıflandırma' },
  { key: 'plan', label: 'Plan Çözülemedi' },
  { key: 'diger', label: 'Diğer Uyarılar' },
  { key: 'iade', label: 'İadeler' },
  { key: 'cakisma', label: 'Çakışmalar' },
  { key: 'otuzbiraralik', label: '31/12 Hariçler' },
  { key: 'tarihsiz', label: 'Tarih Girilmedi' },
] as const

/** 'Diğer' sekmesindeki kaydın neden incelemede olduğu */
function uyariNedeni(i: IncelemeIrsaliye): string {
  if (i.amount_eur_cents === null) return 'EURO tutarı okunamadı — tutar girin'
  if (i.plan_parse_note) return i.plan_parse_note
  return i.classify_reason ?? 'Kontrol bekliyor'
}

export default async function IncelemePage({ searchParams }: { searchParams: Promise<{ sekme?: string }> }) {
  await requireRole(['yonetici', 'tahsilat_yoneticisi'])
  const supabase = await createServerSupabase()
  const params = await searchParams
  const tab = TABS.some((t) => t.key === params.sekme) ? params.sekme! : 'siniflandirma'

  let veri: IncelemeVerisi
  try {
    veri = await incelemeVerisi(supabase)
  } catch (e) {
    if (isMissingRelationError(e)) return <MigrationNeeded />
    throw e
  }

  // Takip dışı firmaların irsaliyeleri inceleme kuyruğuna GİRMEZ
  const invoices = veri.irsaliyeler.filter((i) => !(i.excluded_override ?? i.is_excluded_firm))
  const active = invoices.filter((i) => !i.is_cancelled)
  const classification = active.filter((i) => i.sale_type === 'OTHER' && !i.is_31_12 && !i.is_iade)
  const planIssues = active.filter((i) => i.plan_parse_status === 'unparsed' && i.sale_type !== 'OTHER' && !i.is_31_12)
  const conflicts = active.filter((i) => i.raw_changed_after_override)
  const iadeler = active.filter((i) => i.is_iade && !i.is_31_12)
  const diger = active.filter(
    (i) =>
      i.needs_review &&
      !i.is_31_12 &&
      !i.is_iade &&
      i.sale_type !== 'OTHER' &&
      i.plan_parse_status !== 'unparsed' &&
      !i.raw_changed_after_override,
  )
  const dec31 = invoices.filter((i) => i.is_31_12)
  const noDateRows = veri.tarihsiz

  const counts: Record<string, number> = {
    siniflandirma: classification.length,
    plan: planIssues.length,
    diger: diger.length,
    iade: iadeler.filter((i) => i.needs_review).length,
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
              i.plan_override_note ?? i.odeme_plani_raw,
              i.plan_parse_note ?? '',
              eur(i.amount_eur_cents),
              <Link key="l" href={`/firmalar/${i.firm_id}`} className="text-blue-700 hover:underline">
                Düzenle →
              </Link>,
            ])}
          />
        )}

        {tab === 'diger' && (
          <>
            <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
              Hesaba dahil olan ama kontrol edilmesi gereken irsaliyeler (okunamayan tutar, irsaliye tarihinden çok önceye
              düşen vade vb.). Gerekirse düzenleyin, sonra “Kontrol edildi” ile listeden çıkarın.
            </p>
            <SimpleTable
              empty="Başka uyarı yok."
              head={['Fiş No', 'Firma', 'Tarih', 'Plan', 'Neden', 'Tutar €', '']}
              rows={diger.map((i) => [
                i.fis_no,
                `${i.firm_code} ${i.firm_name.slice(0, 20)}`,
                trDate(i.invoice_date),
                i.plan_override_note ?? i.odeme_plani_raw,
                uyariNedeni(i),
                eur(i.amount_eur_cents),
                <span key="a" className="inline-flex gap-2">
                  <Link href={`/firmalar/${i.firm_id}`} className="text-blue-700 hover:underline">
                    Düzenle →
                  </Link>
                  <ClearReviewButton invoiceId={i.id} />
                </span>,
              ])}
            />
          </>
        )}

        {tab === 'iade' && (
          <>
            <p className="mb-3 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-800">
              İade irsaliyeleri müşterinin borcunu artırmaz; bu yüzden <strong>borca eklenmez</strong>. İade tutarının
              müşteriye alacak olarak yansıması gerekiyorsa ödeme kaydıyla işleyin. Bir iadeyi yine de borç saymak
              isterseniz firma sayfasından satış tipini açıkça seçin.
            </p>
            <SimpleTable
              empty="İade irsaliyesi yok."
              head={['Fiş No', 'Firma', 'Tarih', 'Belge No', 'Tutar €', 'Durum', '']}
              rows={iadeler.map((i) => [
                i.fis_no,
                `${i.firm_code} ${i.firm_name.slice(0, 20)}`,
                trDate(i.invoice_date),
                i.belge_no_raw,
                eur(i.amount_eur_cents),
                i.is_allocatable ? 'Borçta (yönetici kararı)' : 'Borca eklenmedi',
                <span key="a" className="inline-flex gap-2">
                  <Link href={`/firmalar/${i.firm_id}`} className="text-blue-700 hover:underline">
                    Firma →
                  </Link>
                  {i.needs_review && <ClearReviewButton invoiceId={i.id} />}
                </span>,
              ])}
            />
          </>
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
