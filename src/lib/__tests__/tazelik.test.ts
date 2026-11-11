import { describe, expect, it } from 'vitest'
import type { VeriTazeligi } from '@/lib/queries'
import { ESKI_VERI_GUNU, tazelikDurumu } from '@/lib/tazelik'

// Pano ve PDF rapordaki "veriler eski" uyarısının kuralı.

const t = (o: Partial<VeriTazeligi>): VeriTazeligi => ({ son_irsaliye_yukleme: null, son_odeme_yukleme: null, son_irsaliye_tarihi: null, son_odeme_tarihi: null, son_hesap: null, ...o })

describe('tazelikDurumu', () => {
  it('gün farkı: ay ve yıl geçişinde de doğru', () => {
    expect(tazelikDurumu(t({ son_odeme_tarihi: '2026-09-18', son_irsaliye_tarihi: '2026-09-21' }), '2026-11-11')).toEqual({ odemeYasi: 54, irsaliyeYasi: 51, eski: true })
    expect(tazelikDurumu(t({ son_odeme_tarihi: '2025-12-30' }), '2026-01-02')).toMatchObject({ odemeYasi: 3, eski: false })
  })

  it('eşik: tam eşikte uyarı yok, bir gün sonra var', () => {
    expect(ESKI_VERI_GUNU).toBe(7)
    expect(tazelikDurumu(t({ son_odeme_tarihi: '2026-11-04' }), '2026-11-11')).toMatchObject({ odemeYasi: 7, eski: false })
    expect(tazelikDurumu(t({ son_odeme_tarihi: '2026-11-03' }), '2026-11-11')).toMatchObject({ odemeYasi: 8, eski: true })
    expect(tazelikDurumu(t({ son_odeme_tarihi: '2026-11-03' }), '2026-11-11', 30)).toMatchObject({ eski: false })
  })

  it('ödeme kaydı hiç yoksa eski sayılır; tazelik bilgisi yoksa uyarı yok (null)', () => {
    expect(tazelikDurumu(t({ son_irsaliye_tarihi: '2026-11-10' }), '2026-11-11')).toEqual({ odemeYasi: null, irsaliyeYasi: 1, eski: true })
    expect(tazelikDurumu(null, '2026-11-11')).toBeNull()
    expect(tazelikDurumu(undefined, '2026-11-11')).toBeNull()
  })
})
