import * as XLSX from 'xlsx'
import { NextResponse } from 'next/server'
import { apiSession } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { aoaSheet, c2e, workbookResponse, type CellValue } from '@/lib/export/xlsxUtil'
import { todayISO, trDate } from '@/lib/format'
import { kategorileriYukle } from '@/lib/kategoriler'
import { kategoriEtiketi } from '@/lib/kategoriMeta'

export const runtime = 'nodejs'
export const maxDuration = 60

// Tahsilat detay raporu (staff): ödeme→irsaliye eşleştirme dökümü,
// eşleşmemiş ödemeler (alacaklar) ve açık taksitler.

export async function GET() {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu rapor için yetkiniz yok.' }, { status: 403 })

  const admin = createAdminSupabase()
  const { data: runRow } = await admin.from('v_current_run').select('run_id').maybeSingle()
  if (!runRow?.run_id) return NextResponse.json({ error: 'Henüz mutabakat hesaplanmadı.' }, { status: 400 })
  const runId = runRow.run_id as string

  interface AllocRow {
    payment_id: string
    installment_id: string
    invoice_id: string
    firm_id: string
    side: string
    amount_eur_cents: number
  }
  const allocations = await fetchAll<AllocRow>((from, to) =>
    admin
      .from('allocations')
      .select('payment_id, installment_id, invoice_id, firm_id, side, amount_eur_cents')
      .eq('run_id', runId)
      .order('id')
      .range(from, to),
  )

  interface PayRow {
    id: string
    islem_kodu: string
    firm_id: string
    sheet_side: string
    islem_tarihi: string | null
    doviz_eur_cents: number | null
    /** 0008: elle girilen EUR */
    doviz_eur_cents_override?: number | null
    allocatable: boolean
    is_alc: boolean
    is_kdv: boolean
  }
  const odemeKolonlari = 'id, islem_kodu, firm_id, sheet_side, islem_tarihi, doviz_eur_cents, allocatable, is_alc, is_kdv'
  const odemeOku = (kolonlar: string) =>
    fetchAll<PayRow>((from, to) =>
      admin
        .from('payments')
        .select(kolonlar)
        .order('islem_tarihi')
        .order('id') // eşit tarihlerde sayfa sınırında satır atlanmasın/tekrarlanmasın
        .range(from, to) as unknown as PromiseLike<{ data: PayRow[] | null; error: { message: string } | null }>,
    )
  // 0008 öncesi veritabanında elle EUR kolonu yoktur
  const payments = await odemeOku(odemeKolonlari + ', doviz_eur_cents_override').catch((e: unknown) =>
    /doviz_eur_cents_override/.test(e instanceof Error ? e.message : String(e)) ? odemeOku(odemeKolonlari) : Promise.reject(e),
  )

  interface InvRow {
    id: string
    fis_no: string
    sale_type_auto: string
    sale_type_override: string | null
  }
  const invoices = await fetchAll<InvRow>((from, to) =>
    admin.from('invoices').select('id, fis_no, sale_type_auto, sale_type_override').order('id').range(from, to),
  )
  const kategoriler = await kategorileriYukle(admin)
  interface InstRow {
    id: string
    due_date: string
  }
  const installments = await fetchAll<InstRow>((from, to) =>
    admin.from('installments').select('id, due_date').order('id').range(from, to),
  )
  const firms = await fetchAll<{ id: string; code_norm: string; name: string }>((from, to) =>
    admin.from('firms').select('id, code_norm, name').order('code_norm').range(from, to),
  )

  const firmById = new Map(firms.map((f) => [f.id, f]))
  const invById = new Map(invoices.map((i) => [i.id, i]))
  const instById = new Map(installments.map((i) => [i.id, i]))
  const payById = new Map(payments.map((p) => [p.id, p]))
  /** İrsaliyenin etkin satış kategorisinin adı (yönetim panelindeki adıyla) */
  const kategoriOf = (invoiceId: string) => {
    const i = invById.get(invoiceId)
    return i ? kategoriEtiketi(kategoriler, i.sale_type_override ?? i.sale_type_auto) : ''
  }

  const wb = XLSX.utils.book_new()

  // 1) Eşleştirmeler
  const matches: CellValue[][] = [
    ['İşlem Kodu', 'Ödeme Tarihi', 'Firma Kodu', 'Firma', 'Taraf', 'Fiş No', 'Kategori', 'Taksit Vadesi', 'Tahsis €'],
    ...allocations.map((a): CellValue[] => {
      const p = payById.get(a.payment_id)
      const f = firmById.get(a.firm_id)
      return [
        p?.islem_kodu ?? '',
        p?.islem_tarihi ? trDate(p.islem_tarihi.slice(0, 10)) : '',
        f?.code_norm ?? '',
        f?.name ?? '',
        a.side === 'PESIN' ? 'Peşin' : 'Vadeli',
        invById.get(a.invoice_id)?.fis_no ?? '',
        kategoriOf(a.invoice_id),
        trDate(instById.get(a.installment_id)?.due_date ?? null),
        c2e(a.amount_eur_cents),
      ]
    }),
  ]
  XLSX.utils.book_append_sheet(wb, aoaSheet(matches, [20, 12, 10, 32, 8, 20, 16, 12, 12]), 'Eşleştirmeler')

  // 2) Eşleşmemiş ödemeler (alacak kalanı)
  const allocatedByPayment = new Map<string, number>()
  for (const a of allocations) {
    allocatedByPayment.set(a.payment_id, (allocatedByPayment.get(a.payment_id) ?? 0) + a.amount_eur_cents)
  }
  const unmatched: CellValue[][] = [
    ['İşlem Kodu', 'Ödeme Tarihi', 'Firma Kodu', 'Firma', 'Sayfa', 'Ödeme €', 'Tahsis €', 'Kalan (Alacak) €', 'Durum'],
  ]
  for (const p of payments) {
    // Hesapta kullanılan tutar: elle girilen EUR, yoksa dosyadaki DÖVİZ EURO
    const etkin = p.doviz_eur_cents_override ?? p.doviz_eur_cents
    const eurYok = p.allocatable && (etkin === null || etkin <= 0)
    const total = etkin ?? 0
    const allocated = allocatedByPayment.get(p.id) ?? 0
    const rest = total - allocated
    if (!p.allocatable || rest > 0 || eurYok) {
      const f = firmById.get(p.firm_id)
      unmatched.push([
        p.islem_kodu,
        p.islem_tarihi ? trDate(p.islem_tarihi.slice(0, 10)) : '',
        f?.code_norm ?? '',
        f?.name ?? '',
        p.sheet_side === 'PESIN' ? 'Peşin' : 'Vadeli',
        c2e(etkin),
        c2e(allocated),
        c2e(p.allocatable && !eurYok ? rest : null),
        eurYok
          ? 'EUR tutarı yok — hesaba girmedi (İnceleme → Ödeme Tutarı)'
          : p.is_alc
          ? 'ALC (eski sistem alacak kaydı)'
          : p.is_kdv
            ? allocated > 0
              ? 'KDV 1/5 — kısmen eşleşti'
              : 'KDV 1/5 — irsaliye eşleşmedi'
            : p.allocatable
              ? p.doviz_eur_cents_override != null
                ? 'Alacak (EUR elle girildi)'
                : 'Alacak'
              : 'Tahsise kapalı',
      ])
    }
  }
  XLSX.utils.book_append_sheet(wb, aoaSheet(unmatched, [20, 12, 10, 32, 8, 12, 12, 14, 24]), 'Eşleşmemiş Ödemeler')

  // 3) Açık taksitler
  interface OpenRow {
    invoice_id: string
    firm_code: string
    firm_name: string
    side: string
    due_date: string
    fis_no: string
    remaining_eur_cents: number
  }
  const open = await fetchAll<OpenRow>((from, to) =>
    admin
      .from('v_open_installments')
      .select('invoice_id, firm_code, firm_name, side, due_date, fis_no, remaining_eur_cents')
      .order('due_date')
      .order('firm_code')
      .order('installment_id')
      .range(from, to),
  )
  const openSheet: CellValue[][] = [
    ['Vade', 'Firma Kodu', 'Firma', 'Taraf', 'Fiş No', 'Kategori', 'Kalan €'],
    ...open.map((r): CellValue[] => [
      trDate(r.due_date),
      r.firm_code,
      r.firm_name,
      r.side === 'PESIN' ? 'Peşin' : 'Vadeli',
      r.fis_no,
      kategoriOf(r.invoice_id),
      c2e(r.remaining_eur_cents),
    ]),
  ]
  XLSX.utils.book_append_sheet(wb, aoaSheet(openSheet, [12, 10, 32, 8, 20, 16, 12]), 'Açık Taksitler')

  // Dosya adı Türkiye tarihiyle (gece 00:00–03:00 arasında da doğru gün)
  return workbookResponse(wb, `tahsilat_detay_${todayISO()}.xlsx`)
}
