import Link from 'next/link'
import MigrationNeeded, { isMissingRelationError } from '@/components/MigrationNeeded'
import MonthMatrix from '@/components/MonthMatrix'
import StatCard from '@/components/StatCard'
import { getSessionProfile, isStaffRole } from '@/lib/auth'
import { addMonths, eur, monthOf, todayISO, trMonth } from '@/lib/format'
import { matrisVerisi } from '@/lib/queries'
import type { MatrisSatiri } from '@/components/MonthMatrix'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Peşin borçlarda 'vade' = irsaliye tarihi; tablo aynı BORÇ/ÖDEME/KALAN
// matrisiyle, yaşlandırma şeridi eklenerek sunulur.

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}

export default async function PesinPage({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const session = (await getSessionProfile())!
  const staff = isStaffRole(session.role)
  const supabase = await createServerSupabase()
  const params = await searchParams
  const month = /^\d{4}-\d{2}$/.test(params.ay ?? '') ? params.ay! : monthOf(todayISO())

  // TEK ağ turu: koşu + taksitler + sorumlu eşlemesi
  let rows: MatrisSatiri[] = []
  let sorumlu = new Map<string, string>()
  try {
    const veri = await matrisVerisi(supabase, 'PESIN')
    rows = veri.rows
    sorumlu = veri.sorumlu
  } catch (e) {
    if (isMissingRelationError(e)) return <MigrationNeeded />
    throw e
  }

  const today = todayISO()
  const buckets = { b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 }
  for (const r of rows) {
    if (r.remaining_eur_cents <= 0) continue
    const age = daysBetween(r.due_date, today)
    if (age <= 30) buckets.b0_30 += r.remaining_eur_cents
    else if (age <= 60) buckets.b31_60 += r.remaining_eur_cents
    else if (age <= 90) buckets.b61_90 += r.remaining_eur_cents
    else buckets.b90p += r.remaining_eur_cents
  }
  const totalKalan = rows.reduce((s, r) => s + r.remaining_eur_cents, 0)
  const totalOdenen = rows.reduce((s, r) => s + r.paid_eur_cents, 0)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Peşin Borçlar</h1>
          <p className="mt-1 text-sm text-slate-500">
            İrsaliye tarihine göre — Ödenen:{' '}
            <strong className="tabular-nums text-emerald-600">{eur(totalOdenen)}</strong> · Kalan:{' '}
            <strong className="tabular-nums">{eur(totalKalan)}</strong>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {staff && (
            <a
              href="/api/export/borclar"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Excel İndir
            </a>
          )}
          <nav className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1 text-sm">
            <Link href={`/pesin?ay=${addMonths(month, -1)}`} prefetch className="rounded px-2 py-1 hover:bg-slate-100">
              ←
            </Link>
            <span className="px-2 font-medium">{trMonth(month)}</span>
            <Link href={`/pesin?ay=${addMonths(month, 1)}`} prefetch className="rounded px-2 py-1 hover:bg-slate-100">
              →
            </Link>
          </nav>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="0-30 Gün" value={eur(buckets.b0_30)} />
        <StatCard title="31-60 Gün" value={eur(buckets.b31_60)} tone={buckets.b31_60 > 0 ? 'amber' : 'default'} />
        <StatCard title="61-90 Gün" value={eur(buckets.b61_90)} tone={buckets.b61_90 > 0 ? 'amber' : 'default'} />
        <StatCard title="90+ Gün" value={eur(buckets.b90p)} tone={buckets.b90p > 0 ? 'red' : 'default'} />
      </div>

      <div className="mt-4">
        <MonthMatrix rows={rows} month={month} sorumluByFirm={sorumlu} />
      </div>
    </div>
  )
}
