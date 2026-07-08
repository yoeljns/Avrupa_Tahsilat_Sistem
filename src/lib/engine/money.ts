// Para: tüm hesap EUR tam kuruş (cent) tamsayısıyla yapılır — float kayması olmaz.

/**
 * '51414,86 €', '51.414,86 €', '2.583.832,87', '5416.82' gibi metinleri cent'e çevirir.
 * Kural: hem '.' hem ',' varsa '.' binlik ayracıdır; yalnız ',' varsa ondalıktır;
 * yalnız '.' varsa son gruptaki hane sayısına bakılır (1-2 hane → ondalık, 3 hane → binlik).
 * Sayı ayrıştırılamazsa null döner.
 */
export function parseEurToCents(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return numberToCents(raw)

  let s = String(raw)
    .replace(/[€€]/g, '')
    .replace(/[\s  ]/g, '')
    .trim()
  if (!s) return null

  let negative = false
  if (s.startsWith('-')) {
    negative = true
    s = s.slice(1)
  }
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true
    s = s.slice(1, -1)
  }

  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  let intPart = ''
  let fracPart = ''

  if (hasComma) {
    // ',' ondalık; tüm '.' binlik
    const cleaned = s.replace(/\./g, '')
    const pieces = cleaned.split(',')
    if (pieces.length > 2) return null
    intPart = pieces[0] || '0'
    fracPart = pieces[1] ?? ''
  } else if (hasDot) {
    const pieces = s.split('.')
    const last = pieces[pieces.length - 1]
    if (pieces.length === 2 && last.length <= 2) {
      // '5416.82' → ondalık nokta
      intPart = pieces[0] || '0'
      fracPart = last
    } else if (pieces.every((p, i) => (i === 0 ? p.length >= 1 : p.length === 3))) {
      // '2.583.832' → binlik ayraçlar
      intPart = pieces.join('')
    } else {
      return null
    }
  } else {
    intPart = s
  }

  if (!/^\d+$/.test(intPart)) return null
  if (fracPart && !/^\d+$/.test(fracPart)) return null

  const frac2 = (fracPart + '00').slice(0, 2)
  // 3+ haneli ondalıkta yuvarla
  let cents = parseInt(intPart, 10) * 100 + parseInt(frac2 || '0', 10)
  if (fracPart.length > 2 && parseInt(fracPart[2], 10) >= 5) cents += 1
  return negative ? -cents : cents
}

/** Sayısal EUR değerini (Excel hücresi) cent'e çevirir. */
export function numberToCents(n: number | null | undefined): number | null {
  if (n === null || n === undefined || Number.isNaN(n) || !Number.isFinite(n)) return null
  return Math.round(n * 100)
}

/** Cent → 'tr-TR' görünümü: 51414,86 gibi. UI katmanında € işareti eklenir. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const intPart = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  const intStr = intPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${sign}${intStr},${frac}`
}
