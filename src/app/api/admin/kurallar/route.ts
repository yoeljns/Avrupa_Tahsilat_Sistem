import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession } from '@/lib/auth'
import { writeAudit } from '@/lib/db'
import { kuralDogrula } from '@/lib/engine/kurallar'
import { kategorileriYukle, kurallariYukle } from '@/lib/kategoriler'
import { KuralListesi, kuralaCevir } from '@/lib/kuralSemasi'
import { runRecompute } from '@/lib/recompute'
import { siniflandirmaIrsaliyeleriniYukle, siniflandirmaPlani, siniflandirmayiUygula } from '@/lib/siniflandirma'
import { createAdminSupabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 120

// Tanıma kurallarını KAYDEDER ve mevcut irsaliyelere UYGULAR — YALNIZ YÖNETİCİ.
// Önizlemenin imzası verilmelidir: arada veri ya da kural değiştiyse 409 döner
// (kullanıcı görmediği bir sonucu onaylamış olmasın).

const Body = z.object({ kurallar: KuralListesi, imza: z.string().regex(/^[0-9a-f]{32}$/) })

export async function POST(request: Request) {
  const session = await apiSession(['yonetici'])
  if (!session) return NextResponse.json({ error: 'Tanıma kurallarını yalnız Yönetici değiştirebilir.' }, { status: 403 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Geçersiz istek.' }, { status: 400 })

  const admin = createAdminSupabase()
  const kategoriler = await kategorileriYukle(admin)
  const kurallar = parsed.data.kurallar.map(kuralaCevir)
  for (let i = 0; i < kurallar.length; i++) {
    const hata = kuralDogrula(kurallar[i], kategoriler)
    if (hata) return NextResponse.json({ error: `${i + 1}. kural: ${hata}` }, { status: 400 })
  }

  const plan = siniflandirmaPlani(await siniflandirmaIrsaliyeleriniYukle(admin), kurallar, kategoriler)
  if (plan.imza !== parsed.data.imza) {
    return NextResponse.json({ error: 'Önizlemeden sonra veri ya da kurallar değişti. Lütfen yeniden önizleyin.' }, { status: 409 })
  }

  const eskiKurallar = await kurallariYukle(admin)
  const { error } = await admin.rpc('rpc_kurallari_kaydet', { p_kurallar: kurallar, p_kim: session.email })
  if (error) return NextResponse.json({ error: 'Kurallar kaydedilemedi: ' + error.message }, { status: 400 })

  const sonuc = await siniflandirmayiUygula(admin, plan, kategoriler, session.email, 'Tanıma kuralları güncellendi')
  const sade = (k: { kategori_kod: string; alan: string; islec: string; deger: string; sonuc: string; sira: number; aktif: boolean; aciklama: string | null }) => ({
    kategori: k.kategori_kod,
    alan: k.alan,
    islec: k.islec,
    deger: k.deger,
    sonuc: k.sonuc,
    sira: k.sira,
    aktif: k.aktif,
    aciklama: k.aciklama,
  })
  await writeAudit(admin, [
    {
      actorEmail: session.email,
      entityType: 'kategori_kurali',
      entityId: 'kurallar',
      action: 'KURAL_GUNCELLEME',
      oldValue: eskiKurallar.map(sade),
      newValue: kurallar.map(sade),
      reason: `${plan.ozet.etkinDegisen} irsaliyenin tipi değişti, ${plan.ozet.degisen} kayıt güncellendi`,
    },
  ])

  const hesapGerekli = plan.ozet.etkinDegisen > 0 || sonuc.silinenTaksit > 0 || sonuc.kurulanTaksit > 0 || sonuc.taraflananTaksit > 0
  const hesap = hesapGerekli ? await runRecompute(admin, 'edit', session.email) : null
  return NextResponse.json({ ok: true, ozet: plan.ozet, sonuc, recompute: hesap ? { runId: hesap.runId } : null })
}
