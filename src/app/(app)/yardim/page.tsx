import type { ReactNode } from 'react'
import { BookOpen } from 'lucide-react'
import IndirDugmesi from '@/components/ui/IndirDugmesi'
import PageHeader from '@/components/ui/PageHeader'
import { requireUser } from '@/lib/auth'
import { trDate } from '@/lib/format'
import { kalinParcala, type Blok, type KutuTonu } from '@/lib/yardim/bloklar'
import { PROSEDUR } from '@/lib/yardim/icerik'

// YARDIM — İş Akış Prosedürü. İçerik src/lib/yardim/icerik.ts'ten gelir; aynı
// içerik PDF olarak da indirilir (/api/rapor/prosedur). Sayfa veri okumaz.

const KUTU: Record<KutuTonu, { sinif: string; ad: string }> = {
  bilgi: { sinif: 'bg-blue-50 text-blue-950 ring-blue-200', ad: 'Bilgi' },
  uyari: { sinif: 'bg-amber-50 text-amber-950 ring-amber-200', ad: 'Dikkat' },
  ornek: { sinif: 'bg-slate-50 text-slate-900 ring-slate-200', ad: 'Örnek' },
}

function Metin({ children }: { children: string }): ReactNode {
  return kalinParcala(children).map((p, i) =>
    p.kalin ? (
      <strong key={i} className="font-semibold text-slate-900">
        {p.metin}
      </strong>
    ) : (
      <span key={i}>{p.metin}</span>
    ),
  )
}

function BlokGorunumu({ blok }: { blok: Blok }) {
  switch (blok.tur) {
    case 'paragraf':
      return (
        <p className="mt-3 leading-relaxed text-slate-700">
          <Metin>{blok.metin}</Metin>
        </p>
      )
    case 'altbaslik':
      return <h3 className="mt-6 text-base font-semibold text-slate-900">{blok.metin}</h3>
    case 'adimlar':
      return (
        <ol className="mt-3 list-decimal space-y-1.5 pl-6 leading-relaxed text-slate-700 marker:font-semibold marker:text-slate-500">
          {blok.ogeler.map((o, i) => (
            <li key={i}>
              <Metin>{o}</Metin>
            </li>
          ))}
        </ol>
      )
    case 'liste':
      return (
        <ul className="mt-3 list-disc space-y-1.5 pl-6 leading-relaxed text-slate-700 marker:text-slate-400">
          {blok.ogeler.map((o, i) => (
            <li key={i}>
              <Metin>{o}</Metin>
            </li>
          ))}
        </ul>
      )
    case 'tablo': {
      const toplam = (blok.genislikler ?? blok.basliklar.map(() => 1)).reduce((t, g) => t + g, 0)
      return (
        <div className="mt-3 overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <table className="w-full min-w-[36rem] text-sm">
            <colgroup>
              {blok.basliklar.map((_, i) => (
                <col key={i} style={{ width: `${(((blok.genislikler?.[i] ?? 1) / toplam) * 100).toFixed(2)}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                {blok.basliklar.map((b, i) => (
                  <th key={i} scope="col" className="border-b border-slate-200 px-3 py-2 font-semibold">
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {blok.satirlar.map((r, i) => (
                <tr key={i} className="align-top">
                  {r.map((h, j) => (
                    <td key={j} className="border-b border-slate-100 px-3 py-2 leading-relaxed text-slate-700">
                      <Metin>{h}</Metin>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'kutu': {
      const k = KUTU[blok.ton]
      return (
        <div className={'mt-4 rounded-xl px-4 py-3 text-sm ring-1 ' + k.sinif}>
          <p className="font-semibold">{blok.baslik ?? k.ad}</p>
          {blok.satirlar.map((s, i) => (
            <p key={i} className="mt-1 leading-relaxed">
              <Metin>{s}</Metin>
            </p>
          ))}
        </div>
      )
    }
  }
}

export default async function YardimPage() {
  await requireUser()
  const p = PROSEDUR
  return (
    <div>
      <PageHeader
        icon={<BookOpen className="h-5 w-5" />}
        title={p.baslik}
        description={`${p.altBaslik} · Güncelleme: ${trDate(p.guncelleme)}`}
        actions={
          <IndirDugmesi url="/api/rapor/prosedur" yedekAd="is_akis_proseduru.pdf" variant="primary" size="md">
            PDF indir
          </IndirDugmesi>
        }
      />

      <div className="mt-6 gap-8 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="İçindekiler" className="mb-6 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200/70 lg:sticky lg:top-20 lg:mb-0 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-auto print:hidden">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">İçindekiler</p>
          <ol className="mt-2 space-y-1">
            {p.bolumler.map((b, i) => (
              <li key={b.id}>
                <a href={`#${b.id}`} className="block rounded-lg px-2 py-1 text-slate-700 hover:bg-slate-100 hover:text-slate-900">
                  <span className="text-slate-400">{i + 1}.</span> {b.baslik}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="min-w-0 max-w-3xl">
          {p.bolumler.map((b, i) => (
            <section key={b.id} id={b.id} className={'scroll-mt-20 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70 print:shadow-none print:ring-0' + (i > 0 ? ' mt-5' : '')}>
              <h2 className="text-lg font-bold text-slate-900">
                <span className="text-blue-600">{i + 1}.</span> {b.baslik}
              </h2>
              {b.ozet && <p className="mt-1 text-sm text-slate-500 italic">{b.ozet}</p>}
              {b.bloklar.map((blok, j) => (
                <BlokGorunumu key={j} blok={blok} />
              ))}
            </section>
          ))}
        </article>
      </div>
    </div>
  )
}
