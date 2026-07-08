import type { SupabaseClient } from '@supabase/supabase-js'
import { fisNoDigitCount, fisNoSuffix4, parseKdvRefs } from '@/lib/engine/kdvRefs'
import { foldFirmCodeForExclusion } from '@/lib/engine/normalize'
import { reconcile } from '@/lib/engine/reconcile'
import type { EngineInstallment, EnginePayment, Side } from '@/lib/engine/types'
import { chunkedWrite, fetchAll } from '@/lib/db'

// Mutabakatı baştan hesaplar ve SÜRÜMLÜ olarak yazar:
// yeni recon_run altına tüm tahsisler + firma bakiyeleri yazılır, ardından
// app_settings.current_recon_run işaretçisi çevrilir. Okuyucular asla
// yarım yazılmış koşu görmez. Son 5 koşu saklanır.
//
// Tahsis kuralı (tek havuz): ödemenin geldiği sayfa (PEŞİN/VADELİ) önemsizdir;
// firma başına tüm ödemeler önce peşin borçları, sonra en yakın vadeli
// taksitleri kapatır. KDV 1/5 ödemeleri havuza girmez: referansındaki
// (son 4 hane) irsaliyeden tamamı düşülür; referansı çözülemeyenler tahsise
// girmez. ALC ve TAMAMLANMAMIŞ kayıtlar her zaman dışarıdadır.

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
  islem_tarihi: string | null
  doviz_eur_cents: number | null
  is_kdv: boolean | null
  kdv_fatura_referansi: string | null
  aciklama: string | null
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

  // Hariç firmalar: ödemeleri de kapsam dışı kalır (Türkçe katlamalı eşleşme)
  const excludedFirmIds = new Set<string>()
  {
    const firms = await fetchAll<{ id: string; code_norm: string }>((from, to) =>
      admin.from('firms').select('id, code_norm').order('id').range(from, to),
    )
    const excludedCodes = await fetchAll<{ code_norm: string }>((from, to) =>
      admin.from('excluded_firm_codes').select('code_norm').order('code_norm').range(from, to),
    )
    const codes = new Set(excludedCodes.map((c) => foldFirmCodeForExclusion(c.code_norm)))
    for (const f of firms) if (codes.has(foldFirmCodeForExclusion(f.code_norm))) excludedFirmIds.add(f.id)
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

  // KDV referans eşleşmesi için: firma → son4 → kapsam içi irsaliye adayları
  const suffixIndex = new Map<string, Map<string, EffectiveInvoiceRow[]>>()
  for (const inv of allocatable.values()) {
    const suffix = fisNoSuffix4(inv.fis_no)
    if (!suffix) continue
    let m = suffixIndex.get(inv.firm_id)
    if (!m) suffixIndex.set(inv.firm_id, (m = new Map()))
    const arr = m.get(suffix)
    if (arr) arr.push(inv)
    else m.set(suffix, [inv])
  }

  /** Tüm referanslar çözülürse hedef irsaliye id'leri; aksi halde null (eşleşmedi). */
  function resolveKdvTargets(firmId: string, refs: string[]): string[] | null {
    if (refs.length === 0) return null
    const byFirm = suffixIndex.get(firmId)
    if (!byFirm) return null
    const targets: string[] = []
    for (const ref of refs) {
      const candidates = byFirm.get(ref)
      if (!candidates || candidates.length === 0) return null
      let pick = candidates[0]
      if (candidates.length > 1) {
        // Çakışmada standart (en uzun rakamlı) fiş tercih edilir; eşitlik → belirsiz
        const sorted = [...candidates].sort(
          (a, b) => fisNoDigitCount(b.fis_no) - fisNoDigitCount(a.fis_no) || (a.fis_no < b.fis_no ? -1 : 1),
        )
        if (fisNoDigitCount(sorted[0].fis_no) === fisNoDigitCount(sorted[1].fis_no)) return null
        pick = sorted[0]
      }
      if (!targets.includes(pick.id)) targets.push(pick.id)
    }
    return targets
  }

  // 3) Tahsise açık ödemeler (tek havuz; KDV hedefli)
  const paymentRows = await fetchAll<PaymentRow>((from, to) =>
    admin
      .from('payments')
      .select('id, islem_kodu, firm_id, islem_tarihi, doviz_eur_cents, is_kdv, kdv_fatura_referansi, aciklama')
      .eq('allocatable', true)
      .order('id')
      .range(from, to),
  )
  const enginePayments: EnginePayment[] = []
  let kdvMatched = 0
  let kdvUnmatched = 0
  for (const p of paymentRows) {
    if (excludedFirmIds.has(p.firm_id)) continue
    if (!p.doviz_eur_cents || p.doviz_eur_cents <= 0) continue
    if (p.is_kdv) {
      const refs = parseKdvRefs(p.kdv_fatura_referansi, p.aciklama)
      const targets = resolveKdvTargets(p.firm_id, refs)
      if (!targets) {
        kdvUnmatched++
        continue // eşleşmeyen KDV ödemesi tahsise girmez (panelde 'eşleşmedi' görünür)
      }
      kdvMatched++
      enginePayments.push({
        id: p.id,
        islemKodu: p.islem_kodu,
        firmId: p.firm_id,
        dateISO: p.islem_tarihi ?? '9999-12-31T00:00:00.000Z',
        amountCents: p.doviz_eur_cents,
        isKdv: true,
        targetInvoiceIds: targets,
      })
      continue
    }
    enginePayments.push({
      id: p.id,
      islemKodu: p.islem_kodu,
      firmId: p.firm_id,
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
        kdv_eslesen: kdvMatched,
        kdv_eslesmeyen: kdvUnmatched,
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
    admin.from('firm_balances').insert(
      chunk.map((b) => ({
        run_id: runId,
        firm_id: b.firmId,
        pesin_open_eur_cents: b.pesinOpenCents,
        vadeli_open_eur_cents: b.vadeliOpenCents,
        vadeli_overdue_eur_cents: b.vadeliOverdueCents,
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
