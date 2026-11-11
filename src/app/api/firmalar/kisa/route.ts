import { NextResponse } from 'next/server'
import { apiSession } from '@/lib/auth'
import { firmaListesi } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Üst çubuktaki firma arama kutusunun listesi: [id, kod, ad, şehir].
// Kutu ilk odaklandığında bir kez çağrılır; sayfa açılışlarına sorgu eklemez.
// RLS'li istemci: pazarlamacı yalnız kendi firmalarını alır; takip dışı firmalar yoktur.

export async function GET() {
  const session = await apiSession()
  if (!session) return NextResponse.json({ error: 'Oturum gerekli. Lütfen yeniden giriş yapın.' }, { status: 401 })
  try {
    const liste = await firmaListesi(await createServerSupabase())
    return NextResponse.json({ firmalar: liste.map((f) => [f.id, f.kod, f.ad, f.sehir]) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Firma listesi alınamadı.' }, { status: 500 })
  }
}
