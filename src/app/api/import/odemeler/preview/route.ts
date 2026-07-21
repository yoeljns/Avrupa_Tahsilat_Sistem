import { NextResponse } from 'next/server'
import { apiSession } from '@/lib/auth'
import { chunkedWrite } from '@/lib/db'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { fetchExistingPayments, odemeChangedFields, resolveFirmsByName } from '@/lib/import/commitOdemeler'
import { parseOdemelerXlsx } from '@/lib/import/odemelerParser'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_FILE_BYTES = 25 * 1024 * 1024

export async function POST(request: Request) {
  const session = await apiSession(['yonetici', 'tahsilat_yoneticisi'])
  if (!session) return NextResponse.json({ error: 'Bu işlem için yetkiniz yok.' }, { status: 403 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Dosya bulunamadı. Lütfen .xlsx dosyasını seçin.' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'Dosya 25 MB sınırını aşıyor.' }, { status: 400 })
  }

  let parsed
  try {
    parsed = parseOdemelerXlsx(await file.arrayBuffer())
  } catch (e) {
    return NextResponse.json(
      { error: 'Dosya okunamadı. Detay: ' + (e instanceof Error ? e.message : String(e)) },
      { status: 400 },
    )
  }
  if (parsed.records.length === 0) {
    return NextResponse.json({ error: parsed.warnings.join(' ') || 'Dosyada ödeme satırı bulunamadı.' }, { status: 400 })
  }

  const admin = createAdminSupabase()

  // İnce biçim (FİRMA KODU'suz) yedeklerde firmalar addan çözülür;
  // çözülemeyenler geçersiz satır olarak listelenir, diğerleri normal akışta ilerler.
  const slimCount = parsed.records.filter((r) => !r.hasKodu).length
  const { resolvedByName, unresolved } = await resolveFirmsByName(admin, parsed.records)
  if (unresolved.length > 0) {
    const unresolvedSet = new Set(unresolved.map((u) => u.islemKodu))
    for (const u of unresolved) {
      parsed.invalids.push({
        rowIndex: u.rowIndex,
        sheet: u.sheet,
        error: `Firma adı eşleşmedi: "${u.firmaRaw}" (${u.reason})`,
        preview: u.islemKodu,
      })
    }
    parsed.records = parsed.records.filter((r) => !unresolvedSet.has(r.islemKodu))
  }

  const existing = await fetchExistingPayments(
    admin,
    parsed.records.map((r) => r.islemKodu),
  )

  const { data: batch, error: batchError } = await admin
    .from('import_batches')
    .insert({ kind: 'odemeler', filename: file.name, uploaded_by: session.email, status: 'preview' })
    .select('id')
    .single()
  if (batchError || !batch) {
    return NextResponse.json({ error: 'Önizleme kaydedilemedi: ' + batchError?.message }, { status: 500 })
  }

  const counts: Record<string, number> = {}
  const stagedRows: Record<string, unknown>[] = []
  const updatedSamples: Array<{ key: string; fields: string[] }> = []

  for (const rec of parsed.records) {
    const ex = existing.get(rec.islemKodu)
    const changed = ex ? odemeChangedFields(rec, ex) : []
    const status = !ex ? 'new' : changed.length > 0 ? 'updated' : 'unchanged'
    counts[status] = (counts[status] ?? 0) + 1
    if (status === 'updated' && updatedSamples.length < 20) updatedSamples.push({ key: rec.islemKodu, fields: changed })
    stagedRows.push({
      batch_id: batch.id,
      row_index: rec.rowIndex,
      natural_key: rec.islemKodu,
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
      payload: { error: inv.error, sheet: inv.sheet },
      diff_status: 'invalid',
      changed_fields: [],
      error: inv.error,
    })
  }

  try {
    await chunkedWrite(stagedRows, (chunk) => admin.from('import_rows').insert(chunk))
  } catch (e) {
    return NextResponse.json({ error: 'Önizleme satırları kaydedilemedi: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 })
  }

  await admin.from('import_batches').update({ stats: counts }).eq('id', batch.id)

  const alcCount = parsed.records.filter((r) => r.isAlc).length
  const incompleteCount = parsed.records.filter((r) => !r.isComplete).length
  const kdvCount = parsed.records.filter((r) => r.isKdv).length

  return NextResponse.json({
    batchId: batch.id,
    counts,
    total: parsed.records.length + parsed.invalids.length,
    warnings: [
      ...parsed.warnings,
      ...(slimCount > 0
        ? [
            `Dosyada FİRMA KODU kolonu yok (ince biçim yedek): firmalar ad üzerinden eşleştirildi (${resolvedByName} yeni kayıt adla çözüldü${unresolved.length > 0 ? `, ${unresolved.length} tanesi eşleşmedi` : ''}). Mevcut kayıtların AÇIKLAMA/KDV/DURUM alanları korunacak.`,
          ]
        : []),
      ...(alcCount > 0 ? [`${alcCount} ALC (alacak) kaydı bilgi olarak saklanacak, tahsise girmeyecek.`] : []),
      ...(incompleteCount > 0 ? [`${incompleteCount} kayıt TAMAMLANMAMIŞ durumda — tahsise girmeyecek.`] : []),
      ...(kdvCount > 0
        ? [`${kdvCount} KDV 1/5 ödemesi, referansındaki (son 4 hane) irsaliyeden düşülecek; referansı çözülemeyenler tahsise girmez.`]
        : []),
    ],
    samples: { updated: updatedSamples, invalid: parsed.invalids.slice(0, 20) },
  })
}
