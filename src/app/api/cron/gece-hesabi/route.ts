import { NextResponse } from 'next/server'
import { cronSecret } from '@/lib/env'
import { todayISO } from '@/lib/format'
import { cronYetkili, trGunBasiUtc } from '@/lib/geceHesabi'
import { runRecompute } from '@/lib/recompute'
import { createAdminSupabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 120
export const dynamic = 'force-dynamic'

// Her gece otomatik TAM hesap — Vercel Cron (vercel.json: 00:00 UTC ≈ 03:00 Türkiye).
// Tahsis zaten her düzenlemede firma bazlı güncellenir; gece hesabı bütün sistemi
// o günün tarihiyle tazeler (ör. kural değişikliklerinin geriye dönük etkisi, iadeler).
//  * CRON_SECRET tanımlıysa yalnız Vercel'in zamanlayıcısı çağırabilir (Bearer başlığı).
//  * Günlük koruma: Türkiye günü başından beri bir tam hesap yapıldıysa hiçbir şey
//    yapılmaz → uç, gizli anahtar olmadan da günde en fazla bir kez hesap başlatır.
//  * Hiç hesap yoksa (kurulum ya da veri sıfırlama sonrası) boş bir koşu açılmaz.
export async function GET(request: Request) {
  if (!cronYetkili(request.headers.get('authorization'), cronSecret())) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const admin = createAdminSupabase()
  const { data: guncel, error: kosuHatasi } = await admin.from('v_current_run').select('run_id').maybeSingle()
  if (kosuHatasi) return NextResponse.json({ error: 'Güncel hesap okunamadı: ' + kosuHatasi.message }, { status: 500 })
  if (!guncel?.run_id) {
    return NextResponse.json({ ok: true, atlandi: 'Henüz hesap yok (kurulum ya da veri sıfırlama sonrası).' })
  }

  const { count, error } = await admin
    .from('recon_runs')
    .select('id', { count: 'exact', head: true })
    .gte('started_at', trGunBasiUtc(todayISO()))
  if (error) return NextResponse.json({ error: 'Hesap geçmişi okunamadı: ' + error.message }, { status: 500 })
  if ((count ?? 0) > 0) return NextResponse.json({ ok: true, atlandi: 'Bugün tam hesap zaten yapıldı.' })

  try {
    const stats = await runRecompute(admin, 'cron', 'sistem (gece)')
    return NextResponse.json({ ok: true, stats })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Hesaplama başarısız.' }, { status: 500 })
  }
}
