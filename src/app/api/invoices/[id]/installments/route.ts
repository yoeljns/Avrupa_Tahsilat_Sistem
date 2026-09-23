import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession } from '@/lib/auth'
import { isValidISODate } from '@/lib/engine/dates'
import { parseEurToCents } from '@/lib/engine/money'
import { auditInvoiceChange, effectiveAmount, effectiveType, loadInvoiceForOps, sideOfType, tarafHaritasiYukle } from '@/lib/invoiceOps'
import { recomputeFirms } from '@/lib/recompute'
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

  const side = sideOfType(effectiveType(inv), await tarafHaritasiYukle(admin))
  if (side === null) {
    return NextResponse.json(
      { error: 'Bu irsaliye borç sayılmıyor (sınıflandırma bekliyor ya da kategorisi "hesaba katılmaz"); elle taksit girilemez.' },
      { status: 400 },
    )
  }
  const amount = effectiveAmount(inv)
  if (amount === null) {
    return NextResponse.json({ error: 'İrsaliyenin EURO tutarı yok; önce tutar girin.' }, { status: 400 })
  }

  const rows: Array<{ dueDate: string; amountCents: number }> = []
  for (const t of parsed.data.installments) {
    if (!isValidISODate(t.dueDate)) {
      return NextResponse.json({ error: `Geçersiz tarih: ${t.dueDate}` }, { status: 400 })
    }
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

  // Silme + ekleme TEK işlemde: yarıda kalırsa eski taksitler yerinde kalır
  rows.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
  const { error: yazError } = await admin.rpc('rpc_elle_taksit_yaz', {
    p_invoice_id: id,
    p_firm_id: inv.firm_id,
    p_side: side,
    p_taksitler: rows.map((r, i) => ({ seq: i + 1, due_date: r.dueDate, amount_eur_cents: r.amountCents })),
  })
  if (yazError) return NextResponse.json({ error: 'Taksitler yazılamadı: ' + yazError.message }, { status: 500 })

  await auditInvoiceChange(admin, session.email, inv, [
    {
      action: 'TAKSIT_DUZENLEME',
      field: 'taksitler',
      oldValue: oldRows,
      newValue: rows.map((r) => ({ due_date: r.dueDate, amount_eur_cents: r.amountCents })),
      reason: parsed.data.reason ?? null,
    },
  ])

  try {
    const recompute = await recomputeFirms(admin, [inv.firm_id], session.email)
    return NextResponse.json({ ok: true, recompute })
  } catch (e) {
    return NextResponse.json(
      { error: 'Taksitler kaydedildi ama hesap güncellenemedi: ' + (e instanceof Error ? e.message : String(e)) },
      { status: 500 },
    )
  }
}
