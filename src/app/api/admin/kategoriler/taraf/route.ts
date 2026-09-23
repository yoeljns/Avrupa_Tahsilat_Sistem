import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession } from '@/lib/auth'
import { writeAudit } from '@/lib/db'
import { kategorileriYukle } from '@/lib/kategoriler'
import { DAVRANISLAR, davranisOf, tarafHaritasi } from '@/lib/kategoriMeta'
import { KategoriKodu } from '@/lib/kuralSemasi'
import { runRecompute } from '@/lib/recompute'
import { taksitsizlereTaksitKur } from '@/lib/siniflandirma'
import { createAdminSupabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 120

// Kategorinin DAVRANIŞINI değiştirir (Peşin gibi ↔ Vadeli gibi ↔ hesaba katılmaz).
// uygula=false → yalnız etki önizlemesi. uygula=true → tek işlemde taraf + taksit
// uyarlaması, gerekiyorsa plandan taksit kurulumu, denetim ve TAM hesap.

const Body = z.object({
  kod: KategoriKodu,
  taraf: z.enum(['PESIN', 'VADELI']).nullable(),
  uygula: z.boolean().default(false),
})

interface YonetimSatiri {
  kod: string
  irsaliye: number
  tahsisteki: number
  acik: number
  firma: number
  elle_taksitli: number
}

export async function POST(request: Request) {
  const session = await apiSession(['yonetici'])
  if (!session) return NextResponse.json({ error: 'Kategori davranışını yalnız Yönetici değiştirebilir.' }, { status: 403 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Geçersiz istek.' }, { status: 400 })
  const { kod, taraf, uygula } = parsed.data

  const admin = createAdminSupabase()
  const kategoriler = await kategorileriYukle(admin)
  const kat = kategoriler.find((k) => k.kod === kod)
  if (!kat) return NextResponse.json({ error: 'Kategori bulunamadı.' }, { status: 404 })
  if (kat.sistem) return NextResponse.json({ error: 'Sistem kategorilerinin davranışı değiştirilemez.' }, { status: 400 })
  if (kat.taraf === taraf) return NextResponse.json({ error: 'Kategori zaten bu davranışta.' }, { status: 400 })

  const { data: yonetim, error: yErr } = await admin.rpc('rpc_kategori_yonetimi')
  if (yErr) return NextResponse.json({ error: 'Etki hesaplanamadı: ' + yErr.message }, { status: 500 })
  const s = ((yonetim as { kategoriler?: YonetimSatiri[] })?.kategoriler ?? []).find((k) => k.kod === kod)
  const etki = {
    irsaliye: s?.irsaliye ?? 0,
    tahsisteki: s?.tahsisteki ?? 0,
    acik: s?.acik ?? 0,
    firma: s?.firma ?? 0,
    elle_taksitli: s?.elle_taksitli ?? 0,
    eski: DAVRANISLAR[davranisOf(kat.taraf)].ad,
    yeni: DAVRANISLAR[davranisOf(taraf)].ad,
  }
  if (!uygula) return NextResponse.json({ ok: true, etki })

  const { data: sonuc, error } = await admin.rpc('rpc_kategori_taraf_degistir', { p_kod: kod, p_taraf: taraf, p_kim: session.email })
  if (error) return NextResponse.json({ error: 'Davranış değiştirilemedi: ' + error.message }, { status: 400 })
  const r = sonuc as { taksitsiz?: string[]; silinen_taksit?: number; taraf_esitlenen?: number }
  const guncel = await kategorileriYukle(admin)
  const kurulan = await taksitsizlereTaksitKur(admin, r.taksitsiz ?? [], tarafHaritasi(guncel))

  await writeAudit(admin, [
    {
      actorEmail: session.email,
      entityType: 'kategori',
      entityId: kod,
      action: 'KATEGORI_DAVRANIS',
      field: 'taraf',
      oldValue: kat.taraf,
      newValue: taraf,
      reason: `${etki.irsaliye} irsaliye; ${r.taraf_esitlenen ?? 0} taksit tarafı güncellendi, ${r.silinen_taksit ?? 0} silindi, ${kurulan} kuruldu`,
    },
  ])
  const hesap = await runRecompute(admin, 'edit', session.email)
  return NextResponse.json({ ok: true, etki, sonuc: { ...r, kurulan }, recompute: { runId: hesap.runId } })
}
