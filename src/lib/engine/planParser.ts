import { normText } from './normalize'
import { addDaysISO, compareISO, isoFromYMDClamped } from './dates'
import type { PlanParseResult } from './types'

// Ödeme Planı Kodu grameri (irsaliye dosyasındaki 49 farklı değerin tamamı incelendi):
//
//   'NAKİT'            → peşin; vade = irsaliye tarihi
//   '05.03.2026'       → doğrudan tek vade
//   '.30'              → irsaliye tarihi + 30 gün
//   '05 / 3-4-5'       → 05. gün; aylar 3,4,5 (TEK çizgi = liste)
//   '05/ 4--8--12'     → 05. gün; 4'ten 12'ye TÜM aylar (ÇİFT çizgi = aralık doldurma)
//   ''                 → vade = irsaliye tarihi ('tarih girilmedi' işaretiyle)
//
// Yıl daima irsaliye yılıdır; gün, ayın son gününe kıskaçlanır.

export function parseOdemePlani(raw: string | null | undefined, invoiceDateISO: string): PlanParseResult {
  const original = raw === null || raw === undefined ? '' : String(raw)
  const t = normText(original)
    // Unicode tireleri ASCII çift çizgiye indir: kullanıcılar em/en dash ile 'aralık' yazıyor
    .replace(/[—–―]/g, '--')

  if (!t) {
    return { status: 'empty_default', dueDates: [invoiceDateISO], note: 'Plan boş — vade irsaliye tarihi sayıldı' }
  }

  if (t === 'NAKIT') {
    return { status: 'cash', dueDates: [invoiceDateISO] }
  }

  // Doğrudan tarih: 05.03.2026
  const direct = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t)
  if (direct) {
    const day = parseInt(direct[1], 10)
    const month = parseInt(direct[2], 10)
    const year = parseInt(direct[3], 10)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { status: 'ok', dueDates: [isoFromYMDClamped(year, month, day)] }
    }
    return unparsed(original, invoiceDateISO)
  }

  // Net gün: '.30'
  const netDays = /^\.(\d{1,3})$/.exec(t)
  if (netDays) {
    const n = parseInt(netDays[1], 10)
    return { status: 'net_days', dueDates: [addDaysISO(invoiceDateISO, n)], note: `${n} gün vade` }
  }

  // Gün / ay-listesi
  const dayMonths = /^(\d{1,2})\s*\/\s*(.+)$/.exec(t)
  if (dayMonths) {
    const day = parseInt(dayMonths[1], 10)
    if (day < 1 || day > 31) return unparsed(original, invoiceDateISO)
    const months = parseMonthsExpr(dayMonths[2])
    if (!months) return unparsed(original, invoiceDateISO)

    const invoiceYear = parseInt(invoiceDateISO.slice(0, 4), 10)
    const dueDates = months.map((m) => isoFromYMDClamped(invoiceYear, m, day))
    dueDates.sort(compareISO)
    const note = dueDates[0] < invoiceDateISO ? 'Bazı vadeler irsaliye tarihinden önce' : undefined
    return { status: 'ok', dueDates, note }
  }

  return unparsed(original, invoiceDateISO)
}

/**
 * Ay ifadesini çözer: '3-4-5' → [3,4,5]; '4--8--12' → [4..12].
 * Çift (veya daha uzun) çizgi koşusu, iki sayı arasındaki tüm ayları doldurur.
 * Geçersiz yapıda null döner.
 */
function parseMonthsExpr(expr: string): number[] | null {
  const cleaned = expr.replace(/\s+/g, '')
  if (!cleaned) return null
  const tokens = cleaned.match(/\d+|-+/g)
  if (!tokens || tokens.join('') !== cleaned) return null

  const months: number[] = []
  let expectNumber = true
  let pendingRange = false

  for (const tok of tokens) {
    if (/^\d+$/.test(tok)) {
      if (!expectNumber) return null
      const m = parseInt(tok, 10)
      if (m < 1 || m > 12) return null
      if (pendingRange) {
        const prev = months[months.length - 1]
        if (m <= prev) return null
        for (let k = prev + 1; k <= m; k++) months.push(k)
      } else {
        months.push(m)
      }
      expectNumber = false
      pendingRange = false
    } else {
      if (expectNumber) return null
      pendingRange = tok.length >= 2
      expectNumber = true
    }
  }
  if (expectNumber) return null // ifade çizgiyle bitti

  // Tekilleştir, sırala
  return Array.from(new Set(months)).sort((a, b) => a - b)
}

function unparsed(original: string, invoiceDateISO: string): PlanParseResult {
  return {
    status: 'unparsed',
    dueDates: [invoiceDateISO],
    note: `Plan çözülemedi: "${original.trim().slice(0, 60)}" — vade irsaliye tarihi sayıldı`,
  }
}
