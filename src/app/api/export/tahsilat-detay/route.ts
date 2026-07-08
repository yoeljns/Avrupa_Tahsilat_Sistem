import * as XLSX from 'xlsx'
import { NextResponse } from 'next/server'
import { apiSession } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { aoaSheet, c2e, workbookResponse, type CellValue } from '@/lib/export/xlsxUtil'
import { trDate } from '@/lib/format'

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
    allocatable: boolean
    is_alc: boolean
    is_kdv: boolean
  }
  const payments = await fetchAll<PayRow>((from, to) =>
    admin
      .from('payments')
      .select('id, islem_kodu, firm_id, sheet_side, islem_tarihi, doviz_eur_cents, allocatable, is_alc, is_kdv')
      .order('islem_tarihi')
      .range(from, to),
  )

  interface InvRow {
    id: string
    fis_no: string
  }
  const invoices = await fetchAll<InvRow>((from, to) =>
    admin.from('invoices').select('id, fis_no').order('id').range(from, to),
  )
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

  const wb = XLSX.utils.book_new()

  // 1) Eşleştirmeler
  const matches: CellValue[][] = [
    ['İşlem Kodu', 'Ödeme Tarihi', 'Firma Kodu', 'Firma', 'Taraf', 'Fiş No', 'Taksit Vadesi', 'Tahsis €'],
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
        trDate(instById.get(a.installment_id)?.due_date ?? null),
        c2e(a.amount_eur_cents),
      ]
    }),
  ]
  XLSX.utils.book_append_sheet(wb, aoaSheet(matches, [20, 12, 10, 32, 8, 20, 12, 12]), 'Eşleştirmeler')

  // 2) Eşleşmemiş ödemeler (alacak kalanı)
  const allocatedByPayment = new Map<string, number>()
  for (const a of allocations) {
    allocatedByPayment.set(a.payment_id, (allocatedByPayment.get(a.payment_id) ?? 0) + a.amount_eur_cents)
  }
  const unmatched: CellValue[][] = [
    ['İşlem Kodu', 'Ödeme Tarihi', 'Firma Kodu', 'Firma', 'Sayfa', 'Ödeme €', 'Tahsis €', 'Kalan (Alacak) €', 'Durum'],
  ]
  for (const p of payments) {
    const total = p.doviz_eur_cents ?? 0
    const allocated = allocatedByPayment.get(p.id) ?? 0
    const rest = total - allocated
    if (!p.allocatable || rest > 0) {
      const f = firmById.get(p.firm_id)
      unmatched.push([
        p.islem_kodu,
        p.islem_tarihi ? trDate(p.islem_tarihi.slice(0, 10)) : '',
        f?.code_norm ?? '',
        f?.name ?? '',
        p.sheet_side === 'PESIN' ? 'Peşin' : 'Vadeli',
        c2e(total),
        c2e(allocated),
        c2e(p.allocatable ? rest : null),
        p.is_alc
          ? 'ALC (eski sistem alacak kaydı)'
          : p.is_kdv
            ? 'KDV 1/5 ödemesi (tahsise girmez)'
            : p.allocatable
              ? 'Alacak'
              : 'Tahsise kapalı',
      ])
    }
  }
  XLSX.utils.book_append_sheet(wb, aoaSheet(unmatched, [20, 12, 10, 32, 8, 12, 12, 14, 24]), 'Eşleşmemiş Ödemeler')

  // 3) Açık taksitler
  interface OpenRow {
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
      .select('firm_code, firm_name, side, due_date, fis_no, remaining_eur_cents')
      .order('due_date')
      .order('firm_code')
      .order('installment_id')
      .range(from, to),
  )
  const openSheet: CellValue[][] = [
    ['Vade', 'Firma Kodu', 'Firma', 'Taraf', 'Fiş No', 'Kalan €'],
    ...open.map((r): CellValue[] => [
      trDate(r.due_date),
      r.firm_code,
      r.firm_name,
      r.side === 'PESIN' ? 'Peşin' : 'Vadeli',
      r.fis_no,
      c2e(r.remaining_eur_cents),
    ]),
  ]
  XLSX.utils.book_append_sheet(wb, aoaSheet(openSheet, [12, 10, 32, 8, 20, 12]), 'Açık Taksitler')

  const today = new Date().toISOString().slice(0, 10)
  return workbookResponse(wb, `tahsilat_detay_${today}.xlsx`)
}
