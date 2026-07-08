import { describe, expect, it } from 'vitest'
import { foldTurkish, normText, normalizeFirmCode } from '../normalize'

describe('foldTurkish', () => {
  it('Türkçe harfleri ASCII büyük harfe katlar', () => {
    expect(foldTurkish('KONSİNYE PEŞİN')).toBe('KONSINYE PESIN')
    expect(foldTurkish('konsinye peşin')).toBe('KONSINYE PESIN')
    expect(foldTurkish('Çağpaş')).toBe('CAGPAS')
    expect(foldTurkish('ığüşöç İĞÜŞÖÇ')).toBe('IGUSOC IGUSOC')
  })

  it('naif toUpperCase tuzağını belgeler: İ içeren metin katlama olmadan eşleşmez', () => {
    expect('KONSİNYE'.toUpperCase().includes('KONSINYE')).toBe(false)
    expect(foldTurkish('KONSİNYE').includes('KONSINYE')).toBe(true)
  })
})

describe('normalizeFirmCode — hariç liste eşleşmesi', () => {
  it("verideki '34 Ş01' listedeki '34 S01' ile aynı koda iner", () => {
    expect(normalizeFirmCode('34 Ş01')).toBe(normalizeFirmCode('34 S01'))
  })
  it("verideki '54 Ç03' listedeki '54 C03' ile aynı koda iner", () => {
    expect(normalizeFirmCode('54 Ç03')).toBe(normalizeFirmCode('54 C03'))
  })
  it('boşlukları tekler ve kırpar', () => {
    expect(normalizeFirmCode('  06  K08 ')).toBe('06 K08')
    expect(normalizeFirmCode('A35 B03')).toBe('A35 B03')
  })
})

describe('normText', () => {
  it('null/undefined boş döner', () => {
    expect(normText(null)).toBe('')
    expect(normText(undefined)).toBe('')
  })
  it('çift boşluklu KONSİNYE  REVİZE tek boşluğa iner', () => {
    expect(normText('KONSİNYE  REVİZE')).toBe('KONSINYE REVIZE')
  })
})
