import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase select'leri 1000 satırla sayfalanır; bu yardımcı tüm sayfaları toplar.
 * builder: her çağrıda YENİ bir sorgu üretmelidir (range eklenerek çalıştırılır).
 */
export async function fetchAll<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; ; page++) {
    const from = page * pageSize
    const { data, error } = await makeQuery(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < pageSize) break
  }
  return out
}

/** Büyük insert/upsert'leri parçalara bölerek gönderir. */
export async function chunkedWrite<T>(
  rows: T[],
  write: (chunk: T[]) => PromiseLike<{ error: { message: string } | null }>,
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await write(rows.slice(i, i + chunkSize))
    if (error) throw new Error(error.message)
  }
}

export interface AuditEntry {
  actorId?: string | null
  actorEmail: string
  entityType: string
  entityId: string
  action: string
  field?: string | null
  oldValue?: unknown
  newValue?: unknown
  reason?: string | null
}

/** Denetim kaydı ekler (salt-ekleme tablo; hata durumunda fırlatır). */
export async function writeAudit(admin: SupabaseClient, entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return
  await chunkedWrite(entries, (chunk) =>
    admin.from('audit_log').insert(
      chunk.map((e) => ({
        actor_id: e.actorId ?? null,
        actor_email: e.actorEmail,
        entity_type: e.entityType,
        entity_id: e.entityId,
        action: e.action,
        field: e.field ?? null,
        old_value: e.oldValue === undefined ? null : e.oldValue,
        new_value: e.newValue === undefined ? null : e.newValue,
        reason: e.reason ?? null,
      })),
    ),
  )
}
