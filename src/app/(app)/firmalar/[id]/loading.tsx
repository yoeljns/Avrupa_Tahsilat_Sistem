// Firma kartı yüklenirken görünen iskelet.
// Bu klasörde ayrı bir iskelet olması, bir firma kartından BAŞKA bir firma kartına
// geçişte (üst çubuktaki firma arama) eski kartın ekranda donup kalmasını önler:
// yeni firmaya geçildiği anında görünür, içerik hazır olunca yerine oturur.

export default function FirmaYukleniyor() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Firma kartı yükleniyor">
      <div className="h-4 w-24 rounded bg-slate-100" />
      <div className="mt-2 h-7 w-96 max-w-full rounded bg-slate-200" />
      <div className="mt-2 h-4 w-64 max-w-full rounded bg-slate-100" />
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-2xl bg-white shadow-sm" />
        ))}
      </div>
      <div className="mt-6 h-64 rounded-2xl bg-white shadow-sm" />
      <div className="mt-6 h-64 rounded-2xl bg-white shadow-sm" />
    </div>
  )
}
