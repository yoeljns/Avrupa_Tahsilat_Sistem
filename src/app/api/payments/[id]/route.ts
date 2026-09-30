import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession } from '@/lib/auth'
import { writeAudit } from '@/lib/db'
import { parseEurToCents } from '@/lib/engine/money'
import { recomputeFirms } from '@/lib/recompute'
import { createAdminSupabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 120

// Ödemeye elle EUR: dosyada DÖVİZ EURO'su boş (ya da yanlış) ödemenin hesapta
// kullanılacak tutarı. Ham veri korunur; tutar override kolonuna yazılır ve
// içe aktarma bu kolona hiç dokunmaz. Kayıttan sonra YALNIZ ödemenin firması
// yeniden hesaplanır.

const Body = z
  .object({
    amountEur: z.string().max(40).optional(),
    /** Elle girilen tutarı kaldır → dosyadaki DÖVİZ EURO kullanılır */
    clearOverride: z.boolean().optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((b) => b.amountEur !== undefined || b.clearOverride === true)

interface OdemeSatiri {
  id: string
  islem_kodu: string
  firm_id: string
  doviz_eur_cents: number | null
  doviz_eur_cents_override: number | null
  is_alc: boolean
  is_complete: boolean
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 403 })

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Ödeme bulunamadı.' }, { status: 404 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 })
  const body = parsed.data

  const admin = createAdminSupabase()
  const { data, error } = await admin
    .from('payments')
    .select('id, islem_kodu, firm_id, doviz_eur_cents, doviz_eur_cents_override, is_alc, is_complete')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    const eksikGoc = /doviz_eur_cents_override/.test(error.message)
    return NextResponse.json(
      { error: eksikGoc ? 'Veritabanı güncellemesi (0008) uygulanmamış.' : 'Ödeme okunamadı: ' + error.message },
      { status: eksikGoc ? 503 : 500 },
    )
  }
  const odeme = data as OdemeSatiri | null
  if (!odeme) return NextResponse.json({ error: 'Ödeme bulunamadı.' }, { status: 404 })
  if (odeme.is_alc || !odeme.is_complete) {
    return NextResponse.json({ error: 'ALC ya da tamamlanmamış kayıt hesaba girmez; tutar girilemez.' }, { status: 400 })
  }

  const mevcut = odeme.doviz_eur_cents_override ?? odeme.doviz_eur_cents
  let yeniOverride: number | null
  let yeniEtkin: number | null
  if (body.clearOverride) {
    if (odeme.doviz_eur_cents_override === null) {
      return NextResponse.json({ error: 'Bu ödemede elle girilmiş tutar yok.' }, { status: 400 })
    }
    yeniOverride = null
    yeniEtkin = odeme.doviz_eur_cents
  } else {
    const kurus = parseEurToCents(body.amountEur)
    if (kurus === null || kurus <= 0) {
      return NextResponse.json({ error: 'Tutar okunamadı. Örnek biçim: 17.382,63' }, { status: 400 })
    }
    if (kurus === mevcut) return NextResponse.json({ error: 'Değişiklik yok.' }, { status: 400 })
    // Dosyadaki tutarla aynıysa elle kayda gerek yok
    yeniOverride = kurus === odeme.doviz_eur_cents ? null : kurus
    yeniEtkin = kurus
  }

  const { error: yazError } = await admin
    .from('payments')
    .update({ doviz_eur_cents_override: yeniOverride, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (yazError) return NextResponse.json({ error: 'Kayıt güncellenemedi: ' + yazError.message }, { status: 500 })

  try {
    await writeAudit(admin, [
      {
        actorId: session.userId,
        actorEmail: session.email,
        entityType: 'odeme',
        entityId: odeme.islem_kodu,
        action: 'TUTAR_DEGISIKLIGI',
        field: 'tutar_eur',
        oldValue: mevcut,
        newValue: yeniEtkin,
        reason: body.reason?.trim() || (body.clearOverride ? 'Elle girilen tutar kaldırıldı; dosyadaki DÖVİZ EURO kullanılıyor' : null),
      },
    ])
    const recompute = await recomputeFirms(admin, [odeme.firm_id], session.email)
    return NextResponse.json({ ok: true, recompute })
  } catch (e) {
    return NextResponse.json(
      { error: 'Kayıt yapıldı ama hesap güncellenemedi: ' + (e instanceof Error ? e.message : String(e)) },
      { status: 500 },
    )
  }
}
