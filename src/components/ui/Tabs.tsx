import Link from 'next/link'

export interface TabItem {
  href: string
  label: string
  aktif: boolean
  sayi?: number
}

/** Adres tabanlı sekmeler (?sekme=…): her sekme ayrı bağlantı. */
export default function Tabs({ items }: { items: TabItem[] }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={
            '-mb-px inline-flex items-center gap-2 rounded-t-lg border px-3 py-2 text-sm font-medium ' +
            (t.aktif ? 'border-slate-200 border-b-white bg-white text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900')
          }
        >
          {t.label}
          {t.sayi !== undefined && (
            <span className={'rounded-full px-1.5 text-xs ' + (t.aktif ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600')}>{t.sayi}</span>
          )}
        </Link>
      ))}
    </div>
  )
}
