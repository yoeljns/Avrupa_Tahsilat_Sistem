import type { ReactNode } from 'react'

/** Beyaz, yuvarlak köşeli, hafif gölgeli kutu. */
export default function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return <div className={'rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 ' + (padded ? 'p-5 ' : '') + className}>{children}</div>
}

/** Kutu başlığı: ikon + başlık + (isteğe bağlı) sağda eylem. */
export function CardTitle({ icon, children, action, sub }: { icon?: ReactNode; children: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          {icon && <span className="text-slate-400">{icon}</span>}
          {children}
        </h2>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </div>
      {action && <div className="shrink-0 whitespace-nowrap">{action}</div>}
    </div>
  )
}
