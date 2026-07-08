import type { SupabaseClient } from '@supabase/supabase-js'
import { reconcile } from '@/lib/engine/reconcile'
import type { EngineInstallment, EnginePayment, Side } from '@/lib/engine/types'
import { chunkedWrite, fetchAll } from '@/lib/db'

// Mutabakatı baştan hesaplar ve SÜRÜMLÜ olarak yazar:
// yeni recon_run altına tüm tahsisler + bakiyeler yazılır, ardından
// app_settings.current_recon_run işaretçisi çevrilir. Okuyucular asla
// yarım yazılmış koşu görmez. Son 5 koşu saklanır.

export type TriggerKind = 'import' | 'edit' | 'manual' | 'setup'

interface EffectiveInvoiceRow {
  id: string
  firm_id: string
  fis_no: string
  invoice_date: string
  side: Side | null
  is_allocatable: boolean
  is_excluded_firm: boolean
}

interface InstallmentRow {
  id: string
  invoice_id: string
  firm_id: string
  seq: number
  due_date: string
  amount_eur_cents: number
}

interface PaymentRow {
  id: string
  islem_kodu: string
  firm_id: string
  sheet_side: Side
  islem_tarihi: string | null
  doviz_eur_cents: number | null
}

export interface RecomputeStats {
  runId: string
  installmentCount: number
  paymentCount: number
  allocationCount: number
  totalOpenCents: number
  totalCreditCents: number
}

export async function runRecompute(
  admin: SupabaseClient,
  triggerKind: TriggerKind,
  actorEmail: string,
): Promise<RecomputeStats> {
  const asOf = new Date().toISOString().slice(0, 10)

  // 1) Etkin (tahsis edilebilir) irsaliyeler
  const invoices = await fetchAll<EffectiveInvoiceRow>((from, to) =>
    admin
      .from('v_invoices_effective')
      .select('id, firm_id, fis_no, invoice_date, side, is_allocatable, is_excluded_firm')
      .order('id')
      .range(from, to),
  )
  const allocatable = new Map<string, EffectiveInvoiceRow>()
  for (const inv of invoices) {
    if (inv.is_allocatable && inv.side) allocatable.set(inv.id, inv)
  }

  // Hariç firmalar: ödemeleri de kapsam dışı kalır
  const excludedFirmIds = new Set<string>()
  {
    const firms = await fetchAll<{ id: string; code_norm: string }>((from, to) =>
      admin.from('firms').select('id, code_norm').order('id').range(from, to),
    )
    const excludedCodes = await fetchAll<{ code_norm: string }>((from, to) =>
      admin.from('excluded_firm_codes').select('code_norm').order('code_norm').range(from, to),
    )
    const codes = new Set(excludedCodes.map((c) => c.code_norm))
    for (const f of firms) if (codes.has(f.code_norm)) excludedFirmIds.add(f.id)
  }

  // 2) Taksitler
  const allInstallments = await fetchAll<InstallmentRow>((from, to) =>
    admin
      .from('installments')
      .select('id, invoice_id, firm_id, seq, due_date, amount_eur_cents')
      .order('id')
      .range(from, to),
  )
  const engineInstallments: EngineInstallment[] = []
  const outOfScopeInstallmentIds: string[] = []
  for (const t of allInstallments) {
    const inv = allocatable.get(t.invoice_id)
    if (!inv) {
      outOfScopeInstallmentIds.push(t.id)
      continue
    }
    engineInstallments.push({
      id: t.id,
      invoiceId: t.invoice_id,
      firmId: t.firm_id,
      side: inv.side!,
      dueDate: t.due_date,
      invoiceDate: inv.invoice_date,
      fisNo: inv.fis_no,
      seq: t.seq,
      amountCents: t.amount_eur_cents,
    })
  }

  // 3) Tahsise açık ödemeler
  const paymentRows = await fetchAll<PaymentRow>((from, to) =>
    admin
      .from('payments')
      .select('id, islem_kodu, firm_id, sheet_side, islem_tarihi, doviz_eur_cents')
      .eq('allocatable', true)
      .order('id')
      .range(from, to),
  )
  const enginePayments: EnginePayment[] = []
  for (const p of paymentRows) {
    if (excludedFirmIds.has(p.firm_id)) continue
    if (!p.doviz_eur_cents || p.doviz_eur_cents <= 0) continue
    enginePayments.push({
      id: p.id,
      islemKodu: p.islem_kodu,
      firmId: p.firm_id,
      side: p.sheet_side,
      dateISO: p.islem_tarihi ?? '9999-12-31T00:00:00.000Z',
      amountCents: p.doviz_eur_cents,
    })
  }

  // 4) Saf motor
  const result = reconcile({ installments: engineInstallments, payments: enginePayments, asOf })

  // 5) Yeni koşuyu yaz
  const { data: run, error: runError } = await admin
    .from('recon_runs')
    .insert({
      triggered_by: actorEmail,
      trigger_kind: triggerKind,
      stats: {
        as_of: asOf,
        ...result.stats,
      },
    })
    .select('id')
    .single()
  if (runError || !run) throw new Error('Mutabakat koşusu açılamadı: ' + runError?.message)
  const runId = run.id as string

  await chunkedWrite(result.allocations, (chunk) =>
    admin.from('allocations').insert(
      chunk.map((a) => ({
        run_id: runId,
        payment_id: a.paymentId,
        installment_id: a.installmentId,
        invoice_id: a.invoiceId,
        firm_id: a.firmId,
        side: a.side,
        amount_eur_cents: a.amountCents,
      })),
    ),
  )

  await chunkedWrite(result.balances, (chunk) =>
    admin.from('firm_side_balances').insert(
      chunk.map((b) => ({
        run_id: runId,
        firm_id: b.firmId,
        side: b.side,
        open_debt_eur_cents: b.openDebtCents,
        overdue_eur_cents: b.overdueCents,
        credit_eur_cents: b.creditCents,
        next_due_date: b.nextDueDate,
        total_debt_eur_cents: b.totalDebtCents,
        total_paid_eur_cents: b.totalPaidCents,
      })),
    ),
  )

  // 6) Taksit kalanlarını güncelle (kapsam dışı taksitlerde NULL)
  const remainingUpdates: Array<{ id: string; remaining: number | null }> = []
  for (const t of engineInstallments) {
    remainingUpdates.push({ id: t.id, remaining: result.remainingByInstallment.get(t.id) ?? t.amountCents })
  }
  for (const id of outOfScopeInstallmentIds) remainingUpdates.push({ id, remaining: null })

  await chunkedWrite(
    remainingUpdates,
    async (chunk) => {
      const { error } = await admin.rpc('bulk_set_installment_remaining', { updates: chunk })
      return { error }
    },
    1000,
  )

  // 7) İşaretçiyi çevir
  const { error: flipError } = await admin
    .from('app_settings')
    .upsert(
      { key: 'current_recon_run', value: { run_id: runId }, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
  if (flipError) throw new Error('Koşu işaretçisi güncellenemedi: ' + flipError.message)

  await admin.from('recon_runs').update({ finished_at: new Date().toISOString() }).eq('id', runId)

  // 8) Eski koşuları buda (son 5 kalsın)
  const { data: oldRuns } = await admin
    .from('recon_runs')
    .select('id')
    .order('started_at', { ascending: false })
    .range(5, 50)
  if (oldRuns && oldRuns.length > 0) {
    await admin
      .from('recon_runs')
      .delete()
      .in(
        'id',
        oldRuns.map((r) => r.id),
      )
  }

  return {
    runId,
    installmentCount: engineInstallments.length,
    paymentCount: enginePayments.length,
    allocationCount: result.allocations.length,
    totalOpenCents: result.stats.totalOpenCents,
    totalCreditCents: result.stats.totalCreditCents,
  }
}
