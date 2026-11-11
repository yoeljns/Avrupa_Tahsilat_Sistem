import { describe, expect, it } from 'vitest'
import { aramayaHazirla, firmaAra } from '@/lib/firmaArama'

// Üst çubuktaki firma arama: eşleşme ve sıralama.

const LISTE = aramayaHazirla([
  { id: '1', kod: '34 K02', ad: 'KARSEL BOYA SAN. VE TİC. LTD. ŞTİ.', sehir: 'İSTANBUL' },
  { id: '2', kod: '06 Ç01', ad: 'ÇAĞPAŞ BOYA İNŞAAT', sehir: 'ANKARA' },
  { id: '3', kod: '35 B07', ad: 'BOYACIOĞLU HIRDAVAT', sehir: 'İZMİR' },
  { id: '4', kod: '34 B01', ad: 'BAKSAN YAPI MARKET', sehir: null },
  { id: '5', kod: '16 Ö03', ad: 'ÖZ-GÜVEN NALBURİYE', sehir: 'BURSA' },
  { id: '6', kod: '34 A11', ad: 'AKIN BOYA', sehir: 'İSTANBUL' },
])
const kodlar = (sorgu: string, sinir?: number) => firmaAra(LISTE, sorgu, sinir).map((f) => f.kod)

describe('firmaAra', () => {
  it('boş sorgu sonuç vermez', () => {
    expect(kodlar('')).toEqual([])
    expect(kodlar('   ')).toEqual([])
  })

  it('kod ile: boşluklu ya da bitişik, büyük/küçük duyarsız', () => {
    expect(kodlar('34 k02')).toEqual(['34 K02'])
    expect(kodlar('34k')).toEqual(['34 K02'])
    expect(kodlar('06ç')).toEqual(['06 Ç01'])
    expect(kodlar('06c')).toEqual(['06 Ç01'])
  })

  it('ad ile: Türkçe harf duyarsız; şehirde de arar', () => {
    expect(kodlar('cagpas')).toEqual(['06 Ç01'])
    expect(kodlar('ÇAĞPAŞ')).toEqual(['06 Ç01'])
    expect(kodlar('ozguven')).toEqual(['16 Ö03']) // noktalama da yok sayılır (ÖZ-GÜVEN)
    expect(kodlar('öz güven')).toEqual(['16 Ö03'])
    expect(kodlar('san.ve tic')).toEqual(['34 K02'])
    expect(kodlar('bursa')).toEqual(['16 Ö03'])
    expect(kodlar('yok böyle firma')).toEqual([])
  })

  it('birden çok sözcük: hepsi geçmeli, sırası önemsiz', () => {
    expect(kodlar('boya istanbul')).toEqual(['34 A11', '34 K02'])
    expect(kodlar('istanbul boya karsel')).toEqual(['34 K02'])
    expect(kodlar('boya izmir')).toEqual(['35 B07']) // BOYAcıoğlu + İZMİR
  })

  it('sıra: kodu başlayan → adı başlayan → adındaki sözcük başlayan → içinde geçen; eşitlikte ada göre', () => {
    // "b": kodunda yok; adı B ile başlayanlar önce (ada göre), sonra bir sözcüğü B ile başlayanlar
    expect(kodlar('boya')).toEqual(['35 B07', '34 A11', '06 Ç01', '34 K02'])
    // "34": kodu 34 ile başlayanlar (ada göre)
    expect(kodlar('34')).toEqual(['34 A11', '34 B01', '34 K02'])
    // "guven": yalnız sözcük başı (ÖZ-GÜVEN tireyle ayrılır)
    expect(kodlar('guven')).toEqual(['16 Ö03'])
    // "aksan": yalnız içinde geçiyor (BAKSAN)
    expect(kodlar('aksan')).toEqual(['34 B01'])
  })

  it('en çok `sinir` sonuç', () => {
    expect(kodlar('a', 2)).toHaveLength(2)
    expect(firmaAra(LISTE, 'a').length).toBeLessThanOrEqual(8)
  })
})
