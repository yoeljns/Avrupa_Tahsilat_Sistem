import { compareISO } from './dates'
import type {
  AllocationOut,
  EngineInstallment,
  EnginePayment,
  EngineOutput,
  FirmSideBalanceOut,
  Side,
} from './types'

// Mutabakat motoru — SAF ve DETERMİNİSTİK.
//
// Kurallar (iş sahibinin tarifi):
//  * PEŞİN sayfası ödemeleri yalnız PESIN taksitlerinden, VADELİ sayfası ödemeleri
//    yalnız KONSINYE/KONSINYE_PESIN (VADELI) taksitlerinden düşülür. Taraflar arası geçiş YOK.
//  * Firma+taraf içinde taksitler vade sırasına (eşitlikte irsaliye tarihi, fiş no, seq),
//    ödemeler tarih sırasına (eşitlikte işlem kodu) dizilir; FIFO havuz modeliyle tahsis edilir.
//  * Artan ödeme o tarafın ALACAĞI olur; her yeniden hesapta havuz baştan koştuğu için
//    alacak bir sonraki vadesi gelen borcu kendiliğinden yer.
//
// Çağıran taraf filtreleri uygular: iptal/31-12/hariç firma/OTHER irsaliyeler ve
// tahsise kapalı ödemeler (ALC-, TAMAMLANMAMIŞ) motora hiç gelmez.

export function reconcile(input: {
  installments: EngineInstallment[]
  payments: EnginePayment[]
  /** Vadesi geçmiş hesabı için bugün (ISO) */
  asOf: string
}): EngineOutput {
  const { installments, payments, asOf } = input

  const groups = new Map<string, { installments: EngineInstallment[]; payments: EnginePayment[] }>()
  const keyOf = (firmId: string, side: Side) => `${firmId}|${side}`

  for (const inst of installments) {
    const key = keyOf(inst.firmId, inst.side)
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { installments: [], payments: [] }))
    g.installments.push(inst)
  }
  for (const pay of payments) {
    const key = keyOf(pay.firmId, pay.side)
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { installments: [], payments: [] }))
    g.payments.push(pay)
  }

  const allocations: AllocationOut[] = []
  const remainingByInstallment = new Map<string, number>()
  const unallocatedByPayment = new Map<string, number>()
  const balances: FirmSideBalanceOut[] = []

  // Deterministik çıktı için gruplar da sıralı gezilir.
  const sortedKeys = Array.from(groups.keys()).sort()

  for (const key of sortedKeys) {
    const g = groups.get(key)!
    const [firmId, side] = key.split('|') as [string, Side]

    g.installments.sort(
      (a, b) =>
        compareISO(a.dueDate, b.dueDate) ||
        compareISO(a.invoiceDate, b.invoiceDate) ||
        (a.fisNo < b.fisNo ? -1 : a.fisNo > b.fisNo ? 1 : 0) ||
        a.seq - b.seq,
    )
    g.payments.sort(
      (a, b) => compareISO(a.dateISO, b.dateISO) || (a.islemKodu < b.islemKodu ? -1 : a.islemKodu > b.islemKodu ? 1 : 0),
    )

    const instRemaining = g.installments.map((i) => Math.max(0, i.amountCents))
    let ii = 0

    for (const pay of g.payments) {
      let payRemaining = pay.amountCents
      while (payRemaining > 0 && ii < g.installments.length) {
        if (instRemaining[ii] <= 0) {
          ii++
          continue
        }
        const inst = g.installments[ii]
        const take = Math.min(payRemaining, instRemaining[ii])
        if (take > 0) {
          allocations.push({
            paymentId: pay.id,
            installmentId: inst.id,
            invoiceId: inst.invoiceId,
            firmId,
            side,
            amountCents: take,
          })
          instRemaining[ii] -= take
          payRemaining -= take
        }
        if (instRemaining[ii] === 0) ii++
      }
      unallocatedByPayment.set(pay.id, payRemaining)
    }

    let openDebt = 0
    let overdue = 0
    let nextDue: string | null = null
    let totalDebt = 0
    for (let k = 0; k < g.installments.length; k++) {
      const inst = g.installments[k]
      totalDebt += inst.amountCents
      const rem = instRemaining[k]
      remainingByInstallment.set(inst.id, rem)
      if (rem > 0) {
        openDebt += rem
        if (compareISO(inst.dueDate, asOf) < 0) overdue += rem
        if (nextDue === null || compareISO(inst.dueDate, nextDue) < 0) nextDue = inst.dueDate
      }
    }
    const totalPaid = g.payments.reduce((s, p) => s + p.amountCents, 0)
    const credit = g.payments.reduce((s, p) => s + (unallocatedByPayment.get(p.id) ?? 0), 0)

    balances.push({
      firmId,
      side,
      openDebtCents: openDebt,
      overdueCents: overdue,
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
    totalOpenCents: balances.reduce((s, b) => s + b.openDebtCents, 0),
    totalCreditCents: balances.reduce((s, b) => s + b.creditCents, 0),
  }

  return { allocations, remainingByInstallment, unallocatedByPayment, balances, stats }
}
