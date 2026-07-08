import Link from 'next/link'
import MigrationNeeded, { isMissingRelationError } from '@/components/MigrationNeeded'
import MonthMatrix from '@/components/MonthMatrix'
import { getSessionProfile, isStaffRole } from '@/lib/auth'
import { addMonths, eur, monthOf, todayISO, trMonth } from '@/lib/format'
import { currentRunId, pazarlamaciByFirm, scopeInstallments } from '@/lib/queries'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function KonsinyePage({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const session = (await getSessionProfile())!
  const staff = isStaffRole(session.role)
  const supabase = await createServerSupabase()
  const params = await searchParams
  const month = /^\d{4}-\d{2}$/.test(params.ay ?? '') ? params.ay! : monthOf(todayISO())

  const runId = await currentRunId(supabase)
  let rows: Awaited<ReturnType<typeof scopeInstallments>> = []
  let sorumlu = new Map<string, string>()
  try {
    if (runId) [rows, sorumlu] = await Promise.all([scopeInstallments(supabase, 'VADELI'), pazarlamaciByFirm(supabase)])
  } catch (e) {
    if (isMissingRelationError(e)) return <MigrationNeeded />
    throw e
  }

  const today = todayISO()
  const totalKalan = rows.reduce((s, r) => s + r.remaining_eur_cents, 0)
  const totalOdenen = rows.reduce((s, r) => s + r.paid_eur_cents, 0)
  const overdue = rows.filter((r) => r.due_date < today).reduce((s, r) => s + r.remaining_eur_cents, 0)
  const noDateCount = rows.filter((r) => r.no_date_flag && r.remaining_eur_cents > 0).length

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Konsinye / Konsinye Peşin</h1>
          <p className="mt-1 text-sm text-slate-500">
            Ödenen: <strong className="tabular-nums text-emerald-600">{eur(totalOdenen)}</strong>
            {' '}· Kalan borç: <strong className="tabular-nums">{eur(totalKalan)}</strong>
            {overdue > 0 && (
              <>
                {' '}· vadesi geçmiş: <strong className="tabular-nums text-red-600">{eur(overdue)}</strong>
              </>
            )}
            {noDateCount > 0 && (
              <span className="ml-2 text-amber-600" title="Vade tarihi girilmemiş taksitler irsaliye tarihiyle listelenir">
                † {noDateCount} taksitte tarih girilmedi
              </span>
            )}
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
            <Link href={`/konsinye?ay=${addMonths(month, -1)}`} className="rounded px-2 py-1 hover:bg-slate-100">
              ←
            </Link>
            <span className="px-2 font-medium">{trMonth(month)}</span>
            <Link href={`/konsinye?ay=${addMonths(month, 1)}`} className="rounded px-2 py-1 hover:bg-slate-100">
              →
            </Link>
          </nav>
        </div>
      </div>

      <div className="mt-4">
        <MonthMatrix rows={rows} month={month} sorumluByFirm={sorumlu} />
      </div>
    </div>
  )
}
