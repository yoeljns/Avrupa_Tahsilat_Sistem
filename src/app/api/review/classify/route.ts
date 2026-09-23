import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession } from '@/lib/auth'
import { auditInvoiceChange, loadInvoiceForOps, overrideDegeri, refreshInstallmentSides, regenerateInstallments } from '@/lib/invoiceOps'
import { kategorileriYukle } from '@/lib/kategoriler'
import { atanabilirKategoriler, tarafHaritasi } from '@/lib/kategoriMeta'
import { recomputeFirms } from '@/lib/recompute'
import { createAdminSupabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 120

// İnceleme kuyruğundan toplu sınıflandırma onayı.

const Body = z.object({
  items: z
    .array(
      z.object({
        invoiceId: z.string().uuid(),
        saleType: z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/),
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
  // Kategoriler panelden yönetilir: yalnız aktif ve "sınıflandırılmadı" olmayanlar atanabilir
  const kategoriler = await kategorileriYukle(admin)
  const atanabilir = new Set(atanabilirKategoriler(kategoriler).map((k) => k.kod))
  const gecersiz = parsed.data.items.find((i) => !atanabilir.has(i.saleType))
  if (gecersiz) return NextResponse.json({ error: `Geçersiz ya da pasif kategori: ${gecersiz.saleType}` }, { status: 400 })
  const harita = tarafHaritasi(kategoriler)

  let applied = 0
  const etkilenenFirmalar = new Set<string>()

  for (const item of parsed.data.items) {
    const inv = await loadInvoiceForOps(admin, item.invoiceId)
    if (!inv) continue

    const oldType = inv.sale_type_override ?? inv.sale_type_auto
    const override = overrideDegeri(inv, item.saleType)
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
    await refreshInstallmentSides(admin, inv, harita)
    await regenerateInstallments(admin, inv, { tarafHaritasi: harita })
    await auditInvoiceChange(admin, session.email, inv, [
      { action: 'SINIFLANDIRMA', field: 'satis_tipi', oldValue: oldType, newValue: item.saleType },
    ])
    etkilenenFirmalar.add(inv.firm_id)
    applied++
  }

  if (applied === 0) return NextResponse.json({ error: 'Hiçbir kayıt güncellenemedi.' }, { status: 400 })

  // Yalnız sınıflandırılan irsaliyelerin firmaları yeniden hesaplanır
  const recompute = await recomputeFirms(admin, Array.from(etkilenenFirmalar), session.email)
  return NextResponse.json({ ok: true, applied, recompute })
}
