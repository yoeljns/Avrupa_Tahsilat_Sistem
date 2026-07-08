import * as XLSX from 'xlsx'
import { classifySaleType } from '@/lib/engine/classify'
import { excelSerialToISO, isDec31 } from '@/lib/engine/dates'
import { parseEurToCents } from '@/lib/engine/money'
import { normText, normalizeFirmCode } from '@/lib/engine/normalize'
import { parseOdemePlani } from '@/lib/engine/planParser'
import type { PlanParseStatus, SaleType } from '@/lib/engine/types'

// İrsaliye .xls dosyası (BIFF) ayrıştırıcısı.
// Sütun düzeni (0-tabanlı, dosyadan doğrulandı):
//   1: F bayrağı | 4: Tarih (Excel seri) | 5: Fiş No | 6: Belge No | 7: Türü
//   8: Müşteri Kodu | 9: Müşteri Unvanı | 10: Ödeme Planı | 11: Tutar TL | 12: Dövizli Tutar

export interface IrsaliyeRecord {
  rowIndex: number
  fisNo: string
  firmCodeNorm: string
  firmCodeRaw: string
  firmName: string
  invoiceDateISO: string
  belgeNoRaw: string
  turuRaw: string
  odemePlaniRaw: string
  fFlagRaw: string
  amountTl: number | null
  amountEurCents: number | null
  dovizliRaw: string
  saleTypeAuto: SaleType
  suggestedSaleType: SaleType | null
  planParseStatus: PlanParseStatus
  planParseNote: string | null
  classifyReason: string
  dueDates: string[]
  is3112: boolean
  fisnoNonstandard: boolean
  needsReview: boolean
  reviewReasons: string[]
}

export interface InvalidRow {
  rowIndex: number
  error: string
  preview: string
}

export interface ParsedIrsaliye {
  records: IrsaliyeRecord[]
  invalids: InvalidRow[]
  warnings: string[]
}

type Cell = string | number | boolean | null | undefined

function cellStr(v: Cell): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function cellNum(v: Cell): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const cents = parseEurToCents(v)
    return cents === null ? null : cents / 100
  }
  return null
}

export function parseIrsaliyeXls(buf: Buffer | ArrayBuffer): ParsedIrsaliye {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? 'array' : 'buffer', raw: true })
  const sheetName = wb.SheetNames.includes('Sayfa1') ? 'Sayfa1' : wb.SheetNames[0]
  if (!sheetName) return { records: [], invalids: [], warnings: ['Dosyada sayfa bulunamadı.'] }

  const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
  })

  const records: IrsaliyeRecord[] = []
  const invalids: InvalidRow[] = []
  const warnings: string[] = []
  const seenFisNo = new Set<string>()

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? []
    const dateCell = row[4]
    const fisNo = cellStr(row[5])

    // Veri satırı kuralı: 4. sütun Excel tarih serisi VE fiş no dolu.
    // Başlık ve boş satırlar böylece doğal olarak atlanır.
    const isDataRow = typeof dateCell === 'number' && dateCell > 30000 && dateCell < 80000 && fisNo !== ''
    if (!isDataRow) continue

    const invoiceDateISO = excelSerialToISO(dateCell)
    if (!invoiceDateISO) {
      invalids.push({ rowIndex: r + 1, error: 'Tarih çözülemedi', preview: fisNo })
      continue
    }

    if (seenFisNo.has(fisNo)) {
      invalids.push({ rowIndex: r + 1, error: `Fiş No dosyada tekrar ediyor: ${fisNo}`, preview: fisNo })
      continue
    }
    seenFisNo.add(fisNo)

    const firmCodeRaw = cellStr(row[8])
    if (!firmCodeRaw) {
      invalids.push({ rowIndex: r + 1, error: 'Müşteri kodu boş', preview: fisNo })
      continue
    }

    const belgeNoRaw = cellStr(row[6])
    const turuRaw = cellStr(row[7])
    const odemePlaniRaw = cellStr(row[10])
    const dovizliRaw = cellStr(row[12])
    const amountTl = cellNum(row[11])
    const amountEurCents = parseEurToCents(dovizliRaw)

    const classify = classifySaleType(belgeNoRaw, turuRaw)
    const plan = parseOdemePlani(odemePlaniRaw, invoiceDateISO)
    const is3112 = isDec31(invoiceDateISO)
    const fisnoNonstandard = !/^AVI\d+$/.test(fisNo)

    const reviewReasons: string[] = []
    if (classify.needsReview) reviewReasons.push(classify.reason)
    if (plan.status === 'unparsed') reviewReasons.push(plan.note ?? 'Ödeme planı çözülemedi')
    if (amountEurCents === null && !is3112) reviewReasons.push('EURO tutarı okunamadı')

    records.push({
      rowIndex: r + 1,
      fisNo,
      firmCodeNorm: normalizeFirmCode(firmCodeRaw),
      firmCodeRaw,
      firmName: cellStr(row[9]),
      invoiceDateISO,
      belgeNoRaw,
      turuRaw,
      odemePlaniRaw,
      fFlagRaw: cellStr(row[1]),
      amountTl,
      amountEurCents,
      dovizliRaw,
      saleTypeAuto: classify.type,
      suggestedSaleType: classify.suggested ?? null,
      planParseStatus: plan.status,
      planParseNote: plan.note ?? null,
      classifyReason: classify.reason,
      dueDates: plan.dueDates,
      is3112,
      fisnoNonstandard,
      needsReview: reviewReasons.length > 0,
      reviewReasons,
    })
  }

  if (records.length === 0) {
    warnings.push(`'${sheetName}' sayfasında veri satırı bulunamadı. Doğru dosyayı yüklediğinizden emin olun.`)
  }
  if (normText(sheetName) !== 'SAYFA1') {
    warnings.push(`'Sayfa1' bulunamadığı için '${sheetName}' sayfası okundu.`)
  }

  return { records, invalids, warnings }
}
