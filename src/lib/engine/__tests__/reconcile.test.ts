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
    side: 'VADELI',
    dateISO: '2026-02-01T00:00:00.000Z',
    amountCents: 10000,
    ...p,
  }
}

describe('reconcile — FIFO tahsis', () => {
  it('ödeme en erken vadeli taksitten düşer', () => {
    const out = reconcile({
      installments: [
        inst({ id: 'B', dueDate: '2026-04-05' }),
        inst({ id: 'A', dueDate: '2026-03-05' }),
      ],
      payments: [pay({ id: 'P1', amountCents: 15000 })],
      asOf: '2026-07-08',
    })
    expect(out.allocations).toEqual([
      expect.objectContaining({ installmentId: 'A', amountCents: 10000 }),
      expect.objectContaining({ installmentId: 'B', amountCents: 5000 }),
    ])
    expect(out.remainingByInstallment.get('A')).toBe(0)
    expect(out.remainingByInstallment.get('B')).toBe(5000)
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

  it('fazla ödeme ALACAK olur ve kendi tarafında kalır', () => {
    const out = reconcile({
      installments: [inst({ id: 'A', side: 'VADELI', amountCents: 10000 })],
      payments: [pay({ id: 'P1', side: 'VADELI', amountCents: 12000 })],
      asOf: '2026-07-08',
    })
    expect(out.unallocatedByPayment.get('P1')).toBe(2000)
    const bal = out.balances.find((b) => b.side === 'VADELI')!
    expect(bal.creditCents).toBe(2000)
    expect(bal.openDebtCents).toBe(0)
  })

  it('VADELİ alacağı PEŞİN borcuna ASLA dokunmaz (taraf yalıtımı)', () => {
    const out = reconcile({
      installments: [inst({ id: 'CASH1', side: 'PESIN', dueDate: '2026-01-05', amountCents: 5000 })],
      payments: [pay({ id: 'P1', side: 'VADELI', amountCents: 99999 })],
      asOf: '2026-07-08',
    })
    expect(out.allocations).toHaveLength(0)
    const pesin = out.balances.find((b) => b.side === 'PESIN')!
    const vadeli = out.balances.find((b) => b.side === 'VADELI')!
    expect(pesin.openDebtCents).toBe(5000)
    expect(vadeli.creditCents).toBe(99999)
  })

  it('alacak sonraki borcu kendiliğinden yer (havuz modeli yeniden koşunca)', () => {
    // 1. koşu: 12.000 ödeme, 10.000 borç → 2.000 alacak
    // 2. koşu: yeni 3.000'lik taksit gelir → alacak 2.000'i kapatır, 1.000 açık kalır
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
    const bal = out.balances[0]
    expect(bal.creditCents).toBe(0)
    expect(bal.openDebtCents).toBe(1000)
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

  it('vadesi geçmiş yalnız asOf öncesi kalanları sayar; nextDueDate doğru', () => {
    const out = reconcile({
      installments: [
        inst({ id: 'A', dueDate: '2026-03-05', amountCents: 4000 }),
        inst({ id: 'B', dueDate: '2026-09-05', amountCents: 6000 }),
      ],
      payments: [pay({ id: 'P1', amountCents: 1000 })],
      asOf: '2026-07-08',
    })
    const bal = out.balances[0]
    expect(bal.openDebtCents).toBe(9000)
    expect(bal.overdueCents).toBe(3000) // A'dan kalan
    expect(bal.nextDueDate).toBe('2026-03-05')
  })

  it('ödemeler tarih sırasıyla tüketilir (eşitlikte işlem kodu)', () => {
    const out = reconcile({
      installments: [inst({ id: 'A', amountCents: 5000 })],
      payments: [
        pay({ id: 'P2', islemKodu: 'ISL-B', dateISO: '2026-02-01T00:00:00.000Z', amountCents: 3000 }),
        pay({ id: 'P1', islemKodu: 'ISL-A', dateISO: '2026-02-01T00:00:00.000Z', amountCents: 3000 }),
      ],
      asOf: '2026-07-08',
    })
    // ISL-A önce: 3000 tahsis; ISL-B: 2000 tahsis + 1000 alacak
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
      inst({ id: 'C', firmId: 'F2', amountCents: 5000 }),
    ]
    const payments = [
      pay({ id: 'P1', amountCents: 8000 }),
      pay({ id: 'P2', firmId: 'F2', amountCents: 2000 }),
    ]
    const a = reconcile({ installments, payments, asOf: '2026-07-08' })
    const b = reconcile({ installments: [...installments].reverse(), payments: [...payments].reverse(), asOf: '2026-07-08' })
    expect(JSON.stringify(a.allocations)).toBe(JSON.stringify(b.allocations))
    expect(JSON.stringify(a.balances)).toBe(JSON.stringify(b.balances))
  })

  it('gerçek senaryo: kuruşu kuruşuna eşleşen peşin ödeme (06 K07 örneği)', () => {
    // İrsaliye: 5416,82 € peşin; Ödeme: 5416,82 € PEŞİN sayfası
    const out = reconcile({
      installments: [inst({ id: 'A', side: 'PESIN', dueDate: '2026-01-06', amountCents: 541682 })],
      payments: [pay({ id: 'P1', side: 'PESIN', dateISO: '2026-01-05T00:00:00.000Z', amountCents: 541682 })],
      asOf: '2026-07-08',
    })
    expect(out.remainingByInstallment.get('A')).toBe(0)
    expect(out.balances[0].creditCents).toBe(0)
    expect(out.balances[0].openDebtCents).toBe(0)
  })
})
