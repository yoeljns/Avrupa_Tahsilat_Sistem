import { describe, expect, it } from 'vitest'
import { esitBol, taksitOzeti } from '@/lib/taksit'

// İrsaliye penceresi: "Eşit böl" ve canlı taksit toplamı.

describe('esitBol', () => {
  it('toplam her zaman tutara eşit; artan kuruşlar ilk taksitlerde', () => {
    expect(esitBol(10000, 3)).toEqual([3334, 3333, 3333])
    expect(esitBol(10000, 4)).toEqual([2500, 2500, 2500, 2500])
    expect(esitBol(5, 3)).toEqual([2, 2, 1])
    expect(esitBol(0, 2)).toEqual([0, 0])
    expect(esitBol(5141486, 1)).toEqual([5141486])
    for (const [tutar, adet] of [[5141486, 7], [1, 36], [999999999, 11]] as const) {
      const p = esitBol(tutar, adet)
      expect(p).toHaveLength(adet)
      expect(p.reduce((a, b) => a + b, 0)).toBe(tutar)
      expect(Math.max(...p) - Math.min(...p)).toBeLessThanOrEqual(1)
    }
  })

  it('geçersiz girdide boş dizi', () => {
    expect(esitBol(100, 0)).toEqual([])
    expect(esitBol(100, -2)).toEqual([])
    expect(esitBol(100, 1.5)).toEqual([])
    expect(esitBol(-100, 2)).toEqual([])
    expect(esitBol(10.5, 2)).toEqual([])
  })
})

describe('taksitOzeti', () => {
  const t = (dueDate: string, amountEur: string) => ({ dueDate, amountEur })

  it('toplam ve fark: Türkçe yazımla; fark 0 ise geçerli', () => {
    const o = taksitOzeti([t('2026-03-05', '17.138,29'), t('2026-04-05', '17.138,29'), t('2026-05-05', '17.138,28')], 5141486)
    expect(o).toEqual({ toplam: 5141486, fark: 0, okunamayan: 0, tarihsiz: 0, gecerli: true })
  })

  it('fazla / eksik: fark işaretli; geçersiz', () => {
    expect(taksitOzeti([t('2026-03-05', '600,00'), t('2026-04-05', '500,00')], 100000)).toMatchObject({ toplam: 110000, fark: 10000, gecerli: false })
    expect(taksitOzeti([t('2026-03-05', '600,00')], 100000)).toMatchObject({ toplam: 60000, fark: -40000, gecerli: false })
  })

  it('okunamayan tutar ve eksik tarih sayılır; toplam tutsa bile geçersiz', () => {
    expect(taksitOzeti([t('2026-03-05', '1.000,00'), t('', '0,00')], 100000)).toMatchObject({ fark: 0, tarihsiz: 1, gecerli: false })
    expect(taksitOzeti([t('2026-03-05', '1.000,00'), t('2026-04-05', 'abc')], 100000)).toMatchObject({ toplam: 100000, okunamayan: 1, gecerli: false })
    expect(taksitOzeti([t('2026-03-05', '-5,00'), t('2026-04-05', '')], 100000)).toMatchObject({ toplam: 0, okunamayan: 2, gecerli: false })
  })

  it('irsaliye tutarı bilinmiyorsa fark null; taksit yoksa geçersiz', () => {
    expect(taksitOzeti([t('2026-03-05', '10,00')], null)).toMatchObject({ toplam: 1000, fark: null, gecerli: false })
    expect(taksitOzeti([], 0)).toMatchObject({ toplam: 0, fark: 0, gecerli: false })
  })
})
