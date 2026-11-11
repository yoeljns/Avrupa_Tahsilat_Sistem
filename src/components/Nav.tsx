'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, CircleHelp, LogOut, Menu, UserRound, X } from 'lucide-react'
import FirmaArama from '@/components/FirmaArama'
import type { Role } from '@/lib/auth'

// ÜST ÇUBUK — sayfa kayarken yerinde durur (yazdırmada gizlenir).
//   geniş ekran : marka · sayfalar | yönetim sayfaları · firma arama · Yardım · kullanıcı menüsü
//   dar ekran   : menü düğmesi · marka · Yardım · kullanıcı; sayfalar ve arama açılır panelde
// Yüksekliği 3,5rem'dir (h-14); sayfa içindeki yapışkan öğeler buna göre top-20 kullanır.

interface NavProps {
  role: Role
  email: string
}

interface Baglanti {
  href: string
  label: string
}

const SAYFALAR: Baglanti[] = [
  { href: '/', label: 'Pano' },
  { href: '/konsinye', label: 'Konsinye' },
  { href: '/pesin', label: 'Peşin' },
  { href: '/firmalar', label: 'Firmalar' },
  { href: '/raporlar', label: 'Raporlar' },
]

/** Yalnız yönetici ve tahsilat yöneticisi */
const YONETIM_SAYFALARI: Baglanti[] = [
  { href: '/ice-aktarim', label: 'İçe Aktarım' },
  { href: '/inceleme', label: 'İnceleme' },
  { href: '/yonetim', label: 'Yönetim' },
]

const ROLE_LABELS: Record<Role, string> = {
  yonetici: 'Yönetici',
  tahsilat_yoneticisi: 'Tahsilat Yöneticisi',
  pazarlamaci: 'Pazarlamacı',
}

const ODAK = 'focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none'

export default function Nav({ role, email }: NavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [menuAcik, setMenuAcik] = useState(false)
  const [kullaniciAcik, setKullaniciAcik] = useState(false)
  const kullaniciKutusu = useRef<HTMLDivElement>(null)
  const yonetim = role !== 'pazarlamaci'

  const kapat = () => {
    setMenuAcik(false)
    setKullaniciAcik(false)
  }

  // Açık menüler: Escape ile, kullanıcı menüsü dışarı tıklamayla da kapanır
  useEffect(() => {
    if (!kullaniciAcik && !menuAcik) return
    const tikla = (e: MouseEvent) => {
      if (kullaniciAcik && kullaniciKutusu.current && !kullaniciKutusu.current.contains(e.target as Node)) setKullaniciAcik(false)
    }
    const tus = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setKullaniciAcik(false)
      setMenuAcik(false)
    }
    document.addEventListener('mousedown', tikla)
    document.addEventListener('keydown', tus)
    return () => {
      document.removeEventListener('mousedown', tikla)
      document.removeEventListener('keydown', tus)
    }
  }, [kullaniciAcik, menuAcik])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  const etkinMi = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/'))

  const baglanti = (l: Baglanti, genis: boolean) => {
    const etkin = etkinMi(l.href)
    return (
      <Link
        key={l.href}
        href={l.href}
        onClick={kapat}
        aria-current={etkin ? 'page' : undefined}
        className={
          `rounded-lg font-medium whitespace-nowrap ${ODAK} ` +
          // 1024–1279 px: bağlantılar sıkışık yazılır ki sekizi de arama kutusuyla aynı satıra sığsın
          (genis ? 'px-2 py-1.5 text-[13px] xl:px-3 xl:text-sm ' : 'block px-3 py-2 text-sm ') +
          (etkin ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')
        }
      >
        {l.label}
      </Link>
    )
  }

  const kisaAd = email.split('@')[0]

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur print:hidden">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-2 px-4">
        <button
          type="button"
          onClick={() => {
            setKullaniciAcik(false)
            setMenuAcik((a) => !a)
          }}
          aria-expanded={menuAcik}
          aria-controls="ana-menu-paneli"
          aria-label={menuAcik ? 'Menüyü kapat' : 'Menüyü aç'}
          className={`-ml-1.5 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden ${ODAK}`}
        >
          {menuAcik ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>

        <Link href="/" onClick={kapat} className={`mr-1 shrink-0 rounded text-base font-bold whitespace-nowrap text-slate-900 xl:mr-3 ${ODAK}`}>
          Avrupa Tahsilat
        </Link>

        <nav aria-label="Ana menü" className="hidden min-w-0 items-center gap-0.5 lg:flex">
          {SAYFALAR.map((l) => baglanti(l, true))}
          {yonetim && (
            <>
              <span className="mx-1.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden="true" />
              {YONETIM_SAYFALARI.map((l) => baglanti(l, true))}
            </>
          )}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-1 xl:gap-2">
          <FirmaArama className="hidden w-44 md:block lg:w-36 xl:w-64" kisayol />

          <Link
            href="/yardim"
            onClick={kapat}
            aria-current={etkinMi('/yardim') ? 'page' : undefined}
            title="Yardım — İş Akış Prosedürü"
            className={
              `flex items-center gap-1.5 rounded-lg p-2 text-sm font-medium xl:px-2.5 xl:py-1.5 ${ODAK} ` +
              (etkinMi('/yardim') ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')
            }
          >
            <CircleHelp className="h-5 w-5 xl:h-4 xl:w-4" aria-hidden="true" />
            <span className="sr-only xl:not-sr-only">Yardım</span>
          </Link>

          <div ref={kullaniciKutusu} className="relative">
            <button
              type="button"
              onClick={() => {
                setMenuAcik(false)
                setKullaniciAcik((a) => !a)
              }}
              aria-haspopup="menu"
              aria-expanded={kullaniciAcik}
              aria-label={`Kullanıcı menüsü: ${email}`}
              title={email}
              className={`flex items-center gap-1.5 rounded-lg py-1 pr-1.5 pl-1 text-sm text-slate-600 hover:bg-slate-100 ${ODAK}`}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700 uppercase">{kisaAd.slice(0, 1)}</span>
              <span className="hidden max-w-[10rem] truncate 2xl:inline">{kisaAd}</span>
              <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
            </button>
            {kullaniciAcik && (
              <div role="menu" aria-label="Kullanıcı menüsü" className="absolute right-0 z-50 mt-1.5 w-64 overflow-hidden rounded-xl bg-white text-sm shadow-lg ring-1 ring-slate-200">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="truncate font-medium text-slate-900" title={email}>
                    {email}
                  </p>
                  <p className="text-xs text-slate-500">{ROLE_LABELS[role]}</p>
                </div>
                <Link href="/hesap" role="menuitem" onClick={kapat} className="flex items-center gap-2 px-4 py-2.5 text-slate-700 hover:bg-slate-50">
                  <UserRound className="h-4 w-4 text-slate-400" aria-hidden="true" /> Hesabım
                </Link>
                <button type="button" role="menuitem" onClick={logout} className="flex w-full items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-left text-slate-700 hover:bg-slate-50">
                  <LogOut className="h-4 w-4 text-slate-400" aria-hidden="true" /> Çıkış
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {menuAcik && (
        <div id="ana-menu-paneli" className="max-h-[calc(100vh-3.5rem)] overflow-y-auto border-t border-slate-200 bg-white px-4 pt-3 pb-4 shadow-lg lg:hidden">
          <FirmaArama className="mb-3 md:hidden" onGidildi={() => setMenuAcik(false)} />
          <nav aria-label="Ana menü" className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {SAYFALAR.map((l) => baglanti(l, false))}
            {yonetim && YONETIM_SAYFALARI.map((l) => baglanti(l, false))}
            {baglanti({ href: '/yardim', label: 'Yardım' }, false)}
          </nav>
        </div>
      )}
    </header>
  )
}
