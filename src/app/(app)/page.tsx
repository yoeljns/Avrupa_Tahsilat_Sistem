import Link from 'next/link'
import MigrationNeeded, { isMissingRelationError } from '@/components/MigrationNeeded'
import RecomputeButton from '@/components/RecomputeButton'
import StatCard from '@/components/StatCard'
import { getSessionProfile, isStaffRole } from '@/lib/auth'
import { eur, trDateTime } from '@/lib/format'
import { panoOzeti, type PanoOzeti } from '@/lib/queries'
import { renkOf } from '@/lib/renkler'
import { createServerSupabase } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const TETIK_ADLARI: Record<string, string> = {
  import: 'içe aktarma',
  edit: 'düzenleme',
  manual: 'elle',
  setup: 'kurulum',
}

export default async function DashboardPage() {
  const session = (await getSessionProfile())!
  const staff = isStaffRole(session.role)
  const supabase = await createServerSupabase()

  // TEK ağ turu: bakiyeler, vade pencereleri (bugüne göre canlı) ve inceleme sayısı
  let ozet: PanoOzeti
  try {
    ozet = await panoOzeti(supabase)
  } catch (e) {
    if (isMissingRelationError(e)) return <MigrationNeeded />
    throw e
  }

  if (!ozet.run_id) {
    return (
      <div>
        <h1 className="text-lg font-bold text-slate-900">Pano</h1>
        <div className="mt-6 rounded-2xl bg-white p-8 text-center shadow-sm">
          <p className="text-slate-600">Henüz mutabakat hesaplanmadı.</p>
          {staff ? (
            <p className="mt-2 text-sm text-slate-500">
              Başlamak için{' '}
              <Link href="/ice-aktarim" className="font-medium text-blue-700 hover:underline">
                İçe Aktarım
              </Link>{' '}
              sayfasından irsaliye ve ödeme dosyalarını yükleyin.
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Veriler yüklendiğinde borç özetiniz burada görünecek.</p>
          )}
        </div>
      </div>
    )
  }

  const b = ozet.bakiye
  const v = ozet.vade
  const reviewCount = ozet.inceleme?.adet ?? 0
  const reviewSum = ozet.inceleme?.tutar ?? 0
  const sonGuncelleme = (ozet.kosu?.stats?.son_firma_guncelleme as string | undefined) ?? ozet.kosu?.finished_at ?? ozet.kosu?.started_at
  // Kategoriler yönetim panelinden: "Konsinye açık borç" hangi kategorilerin toplamı, panoda ayrı kartı olanlar
  const kategoriler = ozet.kategoriler ?? []
  const adlar = (taraf: 'PESIN' | 'VADELI', varsayilan: string) =>
    kategoriler.length === 0
      ? varsayilan
      : kategoriler
          .filter((k) => k.taraf === taraf && (k.aktif || k.acik > 0))
          .map((k) => k.ad)
          .join(' + ') || varsayilan
  const kartlar = kategoriler.filter((k) => k.panoda_kart)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-900">Pano</h1>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {ozet.kosu && (
            <span>
              Son hesap: {trDateTime(sonGuncelleme)} · tam hesap {trDateTime(ozet.kosu.started_at)} (
              {TETIK_ADLARI[ozet.kosu.trigger_kind] ?? ozet.kosu.trigger_kind}, {ozet.kosu.triggered_by ?? '—'})
            </span>
          )}
          {staff && (
            <>
              <a href="/api/export/borclar" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Borç Raporu (Excel)
              </a>
              <a href="/api/export/tahsilat-detay" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Tahsilat Detayı (Excel)
              </a>
              <RecomputeButton />
            </>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Konsinye Açık Borç" value={eur(b?.vadeli_acik ?? 0)} sub={adlar('VADELI', 'Konsinye + Konsinye Peşin')} />
        <StatCard title="Peşin Açık Borç" value={eur(b?.pesin_acik ?? 0)} sub={adlar('PESIN', 'Peşin') !== 'Peşin' ? adlar('PESIN', 'Peşin') : undefined} />
        <StatCard
          title="Vadesi Geçmiş (Konsinye)"
          value={eur(v?.gecikmis ?? 0)}
          tone={(v?.gecikmis ?? 0) > 0 ? 'red' : 'default'}
        />
        <StatCard
          title="Alacak Bakiyesi"
          value={eur(b?.alacak ?? 0)}
          sub="Fazla ödemeler — sonraki borçtan düşülür"
          tone="green"
        />
        <StatCard title="7 Gün İçinde Vadesi Gelen" value={eur(v?.gun7 ?? 0)} tone={(v?.gun7 ?? 0) > 0 ? 'amber' : 'default'} />
        <StatCard title="30 Gün İçinde Vadesi Gelen" value={eur(v?.gun30 ?? 0)} />
        <StatCard title="Toplam Tahsilat" value={eur(b?.toplam_odenen ?? 0)} sub="Tahsise giren ödemeler (eşleşen KDV 1/5 dahil)" />
        {staff && (
          <Link href="/inceleme" className="block">
            <StatCard
              title="İnceleme Bekleyen İrsaliye"
              value={String(reviewCount)}
              sub={reviewCount > 0 ? `${eur(reviewSum)} — sınıflandırma/plan onayı bekliyor` : 'Bekleyen yok'}
              tone={reviewCount > 0 ? 'amber' : 'default'}
            />
          </Link>
        )}
      </div>

      {kartlar.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kartlar.map((k) => {
            const renk = renkOf(k.renk)
            return (
              <Link
                key={k.kod}
                href={`${k.taraf === 'PESIN' ? '/pesin' : '/konsinye'}?kategori=${encodeURIComponent(k.kod)}`}
                className={'block rounded-2xl border-l-4 bg-white p-5 shadow-sm hover:bg-slate-50 ' + renk.kenar}
              >
                <p className="flex items-center gap-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
                  <span className={'h-2 w-2 rounded-full ' + renk.nokta} aria-hidden="true" />
                  {k.ad} Açık Borç
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{eur(k.acik)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {k.gecikmis > 0 ? (
                    <>
                      Vadesi geçmiş: <span className="tabular-nums text-red-600">{eur(k.gecikmis)}</span> ·{' '}
                    </>
                  ) : null}
                  {k.firma} firma
                </p>
              </Link>
            )
          })}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Link href="/konsinye" className="rounded-2xl bg-white p-5 shadow-sm hover:bg-blue-50/40">
          <h2 className="font-semibold text-slate-900">Konsinye / Konsinye Peşin Takvimi →</h2>
          <p className="mt-1 text-sm text-slate-500">Her vade için Borç · Ödeme · Kalan; gecikmişler ve toplamlar</p>
        </Link>
        <Link href="/pesin" className="rounded-2xl bg-white p-5 shadow-sm hover:bg-blue-50/40">
          <h2 className="font-semibold text-slate-900">Peşin Borç Tablosu →</h2>
          <p className="mt-1 text-sm text-slate-500">İrsaliye tarihine göre bekleyen peşin ödemeler ve yaşlandırma</p>
        </Link>
      </div>
    </div>
  )
}
