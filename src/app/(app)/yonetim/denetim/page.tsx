import Link from 'next/link'
import { ArrowRight, History } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import { buttonClass } from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Field'
import PageHeader from '@/components/ui/PageHeader'
import { requireRole } from '@/lib/auth'
import { ISLEM_ETIKETLERI, KAYIT_TURU_ETIKETLERI, degisiklikSatirlari, islemEtiketi, kayitYazisi } from '@/lib/denetimEtiketleri'
import { trDateTime } from '@/lib/format'
import { kategorileriYukle } from '@/lib/kategoriler'
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

const SAYFA_BOYU = 100
const TARIH = /^\d{4}-\d{2}-\d{2}$/

function gunSonrasi(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export default async function DenetimPage({
  searchParams,
}: {
  searchParams: Promise<{ tur?: string; islem?: string; kim?: string; bas?: string; son?: string; ara?: string; sayfa?: string }>
}) {
  await requireRole(['yonetici', 'tahsilat_yoneticisi'])
  const supabase = await createServerSupabase()
  const p = await searchParams
  const tur = p.tur && p.tur in KAYIT_TURU_ETIKETLERI ? p.tur : ''
  const islem = p.islem && /^[A-Z_]{2,40}$/.test(p.islem) ? p.islem : ''
  const kim = (p.kim ?? '').trim().slice(0, 100)
  const bas = p.bas && TARIH.test(p.bas) ? p.bas : ''
  const son = p.son && TARIH.test(p.son) ? p.son : ''
  const ara = (p.ara ?? '').trim().slice(0, 60)
  const sayfa = Math.max(0, parseInt(p.sayfa ?? '0', 10) || 0)

  // Tarihler Türkiye saatine göre (UTC+3)
  let q = supabase
    .from('audit_log')
    .select('id, actor_email, entity_type, entity_id, action, field, old_value, new_value, reason, created_at', { count: 'exact' })
    .order('id', { ascending: false })
    .range(sayfa * SAYFA_BOYU, sayfa * SAYFA_BOYU + SAYFA_BOYU - 1)
  if (tur) q = q.eq('entity_type', tur)
  if (islem) q = q.eq('action', islem)
  if (kim) q = q.ilike('actor_email', `%${kim}%`)
  if (bas) q = q.gte('created_at', `${bas}T00:00:00+03:00`)
  if (son) q = q.lt('created_at', `${gunSonrasi(son)}T00:00:00+03:00`)
  if (ara) q = q.ilike('entity_id', `%${ara}%`)

  const [{ data, count, error }, kategoriler] = await Promise.all([q, kategorileriYukle(supabase).catch(() => undefined)])
  if (error) throw new Error('Denetim kaydı okunamadı: ' + error.message)
  const rows = (data ?? []) as AuditRow[]
  const toplam = count ?? rows.length
  const suzgecVar = !!(tur || islem || kim || bas || son || ara)

  const qs = (s: number) =>
    `/yonetim/denetim?${new URLSearchParams({
      ...(tur ? { tur } : {}),
      ...(islem ? { islem } : {}),
      ...(kim ? { kim } : {}),
      ...(bas ? { bas } : {}),
      ...(son ? { son } : {}),
      ...(ara ? { ara } : {}),
      sayfa: String(s),
    })}`

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<History className="h-5 w-5" />}
        title="Denetim Kaydı"
        description="İrsaliye düzeltmeleri, sınıflandırmalar, içe aktarmalar, kategori ve kural değişiklikleri, kullanıcı işlemleri — hepsi kalıcı olarak burada. Kayıtlar silinemez ve değiştirilemez."
      />

      <Card>
        <form className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" action="/yonetim/denetim" method="get">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Kayıt türü</span>
            <Select name="tur" defaultValue={tur} boyut="sm" className="mt-1">
              <option value="">Tümü</option>
              {Object.entries(KAYIT_TURU_ETIKETLERI).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">İşlem</span>
            <Select name="islem" defaultValue={islem} boyut="sm" className="mt-1">
              <option value="">Tümü</option>
              {Object.entries(ISLEM_ETIKETLERI)
                .sort((a, b) => a[1].ad.localeCompare(b[1].ad, 'tr'))
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.ad}
                  </option>
                ))}
            </Select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Kim</span>
            <Input name="kim" defaultValue={kim} boyut="sm" className="mt-1" placeholder="e-posta" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Başlangıç</span>
            <Input type="date" name="bas" defaultValue={bas} boyut="sm" className="mt-1" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Bitiş</span>
            <Input type="date" name="son" defaultValue={son} boyut="sm" className="mt-1" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Kayıt / Fiş No</span>
            <Input name="ara" defaultValue={ara} boyut="sm" className="mt-1" />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass('primary', 'md', 'flex-1')}>
              Süz
            </button>
            {suzgecVar && (
              <Link href="/yonetim/denetim" className={buttonClass('ghost', 'md')}>
                Temizle
              </Link>
            )}
          </div>
        </form>
      </Card>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3 text-sm">
          <p className="text-slate-600">
            <strong className="text-slate-900">{toplam.toLocaleString('tr-TR')}</strong> kayıt{suzgecVar ? ' (süzgeçli)' : ''}
            {toplam > SAYFA_BOYU && (
              <span className="text-slate-400">
                {' '}
                · {sayfa * SAYFA_BOYU + 1}–{Math.min(toplam, (sayfa + 1) * SAYFA_BOYU)} gösteriliyor
              </span>
            )}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] table-fixed text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                <th className="w-48 px-5 py-2 font-medium">Zaman / kim</th>
                <th className="w-64 px-3 py-2 font-medium">İşlem / kayıt</th>
                <th className="px-3 py-2 font-medium">Değişiklik</th>
                <th className="w-72 px-5 py-2 font-medium">Sebep / not</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-slate-400">
                    Kayıt bulunamadı.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const i = islemEtiketi(r.action)
                const kayit = kayitYazisi(r.entity_type, r.entity_id)
                const satirlar = degisiklikSatirlari(r.field, r.old_value, r.new_value, kategoriler)
                return (
                  <tr key={r.id} className="border-b border-slate-100 align-top">
                    <td className="px-5 py-2.5">
                      <span className="block whitespace-nowrap text-slate-700 tabular-nums">{trDateTime(r.created_at)}</span>
                      <span className="block truncate text-xs text-slate-500" title={r.actor_email ?? undefined}>
                        {r.actor_email ?? 'sistem'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={i.ton}>{i.ad}</Badge>
                      <span className="mt-1 block text-xs text-slate-500">
                        {kayit.tur}
                        {kayit.kimlik && <span className="ml-1 font-medium text-slate-800">{kayit.kimlik}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {satirlar.length === 0 ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {satirlar.map((s, k) => (
                            <li key={k} className="flex flex-wrap items-center gap-1 text-slate-600">
                              {s.alan && <span className="text-slate-400">{s.alan}:</span>}
                              {s.eski && <span className="text-slate-500 line-through decoration-slate-300">{s.eski}</span>}
                              {s.eski && s.yeni && <ArrowRight className="h-3 w-3 text-slate-400" aria-hidden="true" />}
                              {s.yeni && <span className="font-medium text-slate-800">{s.yeni}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-slate-500">{r.reason ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex gap-2 text-sm">
        {sayfa > 0 && (
          <Link href={qs(sayfa - 1)} className={buttonClass('secondary', 'sm')}>
            ← Daha yeni
          </Link>
        )}
        {(sayfa + 1) * SAYFA_BOYU < toplam && (
          <Link href={qs(sayfa + 1)} className={buttonClass('secondary', 'sm')}>
            Daha eski →
          </Link>
        )}
      </div>
    </div>
  )
}
