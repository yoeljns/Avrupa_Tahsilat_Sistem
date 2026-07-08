import { compareISO } from './dates'
import type {
  AllocationOut,
  EngineInstallment,
  EnginePayment,
  EngineOutput,
  FirmBalanceOut,
} from './types'

// Mutabakat motoru — SAF ve DETERMİNİSTİK.
//
// Kural (iş sahibinin tarifi): "Gelen ödemeleri al, önce peşinleri ödet,
// sonra kalanı en yakın vadeye bölerek ilerle."
//
//  * Firma başına TEK ödeme havuzu vardır — ödemenin PEŞİN mi VADELİ mi
//    sayfasından geldiği tahsisi ETKİLEMEZ (yalnız bilgi olarak saklanır).
//  * Borç kuyruğu: önce TÜM PEŞİN borçları (en eski irsaliye önce),
//    sonra VADELİ (konsinye) taksitler en yakın vadeden ileriye.
//  * Ödemeler tarih sırasıyla havuza girer; iki işaretçili FIFO ile kuyruk kapatılır.
//  * Artan ödeme firmanın ALACAĞIDIR; her yeniden hesapta havuz baştan
//    koştuğu için alacak, sonraki borcu kendiliğinden kapatır.
//
// Çağıran taraf filtreleri uygular: iptal/31-12/hariç firma/OTHER irsaliyeler
// ve tahsise kapalı ödemeler (ALC-, TAMAMLANMAMIŞ, KDV 1/5) motora hiç gelmez.

export function reconcile(input: {
  installments: EngineInstallment[]
  payments: EnginePayment[]
  /** Vadesi geçmiş hesabı için bugün (ISO) */
  asOf: string
}): EngineOutput {
  const { installments, payments, asOf } = input

  const groups = new Map<string, { installments: EngineInstallment[]; payments: EnginePayment[] }>()

  for (const inst of installments) {
    let g = groups.get(inst.firmId)
    if (!g) groups.set(inst.firmId, (g = { installments: [], payments: [] }))
    g.installments.push(inst)
  }
  for (const pay of payments) {
    let g = groups.get(pay.firmId)
    if (!g) groups.set(pay.firmId, (g = { installments: [], payments: [] }))
    g.payments.push(pay)
  }

  const allocations: AllocationOut[] = []
  const remainingByInstallment = new Map<string, number>()
  const unallocatedByPayment = new Map<string, number>()
  const balances: FirmBalanceOut[] = []

  const byDueThenInvoice = (a: EngineInstallment, b: EngineInstallment) =>
    compareISO(a.dueDate, b.dueDate) ||
    compareISO(a.invoiceDate, b.invoiceDate) ||
    (a.fisNo < b.fisNo ? -1 : a.fisNo > b.fisNo ? 1 : 0) ||
    a.seq - b.seq

  // Deterministik çıktı için firmalar sıralı gezilir.
  const sortedFirmIds = Array.from(groups.keys()).sort()

  for (const firmId of sortedFirmIds) {
    const g = groups.get(firmId)!

    // Borç kuyruğu: ÖNCE peşin borçları, SONRA vadeli taksitler.
    const pesin = g.installments.filter((i) => i.side === 'PESIN').sort(byDueThenInvoice)
    const vadeli = g.installments.filter((i) => i.side === 'VADELI').sort(byDueThenInvoice)
    const queue = [...pesin, ...vadeli]

    g.payments.sort(
      (a, b) => compareISO(a.dateISO, b.dateISO) || (a.islemKodu < b.islemKodu ? -1 : a.islemKodu > b.islemKodu ? 1 : 0),
    )

    const instRemaining = queue.map((i) => Math.max(0, i.amountCents))
    let ii = 0

    for (const pay of g.payments) {
      let payRemaining = pay.amountCents
      while (payRemaining > 0 && ii < queue.length) {
        if (instRemaining[ii] <= 0) {
          ii++
          continue
        }
        const inst = queue[ii]
        const take = Math.min(payRemaining, instRemaining[ii])
        if (take > 0) {
          allocations.push({
            paymentId: pay.id,
            installmentId: inst.id,
            invoiceId: inst.invoiceId,
            firmId,
            side: inst.side,
            amountCents: take,
          })
          instRemaining[ii] -= take
          payRemaining -= take
        }
        if (instRemaining[ii] === 0) ii++
      }
      unallocatedByPayment.set(pay.id, payRemaining)
    }

    let pesinOpen = 0
    let vadeliOpen = 0
    let vadeliOverdue = 0
    let nextDue: string | null = null
    let totalDebt = 0
    for (let k = 0; k < queue.length; k++) {
      const inst = queue[k]
      totalDebt += inst.amountCents
      const rem = instRemaining[k]
      remainingByInstallment.set(inst.id, rem)
      if (rem > 0) {
        if (inst.side === 'PESIN') {
          pesinOpen += rem
        } else {
          vadeliOpen += rem
          if (compareISO(inst.dueDate, asOf) < 0) vadeliOverdue += rem
          if (nextDue === null || compareISO(inst.dueDate, nextDue) < 0) nextDue = inst.dueDate
        }
      }
    }
    const totalPaid = g.payments.reduce((s, p) => s + p.amountCents, 0)
    const credit = g.payments.reduce((s, p) => s + (unallocatedByPayment.get(p.id) ?? 0), 0)

    balances.push({
      firmId,
      pesinOpenCents: pesinOpen,
      vadeliOpenCents: vadeliOpen,
      vadeliOverdueCents: vadeliOverdue,
      creditCents: credit,
      nextDueDate: nextDue,
      totalDebtCents: totalDebt,
      totalPaidCents: totalPaid,
    })
  }

  const stats = {
    installmentCount: installments.length,
    paymentCount: payments.length,
    allocationCount: allocations.length,
    totalDebtCents: balances.reduce((s, b) => s + b.totalDebtCents, 0),
    totalPaidCents: balances.reduce((s, b) => s + b.totalPaidCents, 0),
    totalOpenCents: balances.reduce((s, b) => s + b.pesinOpenCents + b.vadeliOpenCents, 0),
    totalCreditCents: balances.reduce((s, b) => s + b.creditCents, 0),
  }

  return { allocations, remainingByInstallment, unallocatedByPayment, balances, stats }
}
