import { timingSafeEqual } from 'node:crypto'

// Gece otomatik tam hesabının saf yardımcıları (test edilebilir; ağ/veritabanı yok).

/**
 * Vercel Cron, CRON_SECRET tanımlıysa her çağrıda "Authorization: Bearer <CRON_SECRET>"
 * gönderir. Anahtar tanımlı değilse uç herkese açıktır; günlük koruma onu günde en
 * fazla bir hesapla sınırlar.
 */
export function cronYetkili(authorization: string | null, secret: string | null): boolean {
  if (!secret) return true
  const beklenen = Buffer.from(`Bearer ${secret}`)
  const gelen = Buffer.from(authorization ?? '')
  return gelen.length === beklenen.length && timingSafeEqual(gelen, beklenen)
}

/** Türkiye gününün başlangıcı (00:00, UTC+3) UTC olarak: '2026-10-01' → '2026-09-30T21:00:00.000Z'. */
export function trGunBasiUtc(bugun: string): string {
  return new Date(`${bugun}T00:00:00+03:00`).toISOString()
}
