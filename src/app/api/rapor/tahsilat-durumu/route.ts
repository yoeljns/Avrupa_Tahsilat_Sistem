import { NextResponse } from 'next/server'
import { isMissingRelationError } from '@/components/MigrationNeeded'
import { apiSession, isStaffRole } from '@/lib/auth'
import { sorumluDosyaEki } from '@/lib/bakiye/suzgecParam'
import { todayISO, trDateTime } from '@/lib/format'
import { pdfUret, pdfYaniti } from '@/lib/pdf/pdf'
import { raporVerisi, type RaporVerisi } from '@/lib/queries'
import { raporSecenegiOku, tahsilatDurumuKur } from '@/lib/rapor/tahsilatDurumu'
import { tahsilatDurumuBelgesi, tahsilatDurumuDosyaAdi } from '@/lib/rapor/tahsilatDurumuPdf'
import { createServerSupabase } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

// TAHSİLAT DURUM RAPORU (PDF) — ?tur=kisa|ozet|ayrintili&sorumlu=&ay=YYYY-AA
//
// Bütün roller indirebilir. Veri KULLANICININ oturumuyla okunur (RLS):
// pazarlamacının raporu yalnız kendisine atanmış firmaları içerir. Sorumlu
// süzgeci yalnız tüm firmaları gören rollerde uygulanır.

export async function GET(req: Request) {
  const session = await apiSession()
  if (!session) return NextResponse.json({ error: 'Oturum gerekli. Lütfen yeniden giriş yapın.' }, { status: 401 })

  const secenek = raporSecenegiOku(new URL(req.url).searchParams)
  if (!isStaffRole(session.role)) secenek.sorumlu = ''
  const supabase = await createServerSupabase()
  const bugun = todayISO()

  let veri: RaporVerisi
  try {
    veri = await raporVerisi(supabase, bugun)
  } catch (e) {
    if (isMissingRelationError(e)) {
      return NextResponse.json({ error: 'Veritabanı güncellemesi (0010) uygulanmamış; bu rapor henüz üretilemiyor.' }, { status: 503 })
    }
    console.error('tahsilat-durumu:', e)
    return NextResponse.json({ error: 'Rapor verisi okunamadı. Lütfen tekrar deneyin.' }, { status: 500 })
  }

  try {
    const durum = tahsilatDurumuKur(veri, bugun, secenek)
    const pdf = await pdfUret(tahsilatDurumuBelgesi(durum, secenek.tur, trDateTime(new Date().toISOString())))
    return pdfYaniti(pdf, tahsilatDurumuDosyaAdi(bugun, secenek.tur, sorumluDosyaEki(secenek.sorumlu)))
  } catch (e) {
    console.error('tahsilat-durumu (belge):', e)
    return NextResponse.json({ error: 'PDF raporu oluşturulamadı.' }, { status: 500 })
  }
}
