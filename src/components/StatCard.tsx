interface StatCardProps {
  title: string
  value: string
  sub?: string
  tone?: 'default' | 'red' | 'green' | 'amber'
}

const TONES: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'text-slate-900',
  red: 'text-red-600',
  green: 'text-emerald-600',
  amber: 'text-amber-600',
}

export default function StatCard({ title, value, sub, tone = 'default' }: StatCardProps) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${TONES[tone]}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}
