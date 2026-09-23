import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession, isSahip, SAHIP_EPOSTA } from '@/lib/auth'
import { resetAllData } from '@/lib/resetData'
import { createAdminSupabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 120

// TÜM ödeme + irsaliye verisini sıfırlama.
// YALNIZ sistemin sahibi (SAHIP_EPOSTA, yönetici) çalıştırabilir; onay metni zorunludur.

const Body = z.object({ confirm: z.string() })

export async function POST(request: Request) {
  const session = await apiSession(['yonetici'])
  if (!session || !isSahip(session.email)) {
    return NextResponse.json(
      { error: `Bu işlemi yalnız ${SAHIP_EPOSTA} yapabilir.` },
      { status: 403 },
    )
  }

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success || parsed.data.confirm !== 'SIFIRLA') {
    return NextResponse.json({ error: "Onay metni hatalı. Kutuya büyük harflerle 'SIFIRLA' yazın." }, { status: 400 })
  }

  try {
    const summary = await resetAllData(createAdminSupabase(), session.email)
    return NextResponse.json({ ok: true, summary })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Sıfırlama başarısız.' }, { status: 500 })
  }
}
