import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession } from '@/lib/auth'
import { auditInvoiceChange, loadInvoiceForOps, refreshInstallmentSides, regenerateInstallments } from '@/lib/invoiceOps'
import { runRecompute } from '@/lib/recompute'
import { createAdminSupabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 120

// İnceleme kuyruğundan toplu sınıflandırma onayı.

const Body = z.object({
  items: z
    .array(
      z.object({
        invoiceId: z.string().uuid(),
        saleType: z.enum(['PESIN', 'KONSINYE', 'KONSINYE_PESIN']),
      }),
    )
    .min(1)
    .max(500),
})

export async function POST(request: Request) {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 403 })

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 })

  const admin = createAdminSupabase()
  let applied = 0

  for (const item of parsed.data.items) {
    const inv = await loadInvoiceForOps(admin, item.invoiceId)
    if (!inv) continue

    const oldType = inv.sale_type_override ?? inv.sale_type_auto
    const override = item.saleType === inv.sale_type_auto ? null : item.saleType
    const { error } = await admin
      .from('invoices')
      .update({
        sale_type_override: override,
        needs_review: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.invoiceId)
    if (error) continue

    inv.sale_type_override = override
    await refreshInstallmentSides(admin, inv)
    await regenerateInstallments(admin, inv)
    await auditInvoiceChange(admin, session.email, inv, [
      { action: 'SINIFLANDIRMA', field: 'satis_tipi', oldValue: oldType, newValue: item.saleType },
    ])
    applied++
  }

  if (applied === 0) return NextResponse.json({ error: 'Hiçbir kayıt güncellenemedi.' }, { status: 400 })

  const recompute = await runRecompute(admin, 'edit', session.email)
  return NextResponse.json({ ok: true, applied, recompute: { runId: recompute.runId } })
}
