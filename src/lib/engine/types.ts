// Alan modeli tipleri — motor saf kalır, I/O içermez.

/** Satış tipi: Belge No sütunundan türetilir. */
export type SaleType = 'PESIN' | 'KONSINYE' | 'KONSINYE_PESIN' | 'OTHER'

/** Tahsilat tarafı: PESIN irsaliyeleri PEŞİN ödemelerle, KONSINYE + KONSINYE_PESIN irsaliyeleri VADELİ ödemelerle eşleşir. */
export type Side = 'PESIN' | 'VADELI'

export type PlanParseStatus = 'ok' | 'cash' | 'empty_default' | 'net_days' | 'unparsed'

export interface PlanParseResult {
  status: PlanParseStatus
  /** ISO (YYYY-MM-DD) vade tarihleri, sıralı. Boş plan ve çözülemeyen planda irsaliye tarihi tek vade olur. */
  dueDates: string[]
  note?: string
}

export interface ClassifyResult {
  type: SaleType
  /** OTHER için sezgisel öneri — asla otomatik uygulanmaz. */
  suggested?: Exclude<SaleType, 'OTHER'>
  needsReview: boolean
  reason: string
}

export interface EngineInstallment {
  id: string
  invoiceId: string
  firmId: string
  side: Side
  /** ISO vade tarihi */
  dueDate: string
  /** ISO irsaliye tarihi (eşitlik bozan sıralama anahtarı) */
  invoiceDate: string
  fisNo: string
  seq: number
  amountCents: number
}

export interface EnginePayment {
  id: string
  islemKodu: string
  firmId: string
  side: Side
  /** ISO tarih/zaman (sıralama için) */
  dateISO: string
  amountCents: number
}

export interface AllocationOut {
  paymentId: string
  installmentId: string
  invoiceId: string
  firmId: string
  side: Side
  amountCents: number
}

export interface FirmSideBalanceOut {
  firmId: string
  side: Side
  /** Kalan açık borç (tahsis sonrası) */
  openDebtCents: number
  /** asOf tarihinden önce vadesi geçmiş kalan borç */
  overdueCents: number
  /** Tahsis edilemeyen ödeme fazlası = firmanın bu taraftaki alacağı */
  creditCents: number
  /** Kalanı olan en erken vade */
  nextDueDate: string | null
  totalDebtCents: number
  totalPaidCents: number
}

export interface EngineOutput {
  allocations: AllocationOut[]
  /** taksit id -> kalan */
  remainingByInstallment: Map<string, number>
  /** ödeme id -> tahsis edilemeyen kalan */
  unallocatedByPayment: Map<string, number>
  balances: FirmSideBalanceOut[]
  stats: {
    installmentCount: number
    paymentCount: number
    allocationCount: number
    totalDebtCents: number
    totalPaidCents: number
    totalOpenCents: number
    totalCreditCents: number
  }
}
