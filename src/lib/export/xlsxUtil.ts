import * as XLSX from 'xlsx'

// Ortak XLSX üretim yardımcıları.

export type CellValue = string | number | null

/** AoA'dan sayfa üretir; sayı hücrelerine tr uyumlu 2 ondalık biçimi uygular. */
export function aoaSheet(rows: CellValue[][], colWidths?: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr]
      if (cell && cell.t === 'n') cell.z = '#,##0.00'
    }
  }
  if (colWidths) ws['!cols'] = colWidths.map((wch) => ({ wch }))
  return ws
}

export function workbookResponse(wb: XLSX.WorkBook, filename: string): Response {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const body = new Uint8Array(buf)
  return new Response(body, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

/** cent → Excel sayı hücresi (EUR) */
export function c2e(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null
  return Math.round(cents) / 100
}
