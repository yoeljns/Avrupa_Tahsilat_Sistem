import * as XLSX from 'xlsx'
import { NextResponse } from 'next/server'
import { apiSession } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { aoaSheet, c2e, workbookResponse, type CellValue } from '@/lib/export/xlsxUtil'
import { trDate } from '@/lib/format'

export const runtime = 'nodejs'
export const maxDuration = 60

// Borç raporu (staff): Konsinye + Peşin açık borçlar, takvim matrisi, alacaklar.

interface OpenRow {
  firm_code: string
  firm_name: string
  side: 'PESIN' | 'VADELI'
  due_date: string
  invoice_date: string
  fis_no: string
  amount_eur_cents: number
  remaining_eur_cents: number
  no_date_flag: boolean
}

export async function GET() {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu rapor için yetkiniz yok.' }, { status: 403 })

  const admin = createAdminSupabase()
  const open = await fetchAll<OpenRow>((from, to) =>
    admin
      .from('v_open_installments')
      .select('firm_code, firm_name, side, due_date, invoice_date, fis_no, amount_eur_cents, remaining_eur_cents, no_date_flag')
      .order('due_date')
      .order('firm_code')
      .order('installment_id')
      .range(from, to),
  )

  const { data: runRow } = await admin.from('v_current_run').select('run_id').maybeSingle()
  interface BalRow {
    firm_id: string
    side: string
    credit_eur_cents: number
    open_debt_eur_cents: number
    overdue_eur_cents: number
  }
  const balances = runRow?.run_id
    ? await fetchAll<BalRow>((from, to) =>
        admin
          .from('firm_side_balances')
          .select('firm_id, side, credit_eur_cents, open_debt_eur_cents, overdue_eur_cents')
          .eq('run_id', runRow.run_id)
          .order('firm_id')
          .range(from, to),
      )
    : []
  const firms = await fetchAll<{ id: string; code_norm: string; name: string }>((from, to) =>
    admin.from('firms').select('id, code_norm, name').order('code_norm').range(from, to),
  )
  const firmById = new Map(firms.map((f) => [f.id, f]))

  const wb = XLSX.utils.book_new()
  const flatHead = ['Firma Kodu', 'Firma', 'Fiş No', 'İrsaliye Tarihi', 'Vade', 'Taksit €', 'Kalan €', 'Not']

  const flat = (side: 'PESIN' | 'VADELI'): CellValue[][] => [
    flatHead,
    ...open
      .filter((r) => r.side === side)
      .map((r): CellValue[] => [
        r.firm_code,
        r.firm_name,
        r.fis_no,
        trDate(r.invoice_date),
        trDate(r.due_date),
        c2e(r.amount_eur_cents),
        c2e(r.remaining_eur_cents),
        r.no_date_flag ? 'tarih girilmedi' : '',
      ]),
  ]
  XLSX.utils.book_append_sheet(wb, aoaSheet(flat('VADELI'), [10, 34, 20, 12, 12, 12, 12, 16]), 'Konsinye Borçlar')
  XLSX.utils.book_append_sheet(wb, aoaSheet(flat('PESIN'), [10, 34, 20, 12, 12, 12, 12, 16]), 'Peşin Borçlar')

  // Takvim matrisi (Konsinye): satır=firma, sütun=vade günü
  const vadeli = open.filter((r) => r.side === 'VADELI')
  const dates = Array.from(new Set(vadeli.map((r) => r.due_date))).sort()
  const byFirm = new Map<string, { name: string; cells: Map<string, number>; total: number }>()
  for (const r of vadeli) {
    let f = byFirm.get(r.firm_code)
    if (!f) byFirm.set(r.firm_code, (f = { name: r.firm_name, cells: new Map(), total: 0 }))
    f.cells.set(r.due_date, (f.cells.get(r.due_date) ?? 0) + r.remaining_eur_cents)
    f.total += r.remaining_eur_cents
  }
  const matrix: CellValue[][] = [
    ['Firma Kodu', 'Firma', ...dates.map(trDate), 'Toplam €'],
    ...Array.from(byFirm.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([code, f]): CellValue[] => [
        code,
        f.name,
        ...dates.map((d): CellValue => c2e(f.cells.get(d) ?? null)),
        c2e(f.total),
      ]),
    ['', 'TOPLAM', ...dates.map((d): CellValue => c2e(vadeli.filter((r) => r.due_date === d).reduce((s, r) => s + r.remaining_eur_cents, 0))), c2e(vadeli.reduce((s, r) => s + r.remaining_eur_cents, 0))],
  ]
  XLSX.utils.book_append_sheet(wb, aoaSheet(matrix, [10, 30, ...dates.map(() => 11), 12]), 'Konsinye Takvim')

  // Alacaklar
  const credits: CellValue[][] = [
    ['Firma Kodu', 'Firma', 'Taraf', 'Alacak €', 'Açık Borç €', 'Vadesi Geçmiş €'],
    ...balances
      .filter((b) => b.credit_eur_cents > 0 || b.open_debt_eur_cents > 0)
      .map((b): CellValue[] => {
        const f = firmById.get(b.firm_id)
        return [
          f?.code_norm ?? '',
          f?.name ?? '',
          b.side === 'PESIN' ? 'Peşin' : 'Konsinye/Vadeli',
          c2e(b.credit_eur_cents),
          c2e(b.open_debt_eur_cents),
          c2e(b.overdue_eur_cents),
        ]
      })
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]
  XLSX.utils.book_append_sheet(wb, aoaSheet(credits, [10, 34, 16, 12, 12, 14]), 'Alacak ve Bakiyeler')

  const today = new Date().toISOString().slice(0, 10)
  return workbookResponse(wb, `borclar_${today}.xlsx`)
}
