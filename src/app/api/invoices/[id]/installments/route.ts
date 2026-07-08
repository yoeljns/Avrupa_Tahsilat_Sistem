import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession } from '@/lib/auth'
import { parseEurToCents } from '@/lib/engine/money'
import { auditInvoiceChange, effectiveAmount, effectiveType, loadInvoiceForOps, sideOfType } from '@/lib/invoiceOps'
import { runRecompute } from '@/lib/recompute'
import { createAdminSupabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 120

// Taksitleri elle düzenleme: tam set gönderilir, toplam etkin tutara eşit olmalıdır.
// Kaydedilen taksitler source='manual' olur ve içe aktarmalar onlara dokunmaz.

const Body = z.object({
  installments: z
    .array(
      z.object({
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-AA-GG biçiminde olmalı'),
        amountEur: z.string().max(40),
      }),
    )
    .min(1, 'En az bir taksit gerekli')
    .max(36),
  reason: z.string().max(500).optional(),
})

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 403 })

  const { id } = await ctx.params
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Geçersiz istek.' }, { status: 400 })
  }

  const admin = createAdminSupabase()
  const inv = await loadInvoiceForOps(admin, id)
  if (!inv) return NextResponse.json({ error: 'İrsaliye bulunamadı.' }, { status: 404 })

  const side = sideOfType(effectiveType(inv))
  if (side === null) {
    return NextResponse.json({ error: 'Önce irsaliyenin satış tipini belirleyin (sınıflandırma bekliyor).' }, { status: 400 })
  }
  const amount = effectiveAmount(inv)
  if (amount === null) {
    return NextResponse.json({ error: 'İrsaliyenin EURO tutarı yok; önce tutar girin.' }, { status: 400 })
  }

  const rows: Array<{ dueDate: string; amountCents: number }> = []
  for (const t of parsed.data.installments) {
    const cents = parseEurToCents(t.amountEur)
    if (cents === null || cents < 0) {
      return NextResponse.json({ error: `Taksit tutarı okunamadı: "${t.amountEur}"` }, { status: 400 })
    }
    rows.push({ dueDate: t.dueDate, amountCents: cents })
  }
  const sum = rows.reduce((s, r) => s + r.amountCents, 0)
  if (sum !== amount) {
    return NextResponse.json(
      { error: `Taksit toplamı (${(sum / 100).toFixed(2)} €) irsaliye tutarına (${(amount / 100).toFixed(2)} €) eşit olmalı.` },
      { status: 400 },
    )
  }

  const { data: oldRows } = await admin
    .from('installments')
    .select('due_date, amount_eur_cents, source')
    .eq('invoice_id', id)
    .order('seq')

  const { error: delError } = await admin.from('installments').delete().eq('invoice_id', id)
  if (delError) return NextResponse.json({ error: 'Eski taksitler silinemedi: ' + delError.message }, { status: 500 })

  rows.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
  const { error: insError } = await admin.from('installments').insert(
    rows.map((r, i) => ({
      invoice_id: id,
      firm_id: inv.firm_id,
      side,
      seq: i + 1,
      due_date: r.dueDate,
      amount_eur_cents: r.amountCents,
      source: 'manual',
      no_date_flag: false,
      remaining_eur_cents: null,
    })),
  )
  if (insError) return NextResponse.json({ error: 'Taksitler yazılamadı: ' + insError.message }, { status: 500 })

  await auditInvoiceChange(admin, session.email, inv, [
    {
      action: 'TAKSIT_DUZENLEME',
      field: 'taksitler',
      oldValue: oldRows,
      newValue: rows.map((r) => ({ due_date: r.dueDate, amount_eur_cents: r.amountCents })),
      reason: parsed.data.reason ?? null,
    },
  ])

  const recompute = await runRecompute(admin, 'edit', session.email)
  return NextResponse.json({ ok: true, recompute: { runId: recompute.runId } })
}
