import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession } from '@/lib/auth'
import { kuralDogrula } from '@/lib/engine/kurallar'
import { kategorileriYukle } from '@/lib/kategoriler'
import { KuralListesi, kuralaCevir } from '@/lib/kuralSemasi'
import { siniflandirmaIrsaliyeleriniYukle, siniflandirmaPlani } from '@/lib/siniflandirma'
import { createAdminSupabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 60

// Taslak kuralların ETKİ ÖNİZLEMESİ — hiçbir şey yazılmaz. Yönetim rolleri görebilir.

const Body = z.object({ kurallar: KuralListesi })

export async function POST(request: Request) {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 403 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Geçersiz istek.' }, { status: 400 })

  const admin = createAdminSupabase()
  const kategoriler = await kategorileriYukle(admin)
  const kurallar = parsed.data.kurallar.map(kuralaCevir)
  for (let i = 0; i < kurallar.length; i++) {
    const hata = kuralDogrula(kurallar[i], kategoriler)
    if (hata) return NextResponse.json({ error: `${i + 1}. kural: ${hata}`, kuralNo: i + 1 }, { status: 400 })
  }

  const irsaliyeler = await siniflandirmaIrsaliyeleriniYukle(admin)
  const plan = siniflandirmaPlani(irsaliyeler, kurallar, kategoriler)
  const ornekler = plan.degisiklikler
    .filter((d) => d.etkinEski !== d.etkinYeni)
    .sort((a, b) => b.tutar - a.tutar)
    .slice(0, 50)
    .map((d) => ({ fis_no: d.fis_no, firma: d.firm_code, belge_no: d.belge_no_raw, eski: d.etkinEski, yeni: d.etkinYeni, tutar: d.tutar }))
  return NextResponse.json({ ok: true, ozet: plan.ozet, gecisler: plan.gecisler, ornekler, imza: plan.imza })
}
