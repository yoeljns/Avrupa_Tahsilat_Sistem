import Link from 'next/link'
import { Building2, TriangleAlert } from 'lucide-react'
import ImportPanel from '@/components/ImportPanel'
import Badge from '@/components/ui/Badge'
import Card, { CardTitle } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import { isAdminRole, requireRole } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { yonetimOzeti } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function BayilerPage() {
  const session = await requireRole(['yonetici', 'tahsilat_yoneticisi'])
  const supabase = await createServerSupabase()

  const [firms, ozet] = await Promise.all([
    fetchAll<{ pazarlamaci_email: string | null }>((from, to) => supabase.from('firms').select('pazarlamaci_email').order('id').range(from, to)),
    // Aktif kullanıcıyla eşleşmeyen sorumlu e-postaları (0007 yoksa bu kontrol atlanır)
    yonetimOzeti(supabase).catch(() => null),
  ])
  const eslesmeyen = ozet ? new Set(ozet.eslesmeyen_sorumlular) : null

  const byEmail = new Map<string, number>()
  let unassigned = 0
  for (const f of firms) {
    const e = f.pazarlamaci_email?.trim().toLowerCase()
    if (e) byEmail.set(e, (byEmail.get(e) ?? 0) + 1)
    else unassigned++
  }
  const satirlar = Array.from(byEmail.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const sorunlu = eslesmeyen ? satirlar.filter(([e]) => eslesmeyen.has(e)) : []

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Building2 className="h-5 w-5" />}
        title="Bayiler ve Sorumlular"
        description={
          <>
            Firma adları, şehirler ve <strong>pazarlamacı atamaları</strong> bu dosyadan gelir. Pazarlamacılar panelde yalnız kendilerine atanmış
            firmaları görür.
          </>
        }
      />

      <div className="max-w-2xl">
        <ImportPanel
          kind="bayiler"
          title="Bayi Listesi (.xlsx)"
          description="Sütunlar: logo_kodu, bayi_adi, segment, sehir, telefon, pazarlamaci_email. Kod eşleşen firmalar güncellenir, yeniler eklenir; hiçbir firma silinmez."
          accept=".xlsx,.xls"
        />
      </div>

      {sorunlu.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl bg-amber-50 px-5 py-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
          <p>
            <strong>{sorunlu.length} sorumlu e-postası</strong> ({sorunlu.reduce((t, [, n]) => t + n, 0)} firma) hiçbir aktif kullanıcıyla eşleşmiyor —
            bu firmaları şu an hiçbir pazarlamacı göremiyor.{' '}
            {isAdminRole(session.role) ? (
              <>
                <Link href="/yonetim/kullanicilar" className="font-semibold underline">
                  Kullanıcılar
                </Link>{' '}
                sayfasından bu e-postayla hesap açın ya da bayi listesindeki e-postayı düzeltip yeniden yükleyin.
              </>
            ) : (
              'Bir yöneticiden bu e-postayla hesap açmasını isteyin ya da bayi listesindeki e-postayı düzeltip yeniden yükleyin.'
            )}
          </p>
        </div>
      )}

      <Card padded={false} className="max-w-3xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <CardTitle sub={`${firms.length.toLocaleString('tr-TR')} firma, ${satirlar.length} sorumlu`}>Pazarlamacı dağılımı</CardTitle>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-5 py-2 font-medium">Sorumlu e-postası</th>
              <th className="px-3 py-2 font-medium">Kullanıcı</th>
              <th className="px-5 py-2 text-right font-medium">Firma</th>
            </tr>
          </thead>
          <tbody>
            {satirlar.map(([email, count]) => (
              <tr key={email} className="border-b border-slate-100">
                <td className="px-5 py-2">{email}</td>
                <td className="px-3 py-2">
                  {eslesmeyen === null ? (
                    <span className="text-xs text-slate-400">—</span>
                  ) : eslesmeyen.has(email) ? (
                    <Badge tone="amber">aktif kullanıcı yok</Badge>
                  ) : (
                    <Badge tone="green">eşleşti</Badge>
                  )}
                </td>
                <td className="px-5 py-2 text-right tabular-nums">{count}</td>
              </tr>
            ))}
            <tr>
              <td className="px-5 py-2 text-slate-500">Sorumlusu atanmamış</td>
              <td className="px-3 py-2">{unassigned > 0 ? <Badge tone="amber">yalnız yönetim görür</Badge> : null}</td>
              <td className="px-5 py-2 text-right tabular-nums text-slate-500">{unassigned}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  )
}
