import { describe, expect, it } from 'vitest'
import { buildInstallments } from '../installments'

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
