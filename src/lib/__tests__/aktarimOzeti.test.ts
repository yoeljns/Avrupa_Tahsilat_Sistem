import { describe, expect, it } from 'vitest'
import { aktarimOzeti } from '@/lib/import/etiketler'

// "Son Yüklemeler" ve içe aktarma sonucu: istatistiklerin Türkçe özeti.

describe('aktarimOzeti', () => {
  it('aktarım sonucu: Türkçe adlar, sabit sıra, binlik ayraç; sıfırlar atlanır', () => {
    expect(aktarimOzeti({ unchanged: 1977, inserted: 780, updated: 40, firmsCreated: 10, conflicts: 4, installments: 3646 })).toBe(
      '780 yeni · 40 güncellenen · 1.977 değişmeyen · 4 çakışma · 10 yeni firma · 3.646 taksit',
    )
    expect(aktarimOzeti({ inserted: 0, updated: 0, unchanged: 2344, firmsCreated: 0 })).toBe('2.344 değişmeyen')
  })

  it('önizleme sayıları: iç anahtarlar (kural_imzasi) ve sayı olmayanlar gösterilmez', () => {
    expect(aktarimOzeti({ new: 12, updated: 3, unchanged: 100, needs_review: 5, excluded_31_12: 47, invalid: 2, tip_degisecek: 1, kural_imzasi: 'ab12cd' })).toBe(
      '12 yeni · 3 güncellenen · 100 değişmeyen · 5 inceleme bekleyen · 1 kategorisi değişen · 47 31/12 hariç · 2 geçersiz satır',
    )
    expect(aktarimOzeti({ kural_imzasi: 'x', bilinmeyen: 5, new: '7' })).toBe('')
  })

  it('"inserted" varsa önizlemedeki "new" yinelenmez', () => {
    expect(aktarimOzeti({ new: 2, inserted: 671, updated: 2 })).toBe('671 yeni · 2 güncellenen')
  })

  it('boş ya da eksik veri: boş metin', () => {
    expect(aktarimOzeti(null)).toBe('')
    expect(aktarimOzeti(undefined)).toBe('')
    expect(aktarimOzeti({})).toBe('')
  })
})
