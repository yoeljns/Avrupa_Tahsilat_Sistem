import Link from 'next/link'

// Bulunamayan adres (uygulama dışı düzen): Türkçe açıklama ve Pano'ya dönüş.

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200/70">
      <p className="text-sm font-semibold tracking-wide text-blue-600 uppercase">404</p>
      <h1 className="mt-1 text-lg font-bold text-slate-900">Sayfa bulunamadı</h1>
      <p className="mt-2 text-sm text-slate-600">Aradığınız adres yok ya da taşınmış olabilir. Adresi kontrol edin ya da Pano&apos;ya dönün.</p>
      <Link href="/" className="mt-5 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
        Pano&apos;ya dön
      </Link>
    </div>
  )
}
