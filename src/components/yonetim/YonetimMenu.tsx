'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, EyeOff, History, LayoutDashboard, ListChecks, Tags, TriangleAlert, Users, type LucideIcon } from 'lucide-react'

// Yönetim paneli menüsü: geniş ekranda solda yapışkan gruplu liste, dar ekranda yatay kaydırılan sekmeler.

interface Oge {
  href: string
  ad: string
  ikon: LucideIcon
  aciklama: string
}

interface Grup {
  baslik: string
  ogeler: Oge[]
  tehlikeli?: boolean
}

function gruplar(yonetici: boolean, sahip: boolean): Grup[] {
  const liste: Grup[] = [
    { baslik: 'Genel', ogeler: [{ href: '/yonetim', ad: 'Genel Bakış', ikon: LayoutDashboard, aciklama: 'Sistem durumu ve veri sağlığı' }] },
    {
      baslik: 'Satış ve sınıflandırma',
      ogeler: [
        { href: '/yonetim/kategoriler', ad: 'Satış Kategorileri', ikon: Tags, aciklama: 'Peşin, Konsinye ve yenileri' },
        { href: '/yonetim/kurallar', ad: 'Tanıma Kuralları', ikon: ListChecks, aciklama: 'İrsaliye hangi kategoriye düşer' },
      ],
    },
    {
      baslik: 'Kişiler ve firmalar',
      ogeler: [
        ...(yonetici ? [{ href: '/yonetim/kullanicilar', ad: 'Kullanıcılar', ikon: Users, aciklama: 'Hesaplar ve roller' }] : []),
        { href: '/yonetim/bayiler', ad: 'Bayiler ve Sorumlular', ikon: Building2, aciklama: 'Firma listesi ve pazarlamacılar' },
        { href: '/yonetim/haric-firmalar', ad: 'Takip Dışı Firmalar', ikon: EyeOff, aciklama: 'Hesaba katılmayan firma kodları' },
      ],
    },
    { baslik: 'Kayıtlar', ogeler: [{ href: '/yonetim/denetim', ad: 'Denetim Kaydı', ikon: History, aciklama: 'Kim, ne zaman, neyi değiştirdi' }] },
  ]
  if (sahip) {
    liste.push({
      baslik: 'Tehlikeli bölge',
      tehlikeli: true,
      ogeler: [{ href: '/yonetim/sifirlama', ad: 'Veri Sıfırlama', ikon: TriangleAlert, aciklama: 'Tüm veriyi kalıcı siler' }],
    })
  }
  return liste
}

function aktifMi(pathname: string, href: string): boolean {
  return href === '/yonetim' ? pathname === '/yonetim' : pathname === href || pathname.startsWith(href + '/')
}

export default function YonetimMenu({ yonetici, sahip }: { yonetici: boolean; sahip: boolean }) {
  const pathname = usePathname()
  const liste = gruplar(yonetici, sahip)

  return (
    <>
      {/* Dar ekran: yatay sekmeler */}
      <nav aria-label="Yönetim" className="-mx-4 overflow-x-auto px-4 lg:hidden print:hidden">
        <div className="flex min-w-max gap-1.5 pb-1">
          {liste.flatMap((g) =>
            g.ogeler.map((o) => {
              const aktif = aktifMi(pathname, o.href)
              const Ikon = o.ikon
              return (
                <Link
                  key={o.href}
                  href={o.href}
                  aria-current={aktif ? 'page' : undefined}
                  className={
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset ' +
                    (aktif
                      ? g.tehlikeli
                        ? 'bg-red-600 text-white ring-red-600'
                        : 'bg-blue-600 text-white ring-blue-600'
                      : g.tehlikeli
                        ? 'bg-white text-red-700 ring-red-200'
                        : 'bg-white text-slate-700 ring-slate-200')
                  }
                >
                  <Ikon className="h-4 w-4" aria-hidden="true" />
                  {o.ad}
                </Link>
              )
            }),
          )}
        </div>
      </nav>

      {/* Geniş ekran: solda gruplu menü */}
      <nav aria-label="Yönetim" className="sticky top-6 hidden space-y-5 lg:block print:hidden">
        {liste.map((g) => (
          <div key={g.baslik} className={g.tehlikeli ? 'border-t border-red-100 pt-4' : ''}>
            <p className={'px-3 text-[11px] font-semibold tracking-wider uppercase ' + (g.tehlikeli ? 'text-red-500' : 'text-slate-400')}>{g.baslik}</p>
            <ul className="mt-1.5 space-y-0.5">
              {g.ogeler.map((o) => {
                const aktif = aktifMi(pathname, o.href)
                const Ikon = o.ikon
                return (
                  <li key={o.href}>
                    <Link
                      href={o.href}
                      aria-current={aktif ? 'page' : undefined}
                      className={
                        'group flex items-start gap-3 rounded-xl px-3 py-2 ' +
                        (aktif
                          ? g.tehlikeli
                            ? 'bg-red-50 text-red-800'
                            : 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200'
                          : g.tehlikeli
                            ? 'text-red-700 hover:bg-red-50'
                            : 'text-slate-600 hover:bg-white hover:text-slate-900')
                      }
                    >
                      <Ikon
                        className={
                          'mt-0.5 h-4 w-4 shrink-0 ' +
                          (aktif ? (g.tehlikeli ? 'text-red-600' : 'text-blue-600') : g.tehlikeli ? 'text-red-400' : 'text-slate-400 group-hover:text-slate-600')
                        }
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{o.ad}</span>
                        <span className={'block text-xs ' + (g.tehlikeli ? 'text-red-400' : 'text-slate-400')}>{o.aciklama}</span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  )
}
