import type { SupabaseClient } from '@supabase/supabase-js'
import { writeAudit } from '@/lib/db'

// TÜM ödeme ve irsaliye verisini sıfırlar. YALNIZ yönetici (yy@) çağırabilir;
// yetki kontrolü route katmanındadır. Silinenler: irsaliyeler (+taksitler),
// ödemeler, mutabakat koşuları (+tahsisler, bakiyeler), içe aktarma geçmişi.
// KORUNANLAR: firmalar (bayi listesi + pazarlamacı eşleşmesi), kullanıcılar,
// takip dışı firma kodları ve denetim kaydı (sıfırlama da denetime işlenir).

export interface ResetSummary {
  invoices: number
  payments: number
  runs: number
  batches: number
}

async function countRows(admin: SupabaseClient, table: string): Promise<number> {
  const { count } = await admin.from(table).select('*', { count: 'exact', head: true })
  return count ?? 0
}

export async function resetAllData(admin: SupabaseClient, actorEmail: string): Promise<ResetSummary> {
  const summary: ResetSummary = {
    invoices: await countRows(admin, 'invoices'),
    payments: await countRows(admin, 'payments'),
    runs: await countRows(admin, 'recon_runs'),
    batches: await countRows(admin, 'import_batches'),
  }

  // Silme sırası FK zincirine göre: koşular (tahsis + bakiyeler cascade),
  // irsaliyeler (taksitler cascade), ödemeler, içe aktarma geçmişi.
  // PostgREST filtresiz delete kabul etmez; her zaman doğru olan bir filtre kullanılır.
  const steps: Array<{ table: string; column: string }> = [
    { table: 'recon_runs', column: 'started_at' },
    { table: 'invoices', column: 'created_at' },
    { table: 'payments', column: 'created_at' },
    { table: 'import_batches', column: 'created_at' },
  ]
  for (const step of steps) {
    const { error } = await admin.from(step.table).delete().gte(step.column, '1970-01-01')
    if (error) throw new Error(`${step.table} silinemedi: ${error.message}`)
  }

  // Mutabakat işaretçisini temizle → pano "henüz hesaplanmadı" durumuna döner
  const { error: ptrError } = await admin
    .from('app_settings')
    .upsert({ key: 'current_recon_run', value: {}, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (ptrError) throw new Error('Koşu işaretçisi temizlenemedi: ' + ptrError.message)

  await writeAudit(admin, [
    {
      actorEmail,
      entityType: 'sistem',
      entityId: 'veri_sifirlama',
      action: 'VERI_SIFIRLAMA',
      oldValue: summary as unknown as Record<string, number>,
      newValue: { irsaliye: 0, odeme: 0 },
      reason: 'Yönetici tüm ödeme ve irsaliye verisini sıfırladı',
    },
  ])

  return summary
}
