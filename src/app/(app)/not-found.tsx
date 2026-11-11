import Link from 'next/link'

// Uygulama içinde bulunamayan kayıt (ör. silinmiş ya da görme yetkiniz olmayan firma).

export default function AppNotFound() {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200/70">
      <h1 className="text-lg font-bold text-slate-900">Kayıt bulunamadı</h1>
      <p className="mt-2 text-sm text-slate-600">
        Aradığınız sayfa ya da firma yok; adres yanlış olabilir ya da bu kaydı görme yetkiniz bulunmuyor olabilir. Firmayı üstteki arama kutusundan ya da Firmalar
        listesinden bulabilirsiniz.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link href="/firmalar" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          Firmalar
        </Link>
        <Link href="/" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Pano&apos;ya dön
        </Link>
      </div>
    </div>
  )
}
