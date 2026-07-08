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
// sonra kalanı en yakın vadeye bölerek ilerle. KDV ödemesinin tamamı
// eşleşen irsaliyeden düşer, sonra taksitlendirilir."
//
// İki faz:
//  1) KDV FAZI — KDV 1/5 ödemeleri havuza girmez; her biri referans verdiği
//     irsaliye(ler)e gider. Tutar, hedef irsaliyelere kalanlarıyla oransal,
//     irsaliye içinde de taksitlere oransal dağıtılır — bu, "toplamdan düş,
//     sonra taksitlendir" ile aynı kalanları üretir.
//  2) HAVUZ FAZI — kalan borçlar üzerinden: firma başına TEK ödeme havuzu
//     (ödemenin PEŞİN/VADELİ sayfası önemsiz), önce TÜM PEŞİN borçları
//     (en eski önce), sonra VADELİ taksitler en yakın vadeden ileriye, FIFO.
//  * Artan ödeme firmanın ALACAĞIDIR; her yeniden hesapta baştan koşulduğu
//    için alacak, sonraki borcu kendiliğinden kapatır.
//
// Çağıran taraf filtreleri uygular: iptal/31-12/hariç firma/OTHER irsaliyeler,
// ALC- ve TAMAMLANMAMIŞ ödemeler ile İRSALİYE EŞLEŞMEYEN KDV ödemeleri
// motora hiç gelmez.

/**
 * Tutarı, üst sınırlarına (caps) oransal dağıtır — deterministik.
 * 1. geçiş: taban paylar (floor); 2. geçiş: kalan kuruşlar sırayla, sınır aşılmadan.
 * Toplam dağıtım = min(amount, Σcaps).
 */
function distributeProRata(amount: number, caps: number[]): number[] {
  const out = new Array<number>(caps.length).fill(0)
  const total = caps.reduce((s, c) => s + Math.max(0, c), 0)
  if (total <= 0 || amount <= 0) return out
  const usable = Math.min(amount, total)
  let assigned = 0
  for (let i = 0; i < caps.length; i++) {
    const cap = Math.max(0, caps[i])
    const share = Math.min(cap, Math.floor((usable * cap) / total))
    out[i] = share
    assigned += share
  }
  let left = usable - assigned
  for (let i = 0; i < caps.length && left > 0; i++) {
    const add = Math.min(left, Math.max(0, caps[i]) - out[i])
    out[i] += add
    left -= add
  }
  return out
}

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
    const indicesByInvoice = new Map<string, number[]>()
    for (let k = 0; k < queue.length; k++) {
      const arr = indicesByInvoice.get(queue[k].invoiceId)
      if (arr) arr.push(k)
      else indicesByInvoice.set(queue[k].invoiceId, [k])
    }

    // ---- 1. FAZ: KDV ödemeleri — yalnız hedef irsaliyelerden düşer ----
    const kdvPayments = g.payments.filter((p) => p.isKdv)
    const poolPayments = g.payments.filter((p) => !p.isKdv)

    for (const pay of kdvPayments) {
      const targetIds = (pay.targetInvoiceIds ?? []).filter((id) => indicesByInvoice.has(id))
      let payRemaining = pay.amountCents
      if (targetIds.length > 0 && payRemaining > 0) {
        // Ödemeyi hedef irsaliyelere kalan tutarlarıyla oransal böl
        const invoiceCaps = targetIds.map((id) =>
          indicesByInvoice.get(id)!.reduce((s, k) => s + instRemaining[k], 0),
        )
        const invoiceShares = distributeProRata(payRemaining, invoiceCaps)
        for (let t = 0; t < targetIds.length; t++) {
          let share = invoiceShares[t]
          if (share <= 0) continue
          // İrsaliye içinde taksitlere oransal dağıt — "toplamdan düş, sonra
          // taksitlendir" ile aynı kalanları üretir
          const idxs = indicesByInvoice.get(targetIds[t])!
          const instShares = distributeProRata(share, idxs.map((k) => instRemaining[k]))
          for (let j = 0; j < idxs.length; j++) {
            const take = instShares[j]
            if (take <= 0) continue
            const k = idxs[j]
            const inst = queue[k]
            allocations.push({
              paymentId: pay.id,
              installmentId: inst.id,
              invoiceId: inst.invoiceId,
              firmId,
              side: inst.side,
              amountCents: take,
            })
            instRemaining[k] -= take
            share -= take
            payRemaining -= take
          }
        }
      }
      unallocatedByPayment.set(pay.id, payRemaining)
    }

    // ---- 2. FAZ: havuz — önce peşin, sonra en yakın vade ----
    let ii = 0
    for (const pay of poolPayments) {
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
