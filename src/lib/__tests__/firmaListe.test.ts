import { describe, expect, it } from 'vitest'
import {
  BOS_FIRMA_SUZGECI,
  SORUMLUSUZ_FIRMA,
  firmaSorumlulari,
  firmaSorumlusu,
  firmaToplami,
  firmalariSirala,
  firmalariSuz,
  siralamaDegistir,
  varsayilanYon,
} from '@/lib/firmaListe'
import type { FirmaListeSatiri } from '@/lib/queries'

// Firmalar listesi: arama, süzme, sıralama, toplam.

const f = (kod: string, ad: string, o: Partial<FirmaListeSatiri> = {}): FirmaListeSatiri => ({
  id: kod,
  kod,
  ad,
  sehir: null,
  sorumlu: null,
  oto: false,
  pesin: 0,
  vadeli: 0,
  alacak: 0,
  gecikmis: 0,
  ilk_vade: null,
  ...o,
})

const LISTE: FirmaListeSatiri[] = [
  f('34 K02', 'KARSEL BOYA', { sehir: 'İSTANBUL', sorumlu: 'ercan', pesin: 1000, vadeli: 50000, gecikmis: 20000, ilk_vade: '2026-08-05' }),
  f('06 Ç01', 'ÇAĞPAŞ BOYA', { sehir: 'ANKARA', sorumlu: 'levent', vadeli: 30000, ilk_vade: '2026-12-05' }),
  f('35 Z09', 'ZAFER HIRDAVAT', { sehir: 'İZMİR', alacak: 12000 }),
  f('34 B01', 'BAKSAN', { sorumlu: 'ercan', pesin: 7000 }),
  f('16 Ö03', 'ÖZGÜVEN', { sehir: 'BURSA' }),
]
const kodlar = (l: FirmaListeSatiri[]) => l.map((x) => x.kod)

describe('firmalariSuz', () => {
  it('arama: kod, ad ve şehirde; Türkçe harf ve büyük/küçük duyarsız', () => {
    expect(kodlar(firmalariSuz(LISTE, { ...BOS_FIRMA_SUZGECI, arama: 'cagpas' }))).toEqual(['06 Ç01'])
    expect(kodlar(firmalariSuz(LISTE, { ...BOS_FIRMA_SUZGECI, arama: 'ÖZGÜ' }))).toEqual(['16 Ö03'])
    expect(kodlar(firmalariSuz(LISTE, { ...BOS_FIRMA_SUZGECI, arama: '34k' }))).toEqual(['34 K02'])
    expect(kodlar(firmalariSuz(LISTE, { ...BOS_FIRMA_SUZGECI, arama: 'izmir' }))).toEqual(['35 Z09'])
    expect(firmalariSuz(LISTE, { ...BOS_FIRMA_SUZGECI, arama: 'yok böyle' })).toEqual([])
    expect(firmalariSuz(LISTE, BOS_FIRMA_SUZGECI)).toHaveLength(5)
  })

  it('durum süzgeçleri', () => {
    const durum = (d: 'borclu' | 'gecikmis' | 'alacakli' | 'temiz') => kodlar(firmalariSuz(LISTE, { ...BOS_FIRMA_SUZGECI, durum: d }))
    expect(durum('borclu')).toEqual(['34 K02', '06 Ç01', '34 B01'])
    expect(durum('gecikmis')).toEqual(['34 K02'])
    expect(durum('alacakli')).toEqual(['35 Z09'])
    expect(durum('temiz')).toEqual(['16 Ö03'])
  })

  it('sorumlu süzgeci: ad büyük harfle karşılaştırılır; "-" sorumlusuzları verir; süzgeçler birlikte çalışır', () => {
    expect(kodlar(firmalariSuz(LISTE, { ...BOS_FIRMA_SUZGECI, sorumlu: 'ERCAN' }))).toEqual(['34 K02', '34 B01'])
    expect(kodlar(firmalariSuz(LISTE, { ...BOS_FIRMA_SUZGECI, sorumlu: SORUMLUSUZ_FIRMA }))).toEqual(['35 Z09', '16 Ö03'])
    expect(kodlar(firmalariSuz(LISTE, { arama: 'bak', durum: 'borclu', sorumlu: 'ERCAN' }))).toEqual(['34 B01'])
    expect(firmaSorumlusu({ sorumlu: ' ercan ' })).toBe('ERCAN')
    expect(firmaSorumlusu({ sorumlu: '' })).toBeNull()
    expect(firmaSorumlulari(LISTE)).toEqual({ sorumlular: ['ERCAN', 'LEVENT'], sorumlusuzVar: true })
  })
})

describe('firmalariSirala', () => {
  it('metin sütunları Türkçe sırayla; özgün liste değişmez', () => {
    expect(kodlar(firmalariSirala(LISTE, { alan: 'ad', yon: 'artan' }))).toEqual(['34 B01', '06 Ç01', '34 K02', '16 Ö03', '35 Z09'])
    expect(kodlar(firmalariSirala(LISTE, { alan: 'ad', yon: 'azalan' }))).toEqual(['35 Z09', '16 Ö03', '34 K02', '06 Ç01', '34 B01'])
    expect(kodlar(firmalariSirala(LISTE, { alan: 'kod', yon: 'artan' }))).toEqual(['06 Ç01', '16 Ö03', '34 B01', '34 K02', '35 Z09'])
    expect(kodlar(LISTE)).toEqual(['34 K02', '06 Ç01', '35 Z09', '34 B01', '16 Ö03'])
  })

  it('tutar sütunları; toplam = peşin + konsinye; eşitlikte kod sırası', () => {
    expect(kodlar(firmalariSirala(LISTE, { alan: 'toplam', yon: 'azalan' }))).toEqual(['34 K02', '06 Ç01', '34 B01', '16 Ö03', '35 Z09'])
    expect(kodlar(firmalariSirala(LISTE, { alan: 'pesin', yon: 'azalan' })).slice(0, 2)).toEqual(['34 B01', '34 K02'])
    expect(kodlar(firmalariSirala(LISTE, { alan: 'alacak', yon: 'azalan' }))[0]).toBe('35 Z09')
    expect(kodlar(firmalariSirala(LISTE, { alan: 'gecikmis', yon: 'artan' })).slice(-1)).toEqual(['34 K02'])
  })

  it('boş değerler (ilk vade, şehir, sorumlu) iki yönde de sonda kalır', () => {
    expect(kodlar(firmalariSirala(LISTE, { alan: 'ilk_vade', yon: 'artan' })).slice(0, 2)).toEqual(['34 K02', '06 Ç01'])
    expect(kodlar(firmalariSirala(LISTE, { alan: 'ilk_vade', yon: 'azalan' })).slice(0, 2)).toEqual(['06 Ç01', '34 K02'])
    expect(kodlar(firmalariSirala(LISTE, { alan: 'sehir', yon: 'artan' }))).toEqual(['06 Ç01', '16 Ö03', '34 K02', '35 Z09', '34 B01'])
    expect(kodlar(firmalariSirala(LISTE, { alan: 'sehir', yon: 'azalan' })).slice(-1)).toEqual(['34 B01'])
    expect(kodlar(firmalariSirala(LISTE, { alan: 'sorumlu', yon: 'artan' })).slice(0, 3)).toEqual(['34 B01', '34 K02', '06 Ç01'])
  })

  it('başlığa tıklama: aynı sütun yönü çevirir; yeni sütun kendi varsayılan yönüyle başlar', () => {
    expect(siralamaDegistir({ alan: 'kod', yon: 'artan' }, 'kod')).toEqual({ alan: 'kod', yon: 'azalan' })
    expect(siralamaDegistir({ alan: 'kod', yon: 'artan' }, 'toplam')).toEqual({ alan: 'toplam', yon: 'azalan' })
    expect(siralamaDegistir({ alan: 'toplam', yon: 'azalan' }, 'ad')).toEqual({ alan: 'ad', yon: 'artan' })
    expect(varsayilanYon('ilk_vade')).toBe('artan')
    expect(varsayilanYon('gecikmis')).toBe('azalan')
  })
})

describe('firmaToplami', () => {
  it('toplamlar ve sayımlar', () => {
    expect(firmaToplami(LISTE)).toEqual({ firma: 5, pesin: 8000, vadeli: 80000, toplam: 88000, gecikmis: 20000, alacak: 12000, borclu: 3, geciken: 1, alacakli: 1 })
    expect(firmaToplami([])).toMatchObject({ firma: 0, toplam: 0 })
  })
})
