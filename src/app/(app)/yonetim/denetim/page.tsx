import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { trDateTime } from '@/lib/format'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Denetim kaydı görüntüleyici — salt okunur; kayıtlar silinemez/değiştirilemez.

interface AuditRow {
  id: number
  actor_email: string | null
  entity_type: string
  entity_id: string
  action: string
  field: string | null
  old_value: unknown
  new_value: unknown
  reason: string | null
  created_at: string
}

const ENTITY_LABELS: Record<string, string> = {
  irsaliye: 'İrsaliye',
  odeme: 'Ödeme',
  kullanici: 'Kullanıcı',
  haric_firma: 'Takip Dışı Firma',
  ice_aktarim: 'İçe Aktarım',
  sistem: 'Sistem',
}

function short(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 80 ? s.slice(0, 77) + '…' : s
}

export default async function DenetimPage({
  searchParams,
}: {
  searchParams: Promise<{ tur?: string; ara?: string; sayfa?: string }>
}) {
  await requireRole(['yonetici', 'tahsilat_yoneticisi'])
  const supabase = await createServerSupabase()
  const params = await searchParams
  const tur = params.tur ?? ''
  const ara = (params.ara ?? '').trim()
  const page = Math.max(0, parseInt(params.sayfa ?? '0', 10) || 0)
  const PAGE_SIZE = 100

  let q = supabase
    .from('audit_log')
    .select('id, actor_email, entity_type, entity_id, action, field, old_value, new_value, reason, created_at')
    .order('id', { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
  if (tur) q = q.eq('entity_type', tur)
  if (ara) q = q.ilike('entity_id', `%${ara}%`)
  const { data } = await q
  const rows = (data ?? []) as AuditRow[]

  const qs = (p: number) =>
    `/yonetim/denetim?${new URLSearchParams({ ...(tur ? { tur } : {}), ...(ara ? { ara } : {}), sayfa: String(p) })}`

  return (
    <div>
      <h1 className="text-lg font-bold text-slate-900">Denetim Kaydı</h1>
      <p className="mt-1 text-sm text-slate-500">
        İrsaliye iptalleri, tutar/vade değişiklikleri, sınıflandırmalar, içe aktarmalar ve kullanıcı işlemleri —
        tümü kalıcı olarak burada saklanır.
      </p>

      <form className="mt-4 flex flex-wrap items-end gap-3" action="/yonetim/denetim" method="get">
        <div>
          <label className="block text-xs font-medium text-slate-500">Tür</label>
          <select name="tur" defaultValue={tur} className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">Tümü</option>
            {Object.entries(ENTITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">Kayıt No / Fiş No ara</label>
          <input name="ara" defaultValue={ara} className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          Filtrele
        </button>
      </form>

      <div className="mt-4 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Zaman</th>
              <th className="px-3 py-2">Kim</th>
              <th className="px-3 py-2">Tür</th>
              <th className="px-3 py-2">Kayıt</th>
              <th className="px-3 py-2">İşlem</th>
              <th className="px-3 py-2">Eski → Yeni</th>
              <th className="px-3 py-2">Sebep</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  Kayıt bulunamadı.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 align-top">
                <td className="px-3 py-2 whitespace-nowrap">{trDateTime(r.created_at)}</td>
                <td className="px-3 py-2">{r.actor_email ?? '—'}</td>
                <td className="px-3 py-2">{ENTITY_LABELS[r.entity_type] ?? r.entity_type}</td>
                <td className="px-3 py-2 font-medium">{r.entity_id}</td>
                <td className="px-3 py-2">
                  {r.action}
                  {r.field ? <span className="text-slate-400"> ({r.field})</span> : ''}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {short(r.old_value)} {r.old_value !== null || r.new_value !== null ? '→' : ''} {short(r.new_value)}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{r.reason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex gap-2 text-sm">
        {page > 0 && (
          <Link href={qs(page - 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
            ← Daha yeni
          </Link>
        )}
        {rows.length === PAGE_SIZE && (
          <Link href={qs(page + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
            Daha eski →
          </Link>
        )}
      </div>
    </div>
  )
}
