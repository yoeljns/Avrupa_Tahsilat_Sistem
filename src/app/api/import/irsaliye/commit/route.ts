import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession } from '@/lib/auth'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { commitIrsaliyeBatch } from '@/lib/import/commitIrsaliye'

export const runtime = 'nodejs'
export const maxDuration = 120

const Body = z.object({ batchId: z.string().uuid() })

export async function POST(request: Request) {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 403 })

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 })

  const admin = createAdminSupabase()
  try {
    const stats = await commitIrsaliyeBatch(admin, parsed.data.batchId, session.email)
    return NextResponse.json({ ok: true, stats })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'İçe aktarma başarısız.' }, { status: 500 })
  }
}
