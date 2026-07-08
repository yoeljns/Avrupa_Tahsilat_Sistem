import { NextResponse } from 'next/server'
import { apiSession } from '@/lib/auth'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { runRecompute } from '@/lib/recompute'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST() {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 403 })

  try {
    const stats = await runRecompute(createAdminSupabase(), 'manual', session.email)
    return NextResponse.json({ ok: true, stats })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Hesaplama başarısız.' }, { status: 500 })
  }
}
