import Link from 'next/link'
import RecomputeButton from '@/components/RecomputeButton'
import StatCard from '@/components/StatCard'
import { getSessionProfile, isStaffRole } from '@/lib/auth'
import { fetchAll } from '@/lib/db'
import { eur, todayISO, trDateTime } from '@/lib/format'
import { balancesAtRun, currentRunId, openInstallments } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'
import { addDaysISO } from '@/lib/engine/dates'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = (await getSessionProfile())!
  const staff = isStaffRole(session.role)
  const supabase = await createServerSupabase()

  const runId = await currentRunId(supabase)

  if (!runId) {
    return (
      <div>
        <h1 className="text-lg font-bold text-slate-900">Pano</h1>
        <div className="mt-6 rounded-2xl bg-white p-8 text-center shadow-sm">
          <p className="text-slate-600">Henüz mutabakat hesaplanmadı.</p>
          {staff ? (
            <p className="mt-2 text-sm text-slate-500">
              Başlamak için{' '}
              <Link href="/ice-aktarim" className="font-medium text-blue-700 hover:underline">
                İçe Aktarım
              </Link>{' '}
              sayfasından irsaliye ve ödeme dosyalarını yükleyin.
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Veriler yüklendiğinde borç özetiniz burada görünecek.</p>
          )}
        </div>
      </div>
    )
  }

  const [balances, vadeli, runInfo] = await Promise.all([
    balancesAtRun(supabase, runId),
    openInstallments(supabase, 'VADELI'),
    supabase.from('recon_runs').select('started_at, triggered_by').eq('id', runId).maybeSingle(),
  ])

  const sum = (side: 'PESIN' | 'VADELI', f: 'open_debt_eur_cents' | 'overdue_eur_cents' | 'credit_eur_cents') =>
    balances.filter((b) => b.side === side).reduce((s, b) => s + b[f], 0)

  const today = todayISO()
  const in7 = addDaysISO(today, 7)
  const in30 = addDaysISO(today, 30)
  const upcoming7 = vadeli.filter((r) => r.due_date >= today && r.due_date <= in7).reduce((s, r) => s + r.remaining_eur_cents, 0)
  const upcoming30 = vadeli.filter((r) => r.due_date >= today && r.due_date <= in30).reduce((s, r) => s + r.remaining_eur_cents, 0)

  // İnceleme bekleyenler (staff kartı)
  let reviewCount = 0
  let reviewSum = 0
  if (staff) {
    const reviewRows = await fetchAll<{ amount_eur_cents: number | null }>((from, to) =>
      supabase
        .from('v_invoices_effective')
        .select('amount_eur_cents')
        .eq('needs_review', true)
        .eq('is_31_12', false)
        .eq('is_cancelled', false)
        .order('id')
        .range(from, to),
    )
    reviewCount = reviewRows.length
    reviewSum = reviewRows.reduce((s, r) => s + (r.amount_eur_cents ?? 0), 0)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-900">Pano</h1>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>
            Son mutabakat: {trDateTime(runInfo.data?.started_at)} ({runInfo.data?.triggered_by ?? '—'})
          </span>
          {staff && <RecomputeButton />}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Konsinye Açık Borç" value={eur(sum('VADELI', 'open_debt_eur_cents'))} sub="Konsinye + Konsinye Peşin" />
        <StatCard title="Peşin Açık Borç" value={eur(sum('PESIN', 'open_debt_eur_cents'))} />
        <StatCard
          title="Vadesi Geçmiş (Konsinye)"
          value={eur(sum('VADELI', 'overdue_eur_cents'))}
          tone={sum('VADELI', 'overdue_eur_cents') > 0 ? 'red' : 'default'}
        />
        <StatCard
          title="Alacak Bakiyesi"
          value={eur(sum('PESIN', 'credit_eur_cents') + sum('VADELI', 'credit_eur_cents'))}
          sub={`Peşin ${eur(sum('PESIN', 'credit_eur_cents'))} · Vadeli ${eur(sum('VADELI', 'credit_eur_cents'))}`}
          tone="green"
        />
        <StatCard title="7 Gün İçinde Vadesi Gelen" value={eur(upcoming7)} tone={upcoming7 > 0 ? 'amber' : 'default'} />
        <StatCard title="30 Gün İçinde Vadesi Gelen" value={eur(upcoming30)} />
        {staff && (
          <Link href="/inceleme" className="block">
            <StatCard
              title="İnceleme Bekleyen İrsaliye"
              value={String(reviewCount)}
              sub={reviewCount > 0 ? `${eur(reviewSum)} — sınıflandırma/plan onayı bekliyor` : 'Bekleyen yok'}
              tone={reviewCount > 0 ? 'amber' : 'default'}
            />
          </Link>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Link href="/konsinye" className="rounded-2xl bg-white p-5 shadow-sm hover:bg-blue-50/40">
          <h2 className="font-semibold text-slate-900">Konsinye / Konsinye Peşin Takvimi →</h2>
          <p className="mt-1 text-sm text-slate-500">Firma bazında vade takvimi, gecikmişler ve ay toplamları</p>
        </Link>
        <Link href="/pesin" className="rounded-2xl bg-white p-5 shadow-sm hover:bg-blue-50/40">
          <h2 className="font-semibold text-slate-900">Peşin Borç Tablosu →</h2>
          <p className="mt-1 text-sm text-slate-500">İrsaliye tarihine göre bekleyen peşin ödemeler ve yaşlandırma</p>
        </Link>
      </div>
    </div>
  )
}
