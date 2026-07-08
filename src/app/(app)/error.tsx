'use client'

// Genel hata sınırı — beklenmeyen sunucu hatalarında beyaz ekran yerine
// Türkçe açıklama ve kurtarma seçenekleri gösterir.

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-10 max-w-xl rounded-2xl bg-white p-8 text-center shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">Bir şeyler ters gitti</h2>
      <p className="mt-2 text-sm text-slate-600">
        Sayfa yüklenirken beklenmeyen bir hata oluştu. Bu genellikle geçicidir; tekrar deneyin.
      </p>
      <p className="mt-2 text-sm text-slate-600">
        Hata sürüyorsa ve sistemi yeni güncellediyseniz, Supabase SQL Editor&apos;de{' '}
        <code className="rounded bg-slate-100 px-1">supabase/migrations</code> klasöründeki{' '}
        <strong>0002</strong> ve <strong>0003</strong> dosyalarını çalıştırıp{' '}
        <strong>Pano → Yeniden Hesapla</strong>&apos;ya basın (README, adım 4).
      </p>
      {error.digest && <p className="mt-3 text-xs text-slate-400">Hata kodu: {error.digest}</p>}
      <button
        onClick={reset}
        className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
      >
        Tekrar dene
      </button>
    </div>
  )
}
