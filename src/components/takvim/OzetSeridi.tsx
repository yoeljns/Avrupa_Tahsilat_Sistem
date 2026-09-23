export interface OzetOgesi {
  baslik: string
  deger: string
  alt?: string
  ton?: 'normal' | 'kirmizi' | 'amber' | 'yesil'
}

const TON: Record<NonNullable<OzetOgesi['ton']>, string> = {
  normal: 'text-slate-900',
  kirmizi: 'text-red-600',
  amber: 'text-amber-600',
  yesil: 'text-emerald-600',
}

/** Takvim sayfasının üstündeki kısa özet: kapsamı başlığında yazılı küçük kutular. */
export default function OzetSeridi({ ogeler }: { ogeler: OzetOgesi[] }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {ogeler.map((o) => (
        <div key={o.baslik} className="rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/70">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{o.baslik}</p>
          <p className={'mt-1 whitespace-nowrap text-base font-bold tabular-nums sm:text-lg ' + TON[o.ton ?? 'normal']}>{o.deger}</p>
          {o.alt && <p className="text-xs text-slate-500">{o.alt}</p>}
        </div>
      ))}
    </div>
  )
}
