'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { Role } from '@/lib/auth'

interface NavProps {
  role: Role
  email: string
}

const LINKS: Array<{ href: string; label: string; roles: Role[] }> = [
  { href: '/', label: 'Pano', roles: ['yonetici', 'tahsilat_yoneticisi', 'pazarlamaci'] },
  { href: '/konsinye', label: 'Konsinye', roles: ['yonetici', 'tahsilat_yoneticisi', 'pazarlamaci'] },
  { href: '/pesin', label: 'Peşin', roles: ['yonetici', 'tahsilat_yoneticisi', 'pazarlamaci'] },
  { href: '/firmalar', label: 'Firmalar', roles: ['yonetici', 'tahsilat_yoneticisi', 'pazarlamaci'] },
  { href: '/ice-aktarim', label: 'İçe Aktarım', roles: ['yonetici', 'tahsilat_yoneticisi'] },
  { href: '/inceleme', label: 'İnceleme', roles: ['yonetici', 'tahsilat_yoneticisi'] },
  { href: '/yonetim', label: 'Yönetim', roles: ['yonetici', 'tahsilat_yoneticisi'] },
]

const ROLE_LABELS: Record<Role, string> = {
  yonetici: 'Yönetici',
  tahsilat_yoneticisi: 'Tahsilat Yöneticisi',
  pazarlamaci: 'Pazarlamacı',
}

export default function Nav({ role, email }: NavProps) {
  const pathname = usePathname()
  const router = useRouter()

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-base font-bold text-slate-900">
          Avrupa Tahsilat
        </Link>
        <nav className="flex flex-wrap items-center gap-1">
          {LINKS.filter((l) => l.roles.includes(role)).map((l) => {
            const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href)
            return (
              <Link
                key={l.href}
                href={l.href}
                className={
                  'rounded-lg px-3 py-1.5 text-sm font-medium ' +
                  (active ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100')
                }
              >
                {l.label}
              </Link>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Link href="/hesap" className="text-slate-500 hover:text-slate-800" title={email}>
            {email} <span className="text-slate-400">({ROLE_LABELS[role]})</span>
          </Link>
          <button
            onClick={logout}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Çıkış
          </button>
        </div>
      </div>
    </header>
  )
}
