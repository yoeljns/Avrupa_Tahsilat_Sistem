import { describe, expect, it } from 'vitest'
import { reconcile } from '../reconcile'
import type { EngineInstallment, EnginePayment } from '../types'

function inst(p: Partial<EngineInstallment> & { id: string }): EngineInstallment {
  return {
    invoiceId: `inv-${p.id}`,
    firmId: 'F1',
    side: 'VADELI',
    dueDate: '2026-03-05',
    invoiceDate: '2026-01-05',
    fisNo: `AVI${p.id}`,
    seq: 1,
    amountCents: 10000,
    ...p,
  }
}

function pay(p: Partial<EnginePayment> & { id: string }): EnginePayment {
  return {
    islemKodu: `ISL-${p.id}`,
    firmId: 'F1',
    dateISO: '2026-02-01T00:00:00.000Z',
    amountCents: 10000,
    ...p,
  }
}

describe('reconcile — tek havuz: önce peşin, sonra en yakın vade', () => {
  it('ATAMAN altın senaryosu: PEŞİN sayfasından gelen ödemeler konsinye borcunu kapatır', () => {
    // 01 A03: iki konsinye taksiti (9.600 € + 14.933,33 €), iki ödeme aynı tutarlarda.
    // Eski taraf-yalıtımı kuralında ödemeler alacakta beklerdi; yeni kuralda borç kapanır.
    const out = reconcile({
      installments: [
        inst({ id: 'K1', side: 'VADELI', dueDate: '2026-03-31', amountCents: 960000, fisNo: 'AVI2026000000844' }),
        inst({ id: 'K2', side: 'VADELI', dueDate: '2026-05-15', amountCents: 1493333, fisNo: 'AVI2026000001380' }),
      ],
      payments: [
        pay({ id: 'P1', dateISO: '2026-04-17T00:00:00.000Z', amountCents: 960000 }),
        pay({ id: 'P2', dateISO: '2026-06-08T00:00:00.000Z', amountCents: 1493333 }),
      ],
      asOf: '2026-07-08',
    })
    expect(out.remainingByInstallment.get('K1')).toBe(0)
    expect(out.remainingByInstallment.get('K2')).toBe(0)
    const bal = out.balances[0]
    expect(bal.pesinOpenCents).toBe(0)
    expect(bal.vadeliOpenCents).toBe(0)
    expect(bal.creditCents).toBe(0)
    expect(out.allocations).toEqual([
      expect.objectContaining({ paymentId: 'P1', installmentId: 'K1', amountCents: 960000 }),
      expect.objectContaining({ paymentId: 'P2', installmentId: 'K2', amountCents: 1493333 }),
    ])
  })

  it('peşin borç HER ZAMAN önce kapanır — vadeli taksit daha erken tarihli olsa bile', () => {
    const out = reconcile({
      installments: [
        inst({ id: 'V', side: 'VADELI', dueDate: '2026-02-05', amountCents: 5000 }),
        inst({ id: 'P', side: 'PESIN', dueDate: '2026-06-01', invoiceDate: '2026-06-01', amountCents: 8000 }),
      ],
      payments: [pay({ id: 'P1', amountCents: 10000 })],
      asOf: '2026-07-08',
    })
    // Önce peşin (8000), kalan 2000 en yakın vadeli taksite
    expect(out.allocations[0]).toEqual(expect.objectContaining({ installmentId: 'P', amountCents: 8000 }))
    expect(out.allocations[1]).toEqual(expect.objectContaining({ installmentId: 'V', amountCents: 2000 }))
    expect(out.remainingByInstallment.get('P')).toBe(0)
    expect(out.remainingByInstallment.get('V')).toBe(3000)
    expect(out.balances[0].pesinOpenCents).toBe(0)
    expect(out.balances[0].vadeliOpenCents).toBe(3000)
  })

  it('peşin borçlar kendi içinde en eski irsaliyeden başlar', () => {
    const out = reconcile({
      installments: [
        inst({ id: 'P2', side: 'PESIN', dueDate: '2026-03-01', invoiceDate: '2026-03-01', amountCents: 5000 }),
        inst({ id: 'P1', side: 'PESIN', dueDate: '2026-01-10', invoiceDate: '2026-01-10', amountCents: 5000 }),
      ],
      payments: [pay({ id: 'X', amountCents: 6000 })],
      asOf: '2026-07-08',
    })
    expect(out.allocations[0].installmentId).toBe('P1')
    expect(out.remainingByInstallment.get('P1')).toBe(0)
    expect(out.remainingByInstallment.get('P2')).toBe(4000)
  })

  it('vadeli taksitler en yakın vadeden ileriye "bölerek" kapanır', () => {
    const out = reconcile({
      installments: [
        inst({ id: 'B', dueDate: '2026-04-05', amountCents: 7000 }),
        inst({ id: 'A', dueDate: '2026-03-05', amountCents: 7000 }),
        inst({ id: 'C', dueDate: '2026-05-05', amountCents: 7000 }),
      ],
      payments: [pay({ id: 'P1', amountCents: 15000 })],
      asOf: '2026-07-08',
    })
    expect(out.allocations).toEqual([
      expect.objectContaining({ installmentId: 'A', amountCents: 7000 }),
      expect.objectContaining({ installmentId: 'B', amountCents: 7000 }),
      expect.objectContaining({ installmentId: 'C', amountCents: 1000 }),
    ])
    expect(out.remainingByInstallment.get('C')).toBe(6000)
  })

  it('vade eşitliğinde irsaliye tarihi, sonra fiş no sırası bozar', () => {
    const out = reconcile({
      installments: [
        inst({ id: 'X', dueDate: '2026-03-05', invoiceDate: '2026-01-10', fisNo: 'AVI2' }),
        inst({ id: 'Y', dueDate: '2026-03-05', invoiceDate: '2026-01-05', fisNo: 'AVI9' }),
        inst({ id: 'Z', dueDate: '2026-03-05', invoiceDate: '2026-01-10', fisNo: 'AVI1' }),
      ],
      payments: [pay({ id: 'P1', amountCents: 10000 })],
      asOf: '2026-07-08',
    })
    expect(out.allocations[0].installmentId).toBe('Y')
  })

  it('fazla ödeme firmanın TEK alacağı olur', () => {
    const out = reconcile({
      installments: [inst({ id: 'A', amountCents: 10000 })],
      payments: [pay({ id: 'P1', amountCents: 12000 })],
      asOf: '2026-07-08',
    })
    expect(out.unallocatedByPayment.get('P1')).toBe(2000)
    expect(out.balances[0].creditCents).toBe(2000)
    expect(out.balances[0].vadeliOpenCents).toBe(0)
  })

  it('alacak sonraki borcu kendiliğinden yer (havuz modeli yeniden koşunca)', () => {
    const out = reconcile({
      installments: [
        inst({ id: 'A', amountCents: 10000, dueDate: '2026-03-05' }),
        inst({ id: 'B', amountCents: 3000, dueDate: '2026-08-05' }),
      ],
      payments: [pay({ id: 'P1', amountCents: 12000 })],
      asOf: '2026-07-08',
    })
    expect(out.remainingByInstallment.get('A')).toBe(0)
    expect(out.remainingByInstallment.get('B')).toBe(1000)
    expect(out.balances[0].creditCents).toBe(0)
    expect(out.balances[0].vadeliOpenCents).toBe(1000)
  })

  it('firmalar birbirine karışmaz', () => {
    const out = reconcile({
      installments: [
        inst({ id: 'A', firmId: 'F1', amountCents: 10000 }),
        inst({ id: 'B', firmId: 'F2', amountCents: 10000 }),
      ],
      payments: [pay({ id: 'P1', firmId: 'F1', amountCents: 10000 })],
      asOf: '2026-07-08',
    })
    expect(out.remainingByInstallment.get('A')).toBe(0)
    expect(out.remainingByInstallment.get('B')).toBe(10000)
  })

  it('vadesi geçmiş yalnız asOf öncesi VADELİ kalanları sayar; nextDueDate vadeli tarafındandır', () => {
    const out = reconcile({
      installments: [
        inst({ id: 'P', side: 'PESIN', dueDate: '2026-01-05', invoiceDate: '2026-01-05', amountCents: 2000 }),
        inst({ id: 'A', dueDate: '2026-03-05', amountCents: 4000 }),
        inst({ id: 'B', dueDate: '2026-09-05', amountCents: 6000 }),
      ],
      payments: [pay({ id: 'P1', amountCents: 3000 })],
      asOf: '2026-07-08',
    })
    const bal = out.balances[0]
    // 3000 → peşin 2000 kapandı, 1000 → A'ya; A kalan 3000 (geçmiş), B kalan 6000
    expect(bal.pesinOpenCents).toBe(0)
    expect(bal.vadeliOpenCents).toBe(9000)
    expect(bal.vadeliOverdueCents).toBe(3000)
    expect(bal.nextDueDate).toBe('2026-03-05')
  })

  it('ödemeler tarih sırasıyla tüketilir (eşitlikte işlem kodu)', () => {
    const out = reconcile({
      installments: [inst({ id: 'A', amountCents: 5000 })],
      payments: [
        pay({ id: 'P2', islemKodu: 'ISL-B', amountCents: 3000 }),
        pay({ id: 'P1', islemKodu: 'ISL-A', amountCents: 3000 }),
      ],
      asOf: '2026-07-08',
    })
    expect(out.allocations).toEqual([
      expect.objectContaining({ paymentId: 'P1', amountCents: 3000 }),
      expect.objectContaining({ paymentId: 'P2', amountCents: 2000 }),
    ])
    expect(out.unallocatedByPayment.get('P2')).toBe(1000)
  })

  it('deterministiktir: aynı girdi ile birebir aynı çıktı', () => {
    const installments = [
      inst({ id: 'A', dueDate: '2026-03-05', amountCents: 7000 }),
      inst({ id: 'B', dueDate: '2026-03-05', amountCents: 3000, fisNo: 'AVI0' }),
      inst({ id: 'P', side: 'PESIN', amountCents: 2500, dueDate: '2026-01-06', invoiceDate: '2026-01-06' }),
      inst({ id: 'C', firmId: 'F2', amountCents: 5000 }),
    ]
    const payments = [
      pay({ id: 'P1', amountCents: 8000 }),
      pay({ id: 'P2', firmId: 'F2', amountCents: 2000 }),
    ]
    const a = reconcile({ installments, payments, asOf: '2026-07-08' })
    const b = reconcile({
      installments: [...installments].reverse(),
      payments: [...payments].reverse(),
      asOf: '2026-07-08',
    })
    expect(JSON.stringify(a.allocations)).toBe(JSON.stringify(b.allocations))
    expect(JSON.stringify(a.balances)).toBe(JSON.stringify(b.balances))
  })

  it('gerçek senaryo: kuruşu kuruşuna eşleşen peşin ödeme (06 K07 örneği)', () => {
    const out = reconcile({
      installments: [inst({ id: 'A', side: 'PESIN', dueDate: '2026-01-06', amountCents: 541682 })],
      payments: [pay({ id: 'P1', dateISO: '2026-01-05T00:00:00.000Z', amountCents: 541682 })],
      asOf: '2026-07-08',
    })
    expect(out.remainingByInstallment.get('A')).toBe(0)
    expect(out.balances[0].creditCents).toBe(0)
    expect(out.balances[0].pesinOpenCents).toBe(0)
  })
})
