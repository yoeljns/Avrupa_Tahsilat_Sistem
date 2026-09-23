import { describe, expect, it } from 'vitest'
import { buildInstallments, scaleInstallmentAmounts } from '../installments'

describe('buildInstallments — eşit bölme, küsurat son taksite', () => {
  it('60.000,00 € üç vadeye 20.000 + 20.000 + 20.000', () => {
    const r = buildInstallments(6000000, ['2026-03-05', '2026-04-05', '2026-05-05'])
    expect(r.map((x) => x.amountCents)).toEqual([2000000, 2000000, 2000000])
  })

  it('100,00 € üç vadeye 33,33 + 33,33 + 33,34 (kalan sonda)', () => {
    const r = buildInstallments(10000, ['2026-03-05', '2026-04-05', '2026-05-05'])
    expect(r.map((x) => x.amountCents)).toEqual([3333, 3333, 3334])
    expect(r.reduce((s, x) => s + x.amountCents, 0)).toBe(10000)
  })

  it('tek vade tam tutarı alır; tarihler sıralanır; seq 1-tabanlı', () => {
    const r = buildInstallments(5141486, ['2026-05-05', '2026-03-05'])
    expect(r[0]).toEqual({ seq: 1, dueDate: '2026-03-05', amountCents: 2570743 })
    expect(r[1]).toEqual({ seq: 2, dueDate: '2026-05-05', amountCents: 2570743 })
    expect(buildInstallments(75701, ['2026-05-05'])).toEqual([{ seq: 1, dueDate: '2026-05-05', amountCents: 75701 }])
  })

  it('boş tarih listesi boş döner', () => {
    expect(buildInstallments(1000, [])).toEqual([])
  })
})

describe('scaleInstallmentAmounts — elle taksitler yeni tutara oranlanır', () => {
  it('oranlar korunur, küsurat son taksite, toplam birebir yeni tutar', () => {
    const r = scaleInstallmentAmounts([7327103, 7327103, 7327102], 25000000)
    expect(r.reduce((s, x) => s + x, 0)).toBe(25000000)
    expect(r[0]).toBe(r[1])
    expect(r).toEqual([8333333, 8333333, 8333334])
  })

  it('eşit olmayan dağılımda oran korunur (1:3)', () => {
    expect(scaleInstallmentAmounts([100, 300], 1000)).toEqual([250, 750])
  })

  it('toplam değişmediyse aynen döner; eski toplam 0 ise eşit böler', () => {
    expect(scaleInstallmentAmounts([500, 500], 1000)).toEqual([500, 500])
    expect(scaleInstallmentAmounts([0, 0, 0], 1000)).toEqual([333, 333, 334])
  })

  it('çok büyük tutarlarda (milyonlarca €) kuruş kaybı olmaz', () => {
    const r = scaleInstallmentAmounts([900_000_000_00, 100_000_000_00], 1_234_567_890_12)
    expect(r.reduce((s, x) => s + x, 0)).toBe(1_234_567_890_12)
  })
})
