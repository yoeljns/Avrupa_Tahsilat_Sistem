import { NextResponse } from 'next/server'
import { isMissingRelationError } from '@/components/MigrationNeeded'
import { apiSession } from '@/lib/auth'
import { suzgecOku, vadeliBakiyelerDosyaAdi } from '@/lib/bakiye/suzgecParam'
import { kitapYaz, xlsxYaniti } from '@/lib/export/exceljsYaz'
import { vadeliBakiyelerPlanlari } from '@/lib/export/vadeliBakiyeler'
import { todayISO } from '@/lib/format'
import { bakiyeVerisi } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

// "Vadeli Bakiyeler" Excel'i — elle tutulan borç tablosunun biçiminde
// (renkli ay grupları, donmuş başlıklar, gizli kapanmış aylar, formüller).
//
// Bütün roller indirebilir. Veri KULLANICININ oturumuyla okunur (RLS):
// pazarlamacının dosyasında yalnız kendisine atanmış firmalar olur.
// Parametreler ekrandaki süzgeçle aynıdır: sorumlu, q, acik=1, gecikmis=1.

export async function GET(req: Request) {
  const session = await apiSession()
  if (!session) return NextResponse.json({ error: 'Oturum gerekli. Lütfen yeniden giriş yapın.' }, { status: 401 })

  const suzgec = suzgecOku(new URL(req.url).searchParams)
  const supabase = await createServerSupabase()
  const bugun = todayISO()

  let veri
  try {
    veri = await bakiyeVerisi(supabase, 'VADELI', true)
  } catch (e) {
    if (isMissingRelationError(e)) {
      return NextResponse.json({ error: 'Veritabanı güncellemesi (0009) uygulanmamış; bu rapor henüz üretilemiyor.' }, { status: 503 })
    }
    console.error('vadeli-bakiyeler:', e)
    return NextResponse.json({ error: 'Rapor verisi okunamadı. Lütfen tekrar deneyin.' }, { status: 500 })
  }

  try {
    const { planlar } = vadeliBakiyelerPlanlari(veri, bugun, suzgec)
    return xlsxYaniti(await kitapYaz(planlar), vadeliBakiyelerDosyaAdi(bugun, suzgec))
  } catch (e) {
    console.error('vadeli-bakiyeler (dosya):', e)
    return NextResponse.json({ error: 'Excel dosyası oluşturulamadı.' }, { status: 500 })
  }
}
