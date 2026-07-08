import { describe, expect, it } from 'vitest'
import { foldFirmCodeForExclusion, foldTurkish, normText, normalizeFirmCode } from '../normalize'

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

describe('normalizeFirmCode — firma KİMLİĞİ (Türkçe harfler korunur)', () => {
  it("'34 O02' (ORMAK) ve '34 Ö02' (ÖZ KARADENİZ) FARKLI firmalar olarak kalır", () => {
    expect(normalizeFirmCode('34 O02')).not.toBe(normalizeFirmCode('34 Ö02'))
  })
  it('boşlukları tekler ve kırpar, harfleri değiştirmez', () => {
    expect(normalizeFirmCode('  06  K08 ')).toBe('06 K08')
    expect(normalizeFirmCode('54 Ç03')).toBe('54 Ç03')
    expect(normalizeFirmCode('A35 B03')).toBe('A35 B03')
  })
})

describe('foldFirmCodeForExclusion — hariç liste eşleşmesi (katlanır)', () => {
  it("verideki '34 Ş01' listedeki '34 S01' ile eşleşir", () => {
    expect(foldFirmCodeForExclusion('34 Ş01')).toBe(foldFirmCodeForExclusion('34 S01'))
  })
  it("verideki '54 Ç03' listedeki '54 C03' ile eşleşir", () => {
    expect(foldFirmCodeForExclusion('54 Ç03')).toBe(foldFirmCodeForExclusion('54 C03'))
  })
  it('katlama bilinçli olarak muhafazakârdır: O02 ve Ö02 aynı hariç koduna denk gelir', () => {
    expect(foldFirmCodeForExclusion('34 O02')).toBe(foldFirmCodeForExclusion('34 Ö02'))
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
