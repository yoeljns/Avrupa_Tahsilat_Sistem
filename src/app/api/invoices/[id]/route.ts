import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession } from '@/lib/auth'
import { parseEurToCents } from '@/lib/engine/money'
import { parseOdemePlani } from '@/lib/engine/planParser'
import {
  auditInvoiceChange,
  effectiveType,
  loadInvoiceForOps,
  refreshInstallmentSides,
  regenerateInstallments,
} from '@/lib/invoiceOps'
import { runRecompute } from '@/lib/recompute'
import { createAdminSupabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 120

// Tahsilat Yöneticisi irsaliye düzenlemeleri.
// Her alan override olarak yazılır; içe aktarılan ham veri korunur.

const Body = z.object({
  saleType: z.enum(['PESIN', 'KONSINYE', 'KONSINYE_PESIN', 'OTHER']).optional(),
  /** 'sıfırla' → override kaldırılır */
  amountEur: z.string().max(40).optional(),
  clearAmountOverride: z.boolean().optional(),
  /** Yeni ödeme planı metni ('05/3-4-5', '05.03.2026', 'NAKİT' ...) */
  plan: z.string().max(120).optional(),
  cancelled: z.boolean().optional(),
  excluded: z.boolean().nullable().optional(),
  clearReviewFlag: z.boolean().optional(),
  reason: z.string().max(500).optional(),
})

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 403 })

  const { id } = await ctx.params
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 })
  const body = parsed.data

  const admin = createAdminSupabase()
  const inv = await loadInvoiceForOps(admin, id)
  if (!inv) return NextResponse.json({ error: 'İrsaliye bulunamadı.' }, { status: 404 })

  const updates: Record<string, unknown> = {}
  const audits: Array<{ action: string; field?: string; oldValue?: unknown; newValue?: unknown; reason?: string | null }> = []
  let needsInstallmentRegen = false
  let needsSideRefresh = false
  let planDueDates: string[] | undefined
  let planNoDate = false
  let planSource: 'auto_plan' | 'default_invoice_date' = 'auto_plan'

  // Satış tipi
  if (body.saleType !== undefined && body.saleType !== effectiveType(inv)) {
    audits.push({
      action: 'TIP_DEGISIKLIGI',
      field: 'satis_tipi',
      oldValue: effectiveType(inv),
      newValue: body.saleType,
      reason: body.reason ?? null,
    })
    updates.sale_type_override = body.saleType === inv.sale_type_auto ? null : body.saleType
    inv.sale_type_override = body.saleType === inv.sale_type_auto ? null : body.saleType
    needsSideRefresh = true
    needsInstallmentRegen = true // OTHER→tip: taksit yok → üretilmeli; tip→OTHER: kaldırılmalı
    updates.needs_review = false
  }

  // Tutar
  if (body.clearAmountOverride) {
    if (inv.amount_eur_cents_override !== null) {
      audits.push({
        action: 'TUTAR_DEGISIKLIGI',
        field: 'tutar_eur',
        oldValue: inv.amount_eur_cents_override,
        newValue: inv.amount_eur_cents,
        reason: body.reason ?? null,
      })
      updates.amount_eur_cents_override = null
      inv.amount_eur_cents_override = null
      needsInstallmentRegen = true
    }
  } else if (body.amountEur !== undefined) {
    const cents = parseEurToCents(body.amountEur)
    if (cents === null || cents < 0) {
      return NextResponse.json({ error: "Tutar okunamadı. Örnek biçim: 51.414,86" }, { status: 400 })
    }
    const current = inv.amount_eur_cents_override ?? inv.amount_eur_cents
    if (cents !== current) {
      audits.push({
        action: 'TUTAR_DEGISIKLIGI',
        field: 'tutar_eur',
        oldValue: current,
        newValue: cents,
        reason: body.reason ?? null,
      })
      updates.amount_eur_cents_override = cents === inv.amount_eur_cents ? null : cents
      inv.amount_eur_cents_override = cents === inv.amount_eur_cents ? null : cents
      needsInstallmentRegen = true
    }
  }

  // Ödeme planı (konsinye tarihleri)
  if (body.plan !== undefined) {
    const planResult = parseOdemePlani(body.plan, inv.invoice_date)
    if (planResult.status === 'unparsed') {
      return NextResponse.json(
        { error: `Plan çözülemedi: "${body.plan}". Örnekler: 05.03.2026 · 05/3-4-5 · 05/ 4--8--12 · NAKİT` },
        { status: 400 },
      )
    }
    audits.push({
      action: 'VADE_DEGISIKLIGI',
      field: 'odeme_plani',
      oldValue: inv.plan_override_note ?? inv.odeme_plani_raw,
      newValue: body.plan,
      reason: body.reason ?? null,
    })
    updates.plan_override_note = body.plan
    inv.plan_override_note = body.plan
    updates.needs_review = false
    needsInstallmentRegen = true
    planDueDates = planResult.dueDates
    planNoDate = planResult.status === 'empty_default'
    planSource = planResult.status === 'empty_default' ? 'default_invoice_date' : 'auto_plan'
  }

  // İptal / geri alma
  if (body.cancelled !== undefined) {
    const isCancelled = inv.cancelled_at !== null
    if (body.cancelled && !isCancelled) {
      if (!body.reason?.trim()) {
        return NextResponse.json({ error: 'İptal için sebep girilmesi zorunludur.' }, { status: 400 })
      }
      updates.cancelled_at = new Date().toISOString()
      updates.cancelled_by = session.email
      updates.cancel_reason = body.reason
      audits.push({ action: 'IPTAL', field: 'iptal', oldValue: false, newValue: true, reason: body.reason })
    } else if (!body.cancelled && isCancelled) {
      updates.cancelled_at = null
      updates.cancelled_by = null
      updates.cancel_reason = null
      audits.push({ action: 'IPTAL_GERI_ALMA', field: 'iptal', oldValue: true, newValue: false, reason: body.reason ?? null })
    }
  }

  // Takip dışı bırakma / dahil etme
  if (body.excluded !== undefined && body.excluded !== inv.excluded_override) {
    audits.push({
      action: 'TAKIP_DISI_DEGISIKLIGI',
      field: 'takip_disi',
      oldValue: inv.excluded_override,
      newValue: body.excluded,
      reason: body.reason ?? null,
    })
    updates.excluded_override = body.excluded
  }

  if (body.clearReviewFlag) {
    updates.needs_review = false
    updates.raw_changed_after_override = false
    audits.push({ action: 'INCELEME_KAPATILDI', field: 'inceleme', oldValue: true, newValue: false, reason: body.reason ?? null })
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Değişiklik yok.' }, { status: 400 })
  }

  updates.updated_at = new Date().toISOString()
  const { error: updateError } = await admin.from('invoices').update(updates).eq('id', id)
  if (updateError) return NextResponse.json({ error: 'Kayıt güncellenemedi: ' + updateError.message }, { status: 500 })

  if (needsSideRefresh) await refreshInstallmentSides(admin, inv)
  if (needsInstallmentRegen) {
    await regenerateInstallments(admin, inv, {
      dueDates: planDueDates,
      noDateFlag: planNoDate,
      source: planDueDates ? planSource : undefined,
    })
  }

  await auditInvoiceChange(admin, session.email, inv, audits)
  const recompute = await runRecompute(admin, 'edit', session.email)

  return NextResponse.json({ ok: true, recompute: { runId: recompute.runId } })
}
