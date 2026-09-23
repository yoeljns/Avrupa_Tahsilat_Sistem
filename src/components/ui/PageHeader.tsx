import type { ReactNode } from 'react'

/** Sayfa başlığı: başlık, açıklama, sağda eylemler. */
export default function PageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-slate-900">
          {icon && <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">{icon}</span>}
          {title}
        </h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
