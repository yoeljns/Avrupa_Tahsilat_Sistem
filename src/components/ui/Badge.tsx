import type { ReactNode } from 'react'

export type BadgeTone = 'gray' | 'blue' | 'green' | 'red' | 'amber' | 'violet' | 'indigo'

const TONE: Record<BadgeTone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
}

/** Küçük durum rozeti. */
export default function Badge({ tone = 'gray', children, className = '', title }: { tone?: BadgeTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap ' + TONE[tone] + ' ' + className}>
      {children}
    </span>
  )
}
