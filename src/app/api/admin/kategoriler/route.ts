import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession } from '@/lib/auth'
import { writeAudit } from '@/lib/db'
import { kategorileriYukle } from '@/lib/kategoriler'
import { SINIFSIZ_KOD, kodOnerisi } from '@/lib/kategoriMeta'
import { KategoriKodu } from '@/lib/kuralSemasi'
import { RENK_ANAHTARLARI } from '@/lib/renkler'
import { createAdminSupabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

// Satış kategorileri: oluştur / güncelle / sırala / sil — YALNIZ YÖNETİCİ.
// Davranış (Peşin gibi / Vadeli gibi / hesaba katılmaz) değişimi ayrı uçtadır
// (taraf): etkisi önizlenir, taksitler uyarlanır, tam hesap yapılır.

const Renk = z.enum(RENK_ANAHTARLARI as [string, ...string[]])
const Ad = z.string().trim().min(1, 'Ad boş olamaz.').max(60, 'Ad en fazla 60 karakter olabilir.')
const KisaAd = z.string().trim().max(20, 'Kısa ad en fazla 20 karakter olabilir.').nullable()
const Aciklama = z.string().trim().max(300, 'Açıklama en fazla 300 karakter olabilir.').nullable()

const Olustur = z.object({
  action: z.literal('olustur'),
  kod: KategoriKodu.optional(),
  ad: Ad,
  kisa_ad: KisaAd.optional(),
  renk: Renk,
  taraf: z.enum(['PESIN', 'VADELI']).nullable(),
  aciklama: Aciklama.optional(),
  sayfada_suzgec: z.boolean().default(true),
  panoda_kart: z.boolean().default(false),
})
const Guncelle = z.object({
  action: z.literal('guncelle'),
  kod: KategoriKodu,
  ad: Ad.optional(),
  kisa_ad: KisaAd.optional(),
  renk: Renk.optional(),
  aciklama: Aciklama.optional(),
  sayfada_suzgec: z.boolean().optional(),
  panoda_kart: z.boolean().optional(),
  aktif: z.boolean().optional(),
})
const Sirala = z.object({ action: z.literal('sirala'), kodlar: z.array(KategoriKodu).min(1).max(200) })
const Sil = z.object({ action: z.literal('sil'), kod: KategoriKodu })
const Body = z.discriminatedUnion('action', [Olustur, Guncelle, Sirala, Sil])

const ALANLAR = ['ad', 'kisa_ad', 'renk', 'aciklama', 'sayfada_suzgec', 'panoda_kart', 'aktif'] as const

export async function POST(request: Request) {
  const session = await apiSession(['yonetici'])
  if (!session) return NextResponse.json({ error: 'Kategori ayarlarını yalnız Yönetici değiştirebilir.' }, { status: 403 })

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Geçersiz istek.' }, { status: 400 })
  const body = parsed.data
  const admin = createAdminSupabase()
  const mevcut = await kategorileriYukle(admin)

  if (body.action === 'olustur') {
    const kod = body.kod ?? kodOnerisi(body.ad)
    if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(kod)) return NextResponse.json({ error: 'Addan kod üretilemedi; kodu elle girin.' }, { status: 400 })
    if (mevcut.some((k) => k.kod === kod)) return NextResponse.json({ error: `"${kod}" kodlu bir kategori zaten var.` }, { status: 409 })
    if (mevcut.some((k) => k.ad.toLocaleLowerCase('tr') === body.ad.toLocaleLowerCase('tr'))) {
      return NextResponse.json({ error: `"${body.ad}" adlı bir kategori zaten var.` }, { status: 409 })
    }
    const sira = Math.max(0, ...mevcut.filter((k) => k.kod !== SINIFSIZ_KOD).map((k) => k.sira)) + 10
    const satir = {
      kod,
      ad: body.ad,
      kisa_ad: body.kisa_ad || null,
      renk: body.renk,
      taraf: body.taraf,
      sira,
      aktif: true,
      sistem: false,
      aciklama: body.aciklama || null,
      sayfada_suzgec: body.sayfada_suzgec,
      panoda_kart: body.panoda_kart,
      updated_by: session.email,
    }
    const { error } = await admin.from('sale_categories').insert(satir)
    if (error) return NextResponse.json({ error: 'Kategori oluşturulamadı: ' + error.message }, { status: 400 })
    await writeAudit(admin, [{ actorEmail: session.email, entityType: 'kategori', entityId: kod, action: 'KATEGORI_OLUSTURMA', newValue: satir }])
    return NextResponse.json({ ok: true, kod })
  }

  if (body.action === 'guncelle') {
    const eski = mevcut.find((k) => k.kod === body.kod)
    if (!eski) return NextResponse.json({ error: 'Kategori bulunamadı.' }, { status: 404 })
    const degisiklik: Record<string, unknown> = {}
    for (const a of ALANLAR) {
      const yeni = body[a]
      if (yeni === undefined) continue
      const normal = typeof yeni === 'string' && (a === 'kisa_ad' || a === 'aciklama') && yeni === '' ? null : yeni
      if (normal !== (eski[a] ?? null)) degisiklik[a] = normal
    }
    if (Object.keys(degisiklik).length === 0) return NextResponse.json({ error: 'Değişiklik yok.' }, { status: 400 })
    if (degisiklik.aktif === false) {
      if (eski.sistem) return NextResponse.json({ error: 'Sistem kategorileri pasifleştirilemez; görünümünü ayarlardan gizleyebilirsiniz.' }, { status: 400 })
      const { count } = await admin
        .from('sale_category_rules')
        .select('id', { count: 'exact', head: true })
        .eq('kategori_kod', body.kod)
        .eq('aktif', true)
      if ((count ?? 0) > 0) {
        return NextResponse.json({ error: `Bu kategoriyi hedefleyen ${count} etkin tanıma kuralı var; önce kuralları kaldırın.` }, { status: 400 })
      }
    }
    if (degisiklik.ad && mevcut.some((k) => k.kod !== body.kod && k.ad.toLocaleLowerCase('tr') === String(degisiklik.ad).toLocaleLowerCase('tr'))) {
      return NextResponse.json({ error: `"${degisiklik.ad}" adlı bir kategori zaten var.` }, { status: 409 })
    }
    const { error } = await admin.from('sale_categories').update({ ...degisiklik, updated_by: session.email }).eq('kod', body.kod)
    if (error) return NextResponse.json({ error: 'Güncellenemedi: ' + error.message }, { status: 400 })
    const eskiDeger: Record<string, unknown> = {}
    for (const a of Object.keys(degisiklik)) eskiDeger[a] = (eski as unknown as Record<string, unknown>)[a] ?? null
    await writeAudit(admin, [
      {
        actorEmail: session.email,
        entityType: 'kategori',
        entityId: body.kod,
        action: degisiklik.aktif === false ? 'KATEGORI_PASIFLESTIRME' : degisiklik.aktif === true ? 'KATEGORI_AKTIFLESTIRME' : 'KATEGORI_GUNCELLEME',
        field: Object.keys(degisiklik).join(','),
        oldValue: eskiDeger,
        newValue: degisiklik,
      },
    ])
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'sirala') {
    const bilinen = new Set(mevcut.map((k) => k.kod))
    const bilinmeyen = body.kodlar.find((k) => !bilinen.has(k))
    if (bilinmeyen) return NextResponse.json({ error: `Bilinmeyen kategori: ${bilinmeyen}` }, { status: 400 })
    const eskiSira = new Map(mevcut.map((k) => [k.kod, k.sira]))
    const kodlar = body.kodlar.filter((k) => k !== SINIFSIZ_KOD)
    for (let i = 0; i < kodlar.length; i++) {
      const yeni = (i + 1) * 10
      if (eskiSira.get(kodlar[i]) === yeni) continue
      const { error } = await admin.from('sale_categories').update({ sira: yeni, updated_by: session.email }).eq('kod', kodlar[i])
      if (error) return NextResponse.json({ error: 'Sıra kaydedilemedi: ' + error.message }, { status: 400 })
    }
    await writeAudit(admin, [{ actorEmail: session.email, entityType: 'kategori', entityId: 'sira', action: 'KATEGORI_SIRALAMA', newValue: kodlar }])
    return NextResponse.json({ ok: true })
  }

  // sil
  const eski = mevcut.find((k) => k.kod === body.kod)
  if (!eski) return NextResponse.json({ error: 'Kategori bulunamadı.' }, { status: 404 })
  if (eski.sistem) return NextResponse.json({ error: 'Sistem kategorisi silinemez.' }, { status: 400 })
  const { error } = await admin.from('sale_categories').delete().eq('kod', body.kod)
  if (error) {
    const kullaniliyor = /foreign key|23503|violates/i.test(error.message)
    return NextResponse.json(
      { error: kullaniliyor ? 'Bu kategori irsaliyelerde ya da kurallarda kullanılıyor; silmek yerine pasifleştirin.' : 'Silinemedi: ' + error.message },
      { status: 400 },
    )
  }
  await writeAudit(admin, [{ actorEmail: session.email, entityType: 'kategori', entityId: body.kod, action: 'KATEGORI_SILME', oldValue: eski }])
  return NextResponse.json({ ok: true })
}
