import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { supabaseAnonKey, supabaseUrl } from '@/lib/env'
import { excelSinamasi } from '@/lib/export/belgeSinamasi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SAĞLIK / HIZ KONTROLÜ (herkese açık, veri döndürmez): uygulamanın koştuğu
// bölge ve veritabanına gidiş-dönüş süresi. Yavaşlık şikâyetinde ilk bakılacak
// yer: aynı bölgedeyse HTTPS turu ~30-40 ms, okyanus aşırıysa ~100+ ms olur.
//
// ?belge=1 → belge kütüphanelerinin öz-sınaması: UYDURMA örnek veriden küçük bir
// Excel dosyası üretilir, yalnız boyutu döner (gerçek veri yok). Yayından sonra
// kütüphanelerin sunucuda yüklendiğini oturum açmadan doğrulamak içindir.

export async function GET(request: Request) {
  const belgeIstendi = new URL(request.url).searchParams.get('belge') === '1'
  const bolge = process.env.VERCEL_REGION ?? 'yerel'
  let turlar: number[] = []
  let hata: string | null = null
  try {
    const supabase = createClient(supabaseUrl(), supabaseAnonKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      // Oturumsuz istek: RLS boş liste döndürür — yalnız süre ölçülür
      await supabase.from('app_settings').select('key').limit(1)
      turlar.push(Math.round(performance.now() - t0))
    }
  } catch (e) {
    hata = e instanceof Error ? e.message : String(e)
    turlar = []
  }
  const enHizli = turlar.length > 0 ? Math.min(...turlar) : null
  const belge = belgeIstendi ? { excel: await excelSinamasi() } : undefined
  return NextResponse.json(
    {
      durum: hata || (belge && !belge.excel.ok) ? 'hata' : 'ok',
      sunucu_bolgesi: bolge,
      veritabani_tur_ms: turlar,
      en_hizli_tur_ms: enHizli,
      yorum:
        enHizli === null
          ? 'Ölçüm alınamadı.'
          : enHizli < 60
            ? 'Uygulama ve veritabanı aynı bölgede (normal).'
            : 'Uygulama veritabanından uzak: her sorgu ' + enHizli + ' ms yol alıyor.',
      hata,
      ...(belge ? { belge } : {}),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
