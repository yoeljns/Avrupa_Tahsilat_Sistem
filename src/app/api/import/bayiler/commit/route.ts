import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiSession } from '@/lib/auth'
import { chunkedWrite, fetchAll, writeAudit } from '@/lib/db'
import { createAdminSupabase } from '@/lib/supabase/admin'
import type { BayiRecord } from '@/lib/import/bayilerParser'

export const runtime = 'nodejs'
export const maxDuration = 60

const Body = z.object({ batchId: z.string().uuid() })

export async function POST(request: Request) {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 403 })

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 })

  const admin = createAdminSupabase()
  const { data: batch } = await admin.from('import_batches').select('id, kind, status').eq('id', parsed.data.batchId).maybeSingle()
  if (!batch) return NextResponse.json({ error: 'İçe aktarma kaydı bulunamadı.' }, { status: 404 })
  if (batch.kind !== 'bayiler') return NextResponse.json({ error: 'Bu kayıt bir bayi içe aktarımı değil.' }, { status: 400 })
  if (batch.status !== 'preview') return NextResponse.json({ error: 'Bu içe aktarma zaten uygulanmış.' }, { status: 409 })

  const stagedRows = await fetchAll<{ payload: BayiRecord; diff_status: string }>((from, to) =>
    admin.from('import_rows').select('payload, diff_status').eq('batch_id', batch.id).order('row_index').range(from, to),
  )
  const records = stagedRows.filter((r) => r.diff_status !== 'invalid').map((r) => r.payload)
  if (records.length === 0) return NextResponse.json({ error: 'Uygulanacak geçerli satır yok.' }, { status: 400 })

  const now = new Date().toISOString()
  try {
    await chunkedWrite(records, (chunk) =>
      admin.from('firms').upsert(
        chunk.map((r) => ({
          code_norm: r.codeNorm,
          code_raw: r.codeRaw,
          name: r.name,
          segment: r.segment || null,
          borc_durumu: r.borcDurumu || null,
          city: r.city || null,
          phone: r.phone || null,
          pazarlamaci_email: r.pazarlamaciEmail || null,
          is_auto_created: false,
          updated_at: now,
        })),
        { onConflict: 'code_norm' },
      ),
    )
  } catch (e) {
    return NextResponse.json({ error: 'Firmalar yazılamadı: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 })
  }

  const inserted = stagedRows.filter((r) => r.diff_status === 'new').length
  const updated = stagedRows.filter((r) => r.diff_status === 'updated').length
  const unchanged = stagedRows.filter((r) => r.diff_status === 'unchanged').length

  await writeAudit(admin, [
    {
      actorEmail: session.email,
      entityType: 'ice_aktarim',
      entityId: batch.id,
      action: 'BAYI_AKTARIMI',
      newValue: { yeni: inserted, guncellenen: updated, degismeyen: unchanged },
    },
  ])
  await admin
    .from('import_batches')
    .update({ status: 'committed', committed_at: now, stats: { inserted, updated, unchanged } })
    .eq('id', batch.id)

  return NextResponse.json({ ok: true, stats: { inserted, updated, unchanged } })
}
