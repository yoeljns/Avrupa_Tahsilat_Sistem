// Tarih yardımcıları — daima UTC aritmetiği; yerel saat dilimi asla işe karışmaz.
// (Aksi halde İstanbul TZ'de gece yarısı seri tarihleri bir gün kayar.)

/** Excel 1900 sistemi seri → 1970 epoch gün farkı. */
const EXCEL_EPOCH_OFFSET_DAYS = 25569
const MS_PER_DAY = 86400000

/** Excel seri numarasını ISO gün (YYYY-MM-DD) yapar. Geçersizse null. */
export function excelSerialToISO(serial: number | null | undefined): string | null {
  if (serial === null || serial === undefined || Number.isNaN(serial)) return null
  if (typeof serial !== 'number' || !Number.isFinite(serial) || serial < 61) return null
  const ms = Math.round((serial - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY)
  const d = new Date(ms)
  return d.toISOString().slice(0, 10)
}

/** Excel seri numarasını ISO zaman damgası yapar (ödeme tarihleri için). */
export function excelSerialToTimestamp(serial: number | null | undefined): string | null {
  if (serial === null || serial === undefined || Number.isNaN(serial)) return null
  if (typeof serial !== 'number' || !Number.isFinite(serial) || serial < 61) return null
  const ms = Math.round((serial - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY)
  return new Date(ms).toISOString()
}

/** Ayın gün sayısı (month: 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Günü ayın son gününe kıskaçlayarak ISO tarih üretir (31 Şubat → 28/29 Şubat). */
export function isoFromYMDClamped(year: number, month: number, day: number): string {
  const d = Math.min(day, daysInMonth(year, month))
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** ISO güne gün ekler. */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d) + days * MS_PER_DAY
  return new Date(ms).toISOString().slice(0, 10)
}

/** ISO karşılaştırması (sözlük sırası = kronolojik sıra). */
export function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** İrsaliye 31 Aralık'a mı yazılmış? (31/12 kuralı — sistemde dikkate alınmaz.) */
export function isDec31(iso: string | null): boolean {
  return !!iso && iso.slice(5) === '12-31'
}
