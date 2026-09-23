import { formatCents } from '@/lib/engine/money'

/** 5141486 → '51.414,86 €' */
export function eur(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return formatCents(cents) + ' €'
}

/** '2026-03-05' → '05.03.2026' */
export function trDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}.${m}.${y}`
}

// İş Türkiye saatine göre yürür: "bugün" ve saatler Europe/Istanbul'dur.
// (UTC kullanılsaydı gece 00:00-03:00 arası sistem hâlâ "dün"de kalırdı.)
const ISTANBUL = 'Europe/Istanbul'

function istanbulParcalari(d: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ISTANBUL,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const out: Record<string, string> = {}
  for (const p of parts) out[p.type] = p.value
  return out
}

/** ISO zaman damgası → '05.03.2026 14:30' (Türkiye saati) */
export function trDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = istanbulParcalari(d)
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`
}

/** Bugünün ISO günü (Türkiye saatine göre). */
export function todayISO(now: Date = new Date()): string {
  const p = istanbulParcalari(now)
  return `${p.year}-${p.month}-${p.day}`
}

/** 'YYYY-MM' → Türkçe ay adı: '2026-03' → 'Mart 2026' */
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
export function trMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return yyyyMm
  return `${AYLAR[m - 1]} ${y}`
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

/** Ay ekle/çıkar: ('2026-03', +1) → '2026-04' */
export function addMonths(yyyyMm: string, delta: number): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

export const SIDE_LABELS: Record<string, string> = {
  PESIN: 'Peşin',
  VADELI: 'Konsinye / Vadeli',
}

export const SALE_TYPE_LABELS: Record<string, string> = {
  PESIN: 'Peşin',
  KONSINYE: 'Konsinye',
  KONSINYE_PESIN: 'Konsinye Peşin',
  OTHER: 'Sınıflandırılmadı',
}
