import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAnonKey, supabaseUrl } from '@/lib/env'
import { jetonTazeMi, oturumCerezleri } from '@/lib/jeton'

// Oturum çerezlerini yeniler ve oturumsuz sayfa trafiğini /login'e yönlendirir.
// /api rotaları kendi yetki kontrollerini yapar (JSON 401 dönebilmeleri için).

const PUBLIC_PATHS = ['/login', '/setup']

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  // Supabase env değişkenleri henüz bağlanmadıysa siteyi 500'e düşürme:
  // kurulum sihirbazına yönlendir, /setup ve /api kendi Türkçe mesajlarını verir.
  let url: string
  let anonKey: string
  try {
    url = supabaseUrl()
    anonKey = supabaseAnonKey()
  } catch {
    const path = request.nextUrl.pathname
    if (path === '/setup' || path.startsWith('/setup/') || path.startsWith('/api')) {
      return response
    }
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/setup'
    redirectUrl.search = ''
    return NextResponse.redirect(redirectUrl)
  }

  const path0 = request.nextUrl.pathname
  const isPublic0 = PUBLIC_PATHS.some((p) => path0 === p || path0.startsWith(p + '/'))
  const isApi0 = path0.startsWith('/api')
  const cerezler = request.cookies.getAll().map((c) => ({ name: c.name, value: c.value }))

  // 1) Oturum çerezi hiç yoksa: AĞA ÇIKMADAN karar ver
  if (oturumCerezleri(cerezler).length === 0) {
    if (isPublic0 || isApi0) return response
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.search = ''
    return NextResponse.redirect(redirectUrl)
  }

  // 2) Jeton hâlâ taze: Auth sunucusuna GİTME. Her sayfa geçişinden bir ağ
  //    turu düşer. Yetki zaten sayfada (requireUser) ve veride (RLS)
  //    doğrulanıyor; burada yapılan iş yalnız yönlendirme/tazeleme.
  if (jetonTazeMi(cerezler, Date.now())) {
    if (path0 === '/login') {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      url.search = ''
      return NextResponse.redirect(url)
    }
    return response
  }

  // 3) Jeton bitmiş/çözülemedi: normal doğrulama + oturum tazeleme yolu
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'))
  const isApi = path.startsWith('/api')

  if (!user && !isPublic && !isApi) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (user && path === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
