import * as XLSX from 'xlsx'
import { NextResponse } from 'next/server'
import { apiSession } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { aoaSheet, c2e, workbookResponse, type CellValue } from '@/lib/export/xlsxUtil'
import { trDate } from '@/lib/format'
import { isMissingRelationError } from '@/components/MigrationNeeded'
import { kategorileriYukle } from '@/lib/kategoriler'
import { kategoriEtiketi } from '@/lib/kategoriMeta'

export const runtime = 'nodejs'
export const maxDuration = 60

// Borç raporu (staff) — kullanıcının referans tablosuyla aynı mantık:
// her vade tarihi için BORÇ | ÖDEME | KALAN üçlüsü.

interface ScopeRow {
  firm_id: string
  firm_code: string
  firm_name: string
  side: 'PESIN' | 'VADELI'
  due_date: string
  invoice_date: string
  fis_no: string
  amount_eur_cents: number
  remaining_eur_cents: number
  paid_eur_cents: number
  no_date_flag: boolean
  /** 0007: etkin satış kategorisi */
  kategori?: string
}

export async function GET() {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu rapor için yetkiniz yok.' }, { status: 403 })

  const admin = createAdminSupabase()
  const kolonlar = 'firm_id, firm_code, firm_name, side, due_date, invoice_date, fis_no, amount_eur_cents, remaining_eur_cents, paid_eur_cents, no_date_flag'
  const kapsam = (secim: string) =>
    fetchAll<ScopeRow>((from, to) =>
      admin.from('v_installments_scope').select(secim).order('due_date').order('firm_code').order('installment_id').range(from, to) as unknown as PromiseLike<{
        data: ScopeRow[] | null
        error: { message: string } | null
      }>,
    )
  // Kategori kolonu 0007 ile gelir; göç henüz yoksa rapor kategorisiz üretilir
  const scope = await kapsam(kolonlar + ', kategori').catch((e) => {
    if (isMissingRelationError(e)) return kapsam(kolonlar)
    throw e
  })
  const kategoriler = await kategorileriYukle(admin)

  const { data: runRow } = await admin.from('v_current_run').select('run_id').maybeSingle()
  interface BalRow {
    firm_id: string
    pesin_open_eur_cents: number
    vadeli_open_eur_cents: number
    vadeli_overdue_eur_cents: number
    credit_eur_cents: number
    total_debt_eur_cents: number
    total_paid_eur_cents: number
  }
  const balances = runRow?.run_id
    ? await fetchAll<BalRow>((from, to) =>
        admin
          .from('firm_balances')
          .select('firm_id, pesin_open_eur_cents, vadeli_open_eur_cents, vadeli_overdue_eur_cents, credit_eur_cents, total_debt_eur_cents, total_paid_eur_cents')
          .eq('run_id', runRow.run_id)
          .order('firm_id')
          .range(from, to),
      )
    : []
  const firms = await fetchAll<{ id: string; code_norm: string; name: string; pazarlamaci_email: string | null }>(
    (from, to) => admin.from('firms').select('id, code_norm, name, pazarlamaci_email').order('code_norm').range(from, to),
  )
  const firmById = new Map(firms.map((f) => [f.id, f]))
  const sorumluOf = (firmId: string) => firmById.get(firmId)?.pazarlamaci_email?.split('@')[0]?.toUpperCase() ?? ''

  const wb = XLSX.utils.book_new()

  // 1-2) Düz listeler
  const flatHead = ['Sorumlu', 'Firma Kodu', 'Firma', 'Fiş No', 'Kategori', 'İrsaliye Tarihi', 'Vade', 'Borç €', 'Ödenen €', 'Kalan €', 'Not']
  const flat = (side: 'PESIN' | 'VADELI'): CellValue[][] => [
    flatHead,
    ...scope
      .filter((r) => r.side === side)
      .map((r): CellValue[] => [
        sorumluOf(r.firm_id),
        r.firm_code,
        r.firm_name,
        r.fis_no,
        r.kategori ? kategoriEtiketi(kategoriler, r.kategori) : '',
        trDate(r.invoice_date),
        trDate(r.due_date),
        c2e(r.amount_eur_cents),
        c2e(r.paid_eur_cents),
        c2e(r.remaining_eur_cents),
        r.no_date_flag ? 'tarih girilmedi' : '',
      ]),
  ]
  XLSX.utils.book_append_sheet(wb, aoaSheet(flat('VADELI'), [10, 10, 32, 20, 16, 12, 12, 11, 11, 11, 14]), 'Konsinye Borçlar')
  XLSX.utils.book_append_sheet(wb, aoaSheet(flat('PESIN'), [10, 10, 32, 20, 16, 12, 12, 11, 11, 11, 14]), 'Peşin Borçlar')

  // 3) Takvim matrisleri — kullanıcının referans Excel düzeni: her tarihte BORÇ | ÖDEME | KALAN
  interface Agg {
    borc: number
    odeme: number
    kalan: number
  }
  const takvimSayfasi = (side: 'PESIN' | 'VADELI'): { matrix: CellValue[][]; widths: number[] } => {
    const rows = scope.filter((r) => r.side === side)
    const dates = Array.from(new Set(rows.map((r) => r.due_date))).sort()
    const byFirm = new Map<string, { code: string; name: string; sorumlu: string; cells: Map<string, Agg>; totB: number; totO: number; totK: number }>()
    for (const r of rows) {
      let f = byFirm.get(r.firm_id)
      if (!f) {
        byFirm.set(r.firm_id, (f = { code: r.firm_code, name: r.firm_name, sorumlu: sorumluOf(r.firm_id), cells: new Map(), totB: 0, totO: 0, totK: 0 }))
      }
      let c = f.cells.get(r.due_date)
      if (!c) f.cells.set(r.due_date, (c = { borc: 0, odeme: 0, kalan: 0 }))
      c.borc += r.amount_eur_cents
      c.odeme += r.paid_eur_cents
      c.kalan += r.remaining_eur_cents
      f.totB += r.amount_eur_cents
      f.totO += r.paid_eur_cents
      f.totK += r.remaining_eur_cents
    }

    const header1: CellValue[] = ['', '', '', '', '', '']
    const header2: CellValue[] = ['SORUMLU', 'FİRMA KODU', 'FİRMA ADI', 'TOPLAM BORÇ', 'ÖDEMELER', 'KALAN BORÇ']
    for (const d of dates) {
      header1.push(trDate(d), '', '')
      header2.push('BORÇ', 'ÖDEME', 'KALAN')
    }
    const matrix: CellValue[][] = [header1, header2]
    const sortedFirms = Array.from(byFirm.values()).sort((a, b) => (a.code < b.code ? -1 : 1))
    for (const f of sortedFirms) {
      const row: CellValue[] = [f.sorumlu, f.code, f.name, c2e(f.totB), c2e(f.totO), c2e(f.totK)]
      for (const d of dates) {
        const c = f.cells.get(d)
        row.push(c2e(c?.borc ?? null), c2e(c?.odeme ?? null), c2e(c?.kalan ?? null))
      }
      matrix.push(row)
    }
    const totalRow: CellValue[] = [
      '',
      '',
      'TOPLAM',
      c2e(sortedFirms.reduce((s, f) => s + f.totB, 0)),
      c2e(sortedFirms.reduce((s, f) => s + f.totO, 0)),
      c2e(sortedFirms.reduce((s, f) => s + f.totK, 0)),
    ]
    const gunToplam = new Map<string, Agg>()
    for (const r of rows) {
      let t = gunToplam.get(r.due_date)
      if (!t) gunToplam.set(r.due_date, (t = { borc: 0, odeme: 0, kalan: 0 }))
      t.borc += r.amount_eur_cents
      t.odeme += r.paid_eur_cents
      t.kalan += r.remaining_eur_cents
    }
    for (const d of dates) {
      const t = gunToplam.get(d)!
      totalRow.push(c2e(t.borc), c2e(t.odeme), c2e(t.kalan))
    }
    matrix.push(totalRow)
    return { matrix, widths: [10, 10, 28, 12, 12, 12, ...dates.flatMap(() => [11, 11, 11])] }
  }
  const konsinyeTakvim = takvimSayfasi('VADELI')
  XLSX.utils.book_append_sheet(wb, aoaSheet(konsinyeTakvim.matrix, konsinyeTakvim.widths), 'Konsinye Takvim')
  const pesinTakvim = takvimSayfasi('PESIN')
  XLSX.utils.book_append_sheet(wb, aoaSheet(pesinTakvim.matrix, pesinTakvim.widths), 'Peşin Takvim')

  // 4) Bakiyeler ve alacaklar
  const credits: CellValue[][] = [
    ['Firma Kodu', 'Firma', 'Peşin Açık €', 'Konsinye Açık €', 'Vadesi Geçmiş €', 'Alacak €', 'Toplam Borç €', 'Toplam Ödeme €'],
    ...balances
      .filter((b) => b.credit_eur_cents > 0 || b.pesin_open_eur_cents > 0 || b.vadeli_open_eur_cents > 0)
      .map((b): CellValue[] => {
        const f = firmById.get(b.firm_id)
        return [
          f?.code_norm ?? '',
          f?.name ?? '',
          c2e(b.pesin_open_eur_cents),
          c2e(b.vadeli_open_eur_cents),
          c2e(b.vadeli_overdue_eur_cents),
          c2e(b.credit_eur_cents),
          c2e(b.total_debt_eur_cents),
          c2e(b.total_paid_eur_cents),
        ]
      })
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]
  XLSX.utils.book_append_sheet(wb, aoaSheet(credits, [10, 34, 12, 14, 14, 12, 13, 14]), 'Bakiyeler ve Alacaklar')

  const today = new Date().toISOString().slice(0, 10)
  return workbookResponse(wb, `borclar_${today}.xlsx`)
}
