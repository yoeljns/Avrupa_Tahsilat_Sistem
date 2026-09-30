import { describe, expect, it } from 'vitest'
import { vadesiGecmisHaritasi } from '@/lib/export/vadesiGecmis'
import { cronYetkili, trGunBasiUtc } from '@/lib/geceHesabi'
import { tetikAdi } from '@/lib/kosuEtiketleri'
import { oneriKurus } from '@/lib/odemeTutari'

// 0008 düzeltme paketinin saf yardımcıları.

describe('Excel "Vadesi Geçmiş": bugüne göre, konsinye, firma başına', () => {
  const bugun = '2026-09-30'
  const satirlar = [
    { firm_id: 'a', side: 'VADELI', due_date: '2026-09-29', remaining_eur_cents: 1000 }, // dün → gecikmiş
    { firm_id: 'a', side: 'VADELI', due_date: '2026-09-30', remaining_eur_cents: 500 }, // bugün → gecikmemiş
    { firm_id: 'a', side: 'VADELI', due_date: '2026-08-01', remaining_eur_cents: 0 }, // ödenmiş
    { firm_id: 'a', side: 'PESIN', due_date: '2026-01-01', remaining_eur_cents: 700 }, // peşin sayılmaz
    { firm_id: 'b', side: 'VADELI', due_date: '2026-07-15', remaining_eur_cents: 250 },
    { firm_id: 'b', side: 'VADELI', due_date: '2026-09-01', remaining_eur_cents: 250 },
  ]
  it('yalnız VADELİ, kalan > 0 ve vade < bugün toplanır', () => {
    const h = vadesiGecmisHaritasi(satirlar, bugun)
    expect(h.get('a')).toBe(1000)
    expect(h.get('b')).toBe(500)
  })
  it('gecikmişi olmayan firma haritada yok', () => {
    expect(vadesiGecmisHaritasi(satirlar, '2026-07-01').get('a')).toBeUndefined()
  })
})

describe('gece hesabı yardımcıları', () => {
  it('CRON_SECRET yoksa uç açıktır (günlük koruma sınırlar)', () => {
    expect(cronYetkili(null, null)).toBe(true)
    expect(cronYetkili('Bearer herhangi', null)).toBe(true)
  })
  it('CRON_SECRET varsa yalnız doğru Bearer başlığı', () => {
    expect(cronYetkili('Bearer gizli-123', 'gizli-123')).toBe(true)
    expect(cronYetkili('Bearer gizli-124', 'gizli-123')).toBe(false)
    expect(cronYetkili('gizli-123', 'gizli-123')).toBe(false)
    expect(cronYetkili(null, 'gizli-123')).toBe(false)
  })
  it('Türkiye gün başı UTC 21:00 (önceki gün)', () => {
    expect(trGunBasiUtc('2026-10-01')).toBe('2026-09-30T21:00:00.000Z')
    expect(trGunBasiUtc('2027-01-01')).toBe('2026-12-31T21:00:00.000Z')
  })
  it('hesap türü etiketleri', () => {
    expect(tetikAdi('cron')).toBe('gece (otomatik)')
    expect(tetikAdi('manual')).toBe('elle')
    expect(tetikAdi('bilinmeyen')).toBe('bilinmeyen')
  })
})

describe('EUR önerisi: GELEN TL ÷ kur', () => {
  it('930.000 TL, kur 53,5017 → 17.382,63 €', () => expect(oneriKurus(930000, 53.5017)).toBe(1738263))
  it('kur ya da TL yoksa öneri yok', () => {
    expect(oneriKurus(930000, null)).toBeNull()
    expect(oneriKurus(null, 53.5)).toBeNull()
    expect(oneriKurus(0, 53.5)).toBeNull()
    expect(oneriKurus(1000, 0)).toBeNull()
  })
})
