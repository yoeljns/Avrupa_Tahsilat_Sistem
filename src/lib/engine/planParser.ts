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
// YIL KURALI: aylar irsaliye yılından başlar ve YAZILDIĞI SIRAYLA ilerler.
//   * Sıra geriye dönerse yıl atlar: Ekim irsaliyesi '05/ 11-12-1-2' →
//     05.11, 05.12, 05.01 (ERTESİ YIL), 05.02 (ertesi yıl). Aralık da sarar:
//     '05/ 11--2' → 11, 12, 1, 2.
//   * İlk ay, irsaliye ayından 6+ ay GERİDEYSE plan ertesi yıla aittir:
//     Kasım irsaliyesi '05/1-2-3' → Ocak–Mart ertesi yıl.
//   * Aynı ay içinde günü geçmiş vade (ör. 08.04 irsaliyesi, '05/4-5-6' →
//     05.04) olduğu gibi kalır — veride yaygın ve bilinçli bir kullanım.
// Gün, ayın son gününe kıskaçlanır (31 Şubat → 28/29 Şubat).
//
// Vadelerden biri irsaliye tarihinden 30 günden fazla ÖNCEYSE sonuç
// 'supheli' işaretlenir; içe aktarma bunu inceleme kuyruğuna düşürür.

/** Bu kadar gün geriye düşen vade şüphelidir (inceleme kuyruğu). */
const SUPHELI_GERI_GUN = 30

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
      return withSuspicion({ status: 'ok', dueDates: [isoFromYMDClamped(year, month, day)] }, invoiceDateISO)
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
    const invoiceMonth = parseInt(invoiceDateISO.slice(5, 7), 10)
    // İlk ay irsaliye ayından 6+ ay gerideyse plan ertesi yıla aittir
    const first = months[0].month
    const baseYear = invoiceYear + (first < invoiceMonth && invoiceMonth - first >= 6 ? 1 : 0)
    const dueDates = Array.from(
      new Set(months.map((m) => isoFromYMDClamped(baseYear + m.yearOffset, m.month, day))),
    ).sort(compareISO)
    const note = dueDates[0] < invoiceDateISO ? 'Bazı vadeler irsaliye tarihinden önce' : undefined
    return withSuspicion({ status: 'ok', dueDates, note }, invoiceDateISO)
  }

  return unparsed(original, invoiceDateISO)
}

/** Vadelerden biri irsaliye tarihinden 30+ gün önceyse şüpheli işaretle. */
function withSuspicion(result: PlanParseResult, invoiceDateISO: string): PlanParseResult {
  const esik = addDaysISO(invoiceDateISO, -SUPHELI_GERI_GUN)
  if (result.dueDates.some((d) => d < esik)) {
    return {
      ...result,
      supheli: true,
      note: `Vade irsaliye tarihinden ${SUPHELI_GERI_GUN} günden fazla önce — plan yanlış yazılmış olabilir`,
    }
  }
  return result
}

interface PlanAyi {
  month: number
  /** İrsaliye (taban) yılına eklenecek yıl: yazım sırasında ay geriye dönünce artar */
  yearOffset: number
}

/**
 * Ay ifadesini YAZILDIĞI SIRAYLA çözer: '3-4-5' → [3,4,5]; '4--8--12' → [4..12];
 * '11-12-1-2' → [11, 12, 1(+1 yıl), 2(+1 yıl)]; '11--2' → aynı.
 * Çift (veya daha uzun) çizgi koşusu, iki sayı arasındaki tüm ayları doldurur.
 * Geçersiz yapıda null döner.
 */
function parseMonthsExpr(expr: string): PlanAyi[] | null {
  const cleaned = expr.replace(/\s+/g, '')
  if (!cleaned) return null
  const tokens = cleaned.match(/\d+|-+/g)
  if (!tokens || tokens.join('') !== cleaned) return null

  const out: PlanAyi[] = []
  let yearOffset = 0
  let prev: number | null = null
  let expectNumber = true
  let pendingRange = false

  for (const tok of tokens) {
    if (/^\d+$/.test(tok)) {
      if (!expectNumber) return null
      const m = parseInt(tok, 10)
      if (m < 1 || m > 12) return null
      if (pendingRange && prev !== null) {
        if (m === prev) return null
        // Yıl sonunu saran aralık ('11--2') en fazla 6 ay doldurabilir;
        // '5--3' gibi ters yazım (11 ay!) yazım hatasıdır → çözülemedi
        if (m < prev && 12 - prev + m > 6) return null
        // prev'den m'ye kadar doldur; Aralık'tan Ocak'a geçişte yıl artar
        let k: number = prev
        while (k !== m) {
          k = k === 12 ? 1 : k + 1
          if (k === 1) yearOffset++
          out.push({ month: k, yearOffset })
        }
      } else {
        if (prev !== null && m < prev) yearOffset++
        if (prev === null || m !== prev) out.push({ month: m, yearOffset })
      }
      prev = m
      expectNumber = false
      pendingRange = false
    } else {
      if (expectNumber) return null
      pendingRange = tok.length >= 2
      expectNumber = true
    }
  }
  if (expectNumber) return null // ifade çizgiyle bitti
  return out
}

function unparsed(original: string, invoiceDateISO: string): PlanParseResult {
  return {
    status: 'unparsed',
    dueDates: [invoiceDateISO],
    note: `Plan çözülemedi: "${original.trim().slice(0, 60)}" — vade irsaliye tarihi sayıldı`,
  }
}
