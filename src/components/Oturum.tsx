'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { Role } from '@/lib/auth'

// OTURUM BAĞLAMI — (app)/layout.tsx oturumu bir kez okur; istemci bileşenleri (hata
// ekranı, göç yönergesi gibi) rolü buradan öğrenir. Yalnız GÖSTERİM içindir: yetki
// her zaman sunucuda (requireUser / apiSession) ve veride (RLS) denetlenir.

interface Oturum {
  rol: Role
  email: string
}

const Baglam = createContext<Oturum | null>(null)

export function OturumSaglayici({ rol, email, children }: Oturum & { children: ReactNode }) {
  return <Baglam.Provider value={{ rol, email }}>{children}</Baglam.Provider>
}

/** Oturum bilgisi; sağlayıcının dışında (ör. giriş sayfası) null */
export function useOturum(): Oturum | null {
  return useContext(Baglam)
}

/**
 * İçeriği yalnız yöneticiye gösterir (ör. veritabanı güncelleme talimatı);
 * diğer rollere `yoksa` gösterilir.
 */
export function YoneticiyeOzel({ children, yoksa = null }: { children: ReactNode; yoksa?: ReactNode }) {
  const oturum = useOturum()
  return <>{oturum?.rol === 'yonetici' ? children : yoksa}</>
}
