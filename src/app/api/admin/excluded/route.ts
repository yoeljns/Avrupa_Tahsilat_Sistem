import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession } from '@/lib/auth'
import { normalizeFirmCode } from '@/lib/engine/normalize'
import { writeAudit } from '@/lib/db'
import { runRecompute } from '@/lib/recompute'
import { createAdminSupabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 120

// Takip dışı (hariç) firma kodları listesi yönetimi.
// Liste değişince borç kapsamı değişir → mutabakat yeniden hesaplanır.

const Body = z.object({
  action: z.enum(['add', 'remove']),
  code: z.string().min(2).max(30),
  note: z.string().max(200).optional(),
})

export async function POST(request: Request) {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 403 })

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 })

  const admin = createAdminSupabase()
  const code = normalizeFirmCode(parsed.data.code)

  if (parsed.data.action === 'add') {
    const { error } = await admin
      .from('excluded_firm_codes')
      .upsert({ code_norm: code, note: parsed.data.note ?? null, added_by: session.email }, { onConflict: 'code_norm' })
    if (error) return NextResponse.json({ error: 'Eklenemedi: ' + error.message }, { status: 500 })
    await writeAudit(admin, [
      { actorEmail: session.email, entityType: 'haric_firma', entityId: code, action: 'HARIC_EKLEME', newValue: { note: parsed.data.note } },
    ])
  } else {
    const { error } = await admin.from('excluded_firm_codes').delete().eq('code_norm', code)
    if (error) return NextResponse.json({ error: 'Silinemedi: ' + error.message }, { status: 500 })
    await writeAudit(admin, [
      { actorEmail: session.email, entityType: 'haric_firma', entityId: code, action: 'HARIC_CIKARMA' },
    ])
  }

  const recompute = await runRecompute(admin, 'edit', session.email)
  return NextResponse.json({ ok: true, recompute: { runId: recompute.runId } })
}
