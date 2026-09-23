// Sayfa geçişinde ANINDA görünen iskelet: veri gelene kadar kullanıcı boş
// ekran beklemez; menü ve düzen yerinde kalır.

export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Yükleniyor">
      <div className="h-6 w-48 rounded bg-slate-200" />
      <div className="mt-2 h-4 w-80 max-w-full rounded bg-slate-100" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-white shadow-sm" />
        ))}
      </div>
      <div className="mt-6 h-72 rounded-2xl bg-white shadow-sm" />
    </div>
  )
}
