import { NextResponse } from 'next/server'
import { apiSession } from '@/lib/auth'
import { supabaseUrl } from '@/lib/env'
import { createServerSupabase } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// TEŞHİS: "sayfa geçişi neden yavaş?" sorusunu TAHMİNLE değil ÖLÇÜMLE yanıtlar.
// Uygulamanın koştuğu bölge ile veritabanı arasındaki gerçek gidiş-dönüş
// süresini ölçer. Yalnız oturumlu kullanıcı çağırabilir; anahtar sızdırmaz.

async function olc(etiket: string, isi: () => PromiseLike<unknown>) {
  const t0 = performance.now()
  let hata: string | null = null
  try {
    await isi()
  } catch (e) {
    hata = String(e instanceof Error ? e.message : e)
  }
  return { adim: etiket, ms: Math.round(performance.now() - t0), hata }
}

export async function GET() {
  const session = await apiSession()
  if (!session) {
    return NextResponse.json({ hata: 'Oturum gerekli' }, { status: 401 })
  }

  const supabase = await createServerSupabase()
  const olcumler = []

  // 1) En küçük veritabanı turu (saf ağ gecikmesi)
  for (let i = 0; i < 3; i++) {
    olcumler.push(await olc(`db-tur-${i + 1}`, () => supabase.rpc('rpc_oturum_profilim')))
  }
  // 2) Kimlik sunucusu turu (middleware'in eskiden her istekte yaptığı iş)
  olcumler.push(await olc('auth-sunucusu', () => supabase.auth.getUser()))
  // 3) Sayfa verisinin tamamı (tek turluk yeni yol)
  olcumler.push(await olc('matris-verisi', () => supabase.rpc('rpc_matris_verisi', { p_side: 'VADELI' })))

  const dbTurlari = olcumler.filter((o) => o.adim.startsWith('db-tur-') && !o.hata).map((o) => o.ms)
  const enHizliTur = dbTurlari.length > 0 ? Math.min(...dbTurlari) : null

  let dbHost: string | null = null
  try {
    dbHost = new URL(supabaseUrl()).host
  } catch {
    dbHost = null
  }

  return NextResponse.json(
    {
      sunucu_bolgesi: process.env.VERCEL_REGION ?? 'yerel',
      veritabani_host: dbHost,
      en_hizli_db_turu_ms: enHizliTur,
      yorum:
        enHizliTur === null
          ? 'Ölçüm alınamadı.'
          : enHizliTur < 30
            ? 'Uygulama ve veritabanı AYNI bölgede görünüyor.'
            : enHizliTur < 80
              ? 'Yakın bölgeler; gecikme kabul edilebilir.'
              : 'UZAK BÖLGE: her sorgu için ' +
                enHizliTur +
                ' ms gidiyor. Uygulamayı veritabanının bölgesine taşımak en büyük kazancı verir.',
      olcumler,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
