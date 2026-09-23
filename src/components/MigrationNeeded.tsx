// Veritabanı şeması eksik olduğunda (yeni migration çalıştırılmamış)
// sayfaların çökmesi yerine gösterilen yönerge kartı.

export default function MigrationNeeded() {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-amber-300 bg-amber-50 p-6">
      <h2 className="text-base font-bold text-amber-900">Veritabanı güncellemesi gerekli</h2>
      <p className="mt-2 text-sm text-amber-800">
        Uygulama yeni sürüme geçti ama veritabanı şeması henüz güncellenmedi. Yapmanız gereken:
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-amber-900">
        <li>
          Supabase Dashboard → <strong>SQL Editor</strong>&apos;ü açın.
        </li>
        <li>
          Repodaki <code className="rounded bg-amber-100 px-1">supabase/migrations</code> klasöründeki dosyaları{' '}
          <strong>sırayla</strong> (0002 → 0003 → 0004 → 0005 → 0006) yapıştırıp her birinde <strong>Run</strong> deyin.
          Daha önce çalıştırdıklarınızı yeniden çalıştırmak zarar vermez.
        </li>
        <li>
          Bu sayfaya dönüp yenileyin ve <strong>Pano → Yeniden Hesapla</strong>&apos;ya basın.
        </li>
      </ol>
      <p className="mt-3 text-xs text-amber-700">
        Dosyalar güvenlidir; yanlışlıkla iki kez çalıştırmak sorun çıkarmaz. Verileriniz silinmez.
      </p>
    </div>
  )
}

/** Supabase 'tablo/görünüm yok' hatası mı? (migration eksik) */
export function isMissingRelationError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return (
    /relation .* does not exist/i.test(msg) ||
    /could not find the table/i.test(msg) ||
    /schema cache/i.test(msg) ||
    msg.includes('PGRST205') ||
    msg.includes('PGRST202') ||
    /could not find the function/i.test(msg) ||
    /function .* does not exist/i.test(msg) ||
    /column .* does not exist/i.test(msg)
  )
}
