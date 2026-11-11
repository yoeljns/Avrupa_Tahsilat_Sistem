import Link from 'next/link'
import ImportPanel from '@/components/ImportPanel'
import { requireRole } from '@/lib/auth'
import { trDateTime } from '@/lib/format'
import { aktarimOzeti } from '@/lib/import/etiketler'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface BatchRow {
  id: string
  kind: string
  filename: string
  uploaded_by: string | null
  status: string
  stats: Record<string, unknown> | null
  created_at: string
  committed_at: string | null
}

const KIND_LABELS: Record<string, string> = {
  irsaliye: 'İrsaliye',
  odemeler: 'Ödemeler',
  bayiler: 'Bayi Listesi',
}

export default async function IceAktarimPage() {
  await requireRole(['yonetici', 'tahsilat_yoneticisi'])
  const supabase = await createServerSupabase()

  // Yalnız son 20 yükleme (tümünü çekip kesmek yerine)
  const { data } = await supabase
    .from('import_batches')
    .select('id, kind, filename, uploaded_by, status, stats, created_at, committed_at')
    .order('created_at', { ascending: false })
    .range(0, 19)
  const batches = (data ?? []) as BatchRow[]

  return (
    <div>
      <h1 className="text-lg font-bold text-slate-900">İçe Aktarım</h1>
      <p className="mt-1 text-sm text-slate-500">
        Dosyalar önce önizlenir; siz onaylamadan hiçbir veri değişmez. Aynı dosyayı yeniden yüklemek güvenlidir —
        değişmeyen kayıtlar olduğu gibi kalır, Tahsilat Yöneticisi düzenlemeleri asla ezilmez.
      </p>

      {/* Yükleme sırası: irsaliye ödemeden önce — ödeme, irsaliyenin taksitlerine işlenir */}
      <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
        <li className="font-semibold">Yükleme sırası:</li>
        <li>
          <span className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">1</span>
          Bayi listesi <span className="text-blue-700">(yalnız değiştiyse —{' '}
          <Link href="/yonetim/bayiler" className="font-medium underline">
            Yönetim → Bayiler ve Sorumlular
          </Link>
          )</span>
        </li>
        <li aria-hidden="true" className="text-blue-400">
          →
        </li>
        <li>
          <span className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">2</span>
          Satış irsaliyeleri
        </li>
        <li aria-hidden="true" className="text-blue-400">
          →
        </li>
        <li>
          <span className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">3</span>
          Gelen ödemeler
        </li>
      </ol>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ImportPanel
          kind="irsaliye"
          title="Satış İrsaliyeleri (.xls)"
          description="ERP'den alınan satış irsaliyeleri listesi. Belge No'dan satış tipi, Ödeme Planı'ndan vade tarihleri otomatik çözülür."
          accept=".xls,.xlsx"
        />
        <ImportPanel
          kind="odemeler"
          title="Gelen Ödemeler (.xlsx)"
          description="Bağlanan Kurlar uygulamasının yedeği. PEŞİN ve VADELİ sayfaları okunur; ALC kayıtları bilgi olarak saklanır."
          accept=".xlsx,.xls"
        />
      </div>

      <h2 className="mt-8 font-semibold text-slate-900">Son Yüklemeler</h2>
      <div className="mt-2 overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Zaman</th>
              <th className="px-3 py-2">Tür</th>
              <th className="px-3 py-2">Dosya</th>
              <th className="px-3 py-2">Yükleyen</th>
              <th className="px-3 py-2">Durum</th>
              <th className="px-3 py-2">Özet</th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Henüz yükleme yapılmadı.
                </td>
              </tr>
            )}
            {batches.map((b) => (
              <tr key={b.id} className="border-b border-slate-100">
                <td className="px-3 py-2 whitespace-nowrap">{trDateTime(b.created_at)}</td>
                <td className="px-3 py-2">{KIND_LABELS[b.kind] ?? b.kind}</td>
                <td className="px-3 py-2 text-slate-500">{b.filename}</td>
                <td className="px-3 py-2 text-slate-500">{b.uploaded_by ?? '—'}</td>
                <td className="px-3 py-2">
                  {b.status === 'committed' ? (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">Aktarıldı</span>
                  ) : b.status === 'preview' ? (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">Önizleme (uygulanmadı)</span>
                  ) : (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">İptal</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{aktarimOzeti(b.stats) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
