import { NextResponse } from 'next/server'
import { apiSession } from '@/lib/auth'
import { chunkedWrite, fetchAll } from '@/lib/db'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { parseBayilerXlsx } from '@/lib/import/bayilerParser'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 403 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Dosya bulunamadı.' }, { status: 400 })
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'Dosya 5 MB sınırını aşıyor.' }, { status: 400 })

  let parsed
  try {
    parsed = parseBayilerXlsx(await file.arrayBuffer())
  } catch (e) {
    return NextResponse.json({ error: 'Dosya okunamadı: ' + (e instanceof Error ? e.message : String(e)) }, { status: 400 })
  }
  if (parsed.records.length === 0) {
    return NextResponse.json({ error: parsed.warnings.join(' ') || 'Bayi satırı bulunamadı.' }, { status: 400 })
  }

  const admin = createAdminSupabase()
  const existing = new Map<string, { name: string; segment: string | null; city: string | null; phone: string | null; pazarlamaci_email: string | null; borc_durumu: string | null }>()
  const codes = parsed.records.map((r) => r.codeNorm)
  for (let i = 0; i < codes.length; i += 200) {
    const chunk = codes.slice(i, i + 200)
    const rows = await fetchAll<{ code_norm: string; name: string; segment: string | null; city: string | null; phone: string | null; pazarlamaci_email: string | null; borc_durumu: string | null }>((from, to) =>
      admin
        .from('firms')
        .select('code_norm, name, segment, city, phone, pazarlamaci_email, borc_durumu')
        .in('code_norm', chunk)
        .order('code_norm')
        .range(from, to),
    )
    for (const row of rows) existing.set(row.code_norm, row)
  }

  const { data: batch, error: batchError } = await admin
    .from('import_batches')
    .insert({ kind: 'bayiler', filename: file.name, uploaded_by: session.email, status: 'preview' })
    .select('id')
    .single()
  if (batchError || !batch) return NextResponse.json({ error: 'Önizleme kaydedilemedi: ' + batchError?.message }, { status: 500 })

  const counts: Record<string, number> = {}
  const stagedRows: Record<string, unknown>[] = []
  for (const rec of parsed.records) {
    const ex = existing.get(rec.codeNorm)
    const changed: string[] = []
    if (ex) {
      if ((ex.name ?? '') !== rec.name) changed.push('ad')
      if ((ex.segment ?? '') !== rec.segment) changed.push('segment')
      if ((ex.city ?? '') !== rec.city) changed.push('sehir')
      if ((ex.phone ?? '') !== rec.phone) changed.push('telefon')
      if (((ex.pazarlamaci_email ?? '').toLowerCase()) !== rec.pazarlamaciEmail) changed.push('pazarlamaci')
      if ((ex.borc_durumu ?? '') !== rec.borcDurumu) changed.push('borc_durumu')
    }
    const status = !ex ? 'new' : changed.length > 0 ? 'updated' : 'unchanged'
    counts[status] = (counts[status] ?? 0) + 1
    stagedRows.push({
      batch_id: batch.id,
      row_index: rec.rowIndex,
      natural_key: rec.codeNorm,
      payload: rec,
      diff_status: status,
      changed_fields: changed,
    })
  }
  for (const inv of parsed.invalids) {
    counts.invalid = (counts.invalid ?? 0) + 1
    stagedRows.push({
      batch_id: batch.id,
      row_index: inv.rowIndex,
      natural_key: inv.preview,
      payload: { error: inv.error },
      diff_status: 'invalid',
      changed_fields: [],
      error: inv.error,
    })
  }

  await chunkedWrite(stagedRows, (chunk) => admin.from('import_rows').insert(chunk))
  await admin.from('import_batches').update({ stats: counts }).eq('id', batch.id)

  return NextResponse.json({
    batchId: batch.id,
    counts,
    total: parsed.records.length + parsed.invalids.length,
    warnings: parsed.warnings,
    samples: { invalid: parsed.invalids.slice(0, 20) },
  })
}
