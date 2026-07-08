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

/** ISO zaman damgası → '05.03.2026 14:30' */
export function trDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** Bugünün ISO günü (UTC). */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
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
