import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/db'
import type { IrsaliyeRecord } from './irsaliyeParser'

// Önizleme diff'i: dosyadaki satırlar mevcut veritabanıyla karşılaştırılır.
// YALNIZ içe aktarılan (ham) sütunlar kıyaslanır — override'lar diff'e girmez.
// Veritabanında olup dosyada olmayan kayıtlara ASLA dokunulmaz.

export type DiffStatus = 'new' | 'updated' | 'unchanged' | 'needs_review' | 'excluded_31_12' | 'invalid'

export interface DiffRow {
  naturalKey: string
  rowIndex: number
  status: DiffStatus
  changedFields: string[]
  error?: string
  payload: unknown
}

interface ExistingInvoice {
  id: string
  fis_no: string
  invoice_date: string
  belge_no_raw: string
  turu_raw: string
  odeme_plani_raw: string
  f_flag_raw: string
  amount_tl: number | null
  amount_eur_cents: number | null
  dovizli_raw: string
  sale_type_override: string | null
  amount_eur_cents_override: number | null
}

/** İrsaliye kayıtlarının hangi ham alanları değişmiş? */
export function irsaliyeChangedFields(rec: IrsaliyeRecord, ex: ExistingInvoice): string[] {
  const changed: string[] = []
  if (ex.invoice_date !== rec.invoiceDateISO) changed.push('tarih')
  if ((ex.belge_no_raw ?? '') !== rec.belgeNoRaw) changed.push('belge_no')
  if ((ex.turu_raw ?? '') !== rec.turuRaw) changed.push('turu')
  if ((ex.odeme_plani_raw ?? '') !== rec.odemePlaniRaw) changed.push('odeme_plani')
  if ((ex.f_flag_raw ?? '') !== rec.fFlagRaw) changed.push('f_bayragi')
  const exTl = ex.amount_tl === null ? null : Math.round(Number(ex.amount_tl) * 100)
  const recTl = rec.amountTl === null ? null : Math.round(rec.amountTl * 100)
  if (exTl !== recTl) changed.push('tutar_tl')
  if ((ex.amount_eur_cents ?? null) !== (rec.amountEurCents ?? null)) changed.push('tutar_eur')
  return changed
}

export async function diffIrsaliye(
  admin: SupabaseClient,
  records: IrsaliyeRecord[],
): Promise<{ rows: DiffRow[]; existingByFisNo: Map<string, ExistingInvoice> }> {
  const fisNos = records.map((r) => r.fisNo)
  const existingByFisNo = new Map<string, ExistingInvoice>()

  // .in() sorgusunu parça parça çek (URL uzunluğu sınırı için 200'lük gruplar)
  for (let i = 0; i < fisNos.length; i += 200) {
    const chunk = fisNos.slice(i, i + 200)
    const rows = await fetchAll<ExistingInvoice>((from, to) =>
      admin
        .from('invoices')
        .select(
          'id, fis_no, invoice_date, belge_no_raw, turu_raw, odeme_plani_raw, f_flag_raw, amount_tl, amount_eur_cents, dovizli_raw, sale_type_override, amount_eur_cents_override',
        )
        .in('fis_no', chunk)
        .order('id')
        .range(from, to),
    )
    for (const row of rows) existingByFisNo.set(row.fis_no, row)
  }

  const out: DiffRow[] = []
  for (const rec of records) {
    const ex = existingByFisNo.get(rec.fisNo)
    if (!ex) {
      const status: DiffStatus = rec.is3112 ? 'excluded_31_12' : rec.needsReview ? 'needs_review' : 'new'
      out.push({ naturalKey: rec.fisNo, rowIndex: rec.rowIndex, status, changedFields: [], payload: rec })
      continue
    }
    const changed = irsaliyeChangedFields(rec, ex)
    out.push({
      naturalKey: rec.fisNo,
      rowIndex: rec.rowIndex,
      status: changed.length > 0 ? 'updated' : 'unchanged',
      changedFields: changed,
      payload: rec,
    })
  }
  return { rows: out, existingByFisNo }
}
