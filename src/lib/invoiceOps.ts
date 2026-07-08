import type { SupabaseClient } from '@supabase/supabase-js'
import { buildInstallments } from '@/lib/engine/installments'
import { parseOdemePlani } from '@/lib/engine/planParser'
import type { SaleType } from '@/lib/engine/types'
import { writeAudit, type AuditEntry } from '@/lib/db'

// Tahsilat Yöneticisi'nin irsaliye düzenlemeleri: override yaz + taksitleri
// tazele + denetim kaydı düş. Her başarılı düzenlemeden sonra çağıran taraf
// runRecompute çalıştırır.

export interface InvoiceForOps {
  id: string
  fis_no: string
  firm_id: string
  invoice_date: string
  odeme_plani_raw: string
  plan_parse_status: string
  sale_type_auto: SaleType
  sale_type_override: SaleType | null
  amount_eur_cents: number | null
  amount_eur_cents_override: number | null
  cancelled_at: string | null
  excluded_override: boolean | null
  plan_override_note: string | null
}

export function effectiveType(inv: InvoiceForOps): SaleType {
  return inv.sale_type_override ?? inv.sale_type_auto
}

export function effectiveAmount(inv: InvoiceForOps): number | null {
  return inv.amount_eur_cents_override ?? inv.amount_eur_cents
}

export function sideOfType(t: SaleType): 'PESIN' | 'VADELI' | null {
  if (t === 'PESIN') return 'PESIN'
  if (t === 'KONSINYE' || t === 'KONSINYE_PESIN') return 'VADELI'
  return null
}

export async function loadInvoiceForOps(admin: SupabaseClient, id: string): Promise<InvoiceForOps | null> {
  const { data } = await admin
    .from('invoices')
    .select(
      'id, fis_no, firm_id, invoice_date, odeme_plani_raw, plan_parse_status, sale_type_auto, sale_type_override, amount_eur_cents, amount_eur_cents_override, cancelled_at, excluded_override, plan_override_note',
    )
    .eq('id', id)
    .maybeSingle()
  return (data as InvoiceForOps | null) ?? null
}

/**
 * Manuel olmayan taksitleri verilen vade listesinden yeniden üretir.
 * dueDates boşsa mevcut otomatik taksitlerin tarihleri korunarak yalnız
 * tutarlar yeniden bölünür.
 */
export async function regenerateInstallments(
  admin: SupabaseClient,
  inv: InvoiceForOps,
  opts: { dueDates?: string[]; noDateFlag?: boolean; source?: 'auto_plan' | 'default_invoice_date' | 'manual' } = {},
): Promise<number> {
  const type = effectiveType(inv)
  const side = sideOfType(type)
  const amount = effectiveAmount(inv)

  const { data: existing } = await admin
    .from('installments')
    .select('id, due_date, source, no_date_flag')
    .eq('invoice_id', inv.id)
    .order('seq')
  const manual = (existing ?? []).filter((t) => t.source === 'manual')

  if (manual.length > 0) return 0 // manuel taksitler korunur; otomatik yenileme yapılmaz
  if (side === null || amount === null) {
    // OTHER'a geri döndü veya tutar yok: otomatik taksitleri kaldır
    await admin.from('installments').delete().eq('invoice_id', inv.id).neq('source', 'manual')
    return 0
  }

  let dueDates = opts.dueDates
  let noDateFlag = opts.noDateFlag ?? false
  let source = opts.source ?? 'auto_plan'
  if (!dueDates || dueDates.length === 0) {
    // Yöneticinin girdiği plan (override) ham plandan önceliklidir
    const planText = inv.plan_override_note ?? inv.odeme_plani_raw
    const plan = parseOdemePlani(planText, inv.invoice_date)
    dueDates = plan.dueDates
    noDateFlag = plan.status === 'empty_default'
    source = plan.status === 'empty_default' || plan.status === 'unparsed' ? 'default_invoice_date' : 'auto_plan'
  }

  await admin.from('installments').delete().eq('invoice_id', inv.id).neq('source', 'manual')
  const built = buildInstallments(amount, dueDates)
  if (built.length > 0) {
    const { error } = await admin.from('installments').insert(
      built.map((b) => ({
        invoice_id: inv.id,
        firm_id: inv.firm_id,
        side,
        seq: b.seq,
        due_date: b.dueDate,
        amount_eur_cents: b.amountCents,
        source,
        no_date_flag: noDateFlag && side === 'VADELI',
        remaining_eur_cents: null,
      })),
    )
    if (error) throw new Error('Taksitler yazılamadı: ' + error.message)
  }
  return built.length
}

/** Taksitlerin side alanını etkin tipe göre günceller (tip değişince). */
export async function refreshInstallmentSides(admin: SupabaseClient, inv: InvoiceForOps): Promise<void> {
  const side = sideOfType(effectiveType(inv))
  if (side === null) return
  await admin.from('installments').update({ side }).eq('invoice_id', inv.id)
}

export async function auditInvoiceChange(
  admin: SupabaseClient,
  actorEmail: string,
  inv: InvoiceForOps,
  entries: Array<Omit<AuditEntry, 'actorEmail' | 'entityType' | 'entityId'>>,
): Promise<void> {
  await writeAudit(
    admin,
    entries.map((e) => ({ ...e, actorEmail, entityType: 'irsaliye', entityId: inv.fis_no })),
  )
}
