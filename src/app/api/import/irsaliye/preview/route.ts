import { NextResponse } from 'next/server'
import { apiSession } from '@/lib/auth'
import { chunkedWrite } from '@/lib/db'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { diffIrsaliye } from '@/lib/import/diff'
import { parseIrsaliyeXls } from '@/lib/import/irsaliyeParser'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_FILE_BYTES = 15 * 1024 * 1024

export async function POST(request: Request) {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 403 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Dosya bulunamadı. Lütfen .xls dosyasını seçin.' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'Dosya 15 MB sınırını aşıyor.' }, { status: 400 })
  }

  let parsed
  try {
    parsed = parseIrsaliyeXls(await file.arrayBuffer())
  } catch (e) {
    return NextResponse.json(
      { error: 'Dosya okunamadı. Geçerli bir Excel (.xls/.xlsx) olduğundan emin olun. Detay: ' + (e instanceof Error ? e.message : String(e)) },
      { status: 400 },
    )
  }
  if (parsed.records.length === 0) {
    return NextResponse.json({ error: parsed.warnings.join(' ') || 'Dosyada irsaliye satırı bulunamadı.' }, { status: 400 })
  }

  const admin = createAdminSupabase()
  const { rows } = await diffIrsaliye(admin, parsed.records)

  const { data: batch, error: batchError } = await admin
    .from('import_batches')
    .insert({ kind: 'irsaliye', filename: file.name, uploaded_by: session.email, status: 'preview' })
    .select('id')
    .single()
  if (batchError || !batch) {
    return NextResponse.json({ error: 'Önizleme kaydedilemedi: ' + batchError?.message }, { status: 500 })
  }

  const stagedRows = [
    ...rows.map((r) => ({
      batch_id: batch.id,
      row_index: r.rowIndex,
      natural_key: r.naturalKey,
      payload: r.payload,
      diff_status: r.status,
      changed_fields: r.changedFields,
    })),
    ...parsed.invalids.map((r) => ({
      batch_id: batch.id,
      row_index: r.rowIndex,
      natural_key: r.preview,
      payload: { error: r.error },
      diff_status: 'invalid' as const,
      changed_fields: [],
      error: r.error,
    })),
  ]
  try {
    await chunkedWrite(stagedRows, (chunk) => admin.from('import_rows').insert(chunk))
  } catch (e) {
    return NextResponse.json({ error: 'Önizleme satırları kaydedilemedi: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 })
  }

  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
  if (parsed.invalids.length > 0) counts.invalid = parsed.invalids.length

  const samples = {
    updated: rows.filter((r) => r.status === 'updated').slice(0, 20).map((r) => ({ key: r.naturalKey, fields: r.changedFields })),
    needs_review: rows.filter((r) => r.status === 'needs_review').slice(0, 20).map((r) => r.naturalKey),
    invalid: parsed.invalids.slice(0, 20),
  }

  await admin.from('import_batches').update({ stats: counts }).eq('id', batch.id)

  return NextResponse.json({
    batchId: batch.id,
    counts,
    total: rows.length + parsed.invalids.length,
    warnings: parsed.warnings,
    samples,
  })
}
