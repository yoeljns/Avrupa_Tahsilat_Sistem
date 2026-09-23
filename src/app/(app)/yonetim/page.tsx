import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  Building2,
  CalendarX,
  CircleCheck,
  FileSpreadsheet,
  FileText,
  History,
  Inbox,
  Receipt,
  Tags,
  TriangleAlert,
  Upload,
  Users,
} from 'lucide-react'
import MigrationNeeded, { isMissingRelationError } from '@/components/MigrationNeeded'
import RecomputeButton from '@/components/RecomputeButton'
import Badge from '@/components/ui/Badge'
import { buttonClass } from '@/components/ui/Button'
import Card, { CardTitle } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import { isAdminRole, requireRole } from '@/lib/auth'
import { alanEtiketi, islemEtiketi, kayitYazisi } from '@/lib/denetimEtiketleri'
import { eur, trDateTime } from '@/lib/format'
import { DAVRANISLAR, davranisOf } from '@/lib/kategoriMeta'
import { yonetimOzeti, type YonetimOzeti } from '@/lib/queries'
import { renkOf } from '@/lib/renkler'
import { createServerSupabase } from '@/lib/supabase/server'
import { eurKisa } from '@/lib/takvim'

export const dynamic = 'force-dynamic'

// Yönetim → Genel Bakış: sistemin anlık durumu tek bakışta (tek ağ turu: rpc_yonetim_ozeti).
// Sorun gösteren her satır, düzeltileceği sayfaya götürür.

const TETIK: Record<string, string> = { import: 'içe aktarma', edit: 'düzenleme', manual: 'elle', setup: 'kurulum' }
const AKTARIM_TURU: Record<string, string> = { irsaliye: 'İrsaliye', odemeler: 'Ödemeler', bayiler: 'Bayi listesi' }
const AKTARIM_DURUMU: Record<string, { ad: string; ton: 'green' | 'amber' | 'gray' }> = {
  committed: { ad: 'Uygulandı', ton: 'green' },
  preview: { ad: 'Önizlemede kaldı', ton: 'amber' },
  discarded: { ad: 'Vazgeçildi', ton: 'gray' },
}

interface SaglikOgesi {
  ad: string
  sayi: number
  aciklama: string
  href: string
  eylem: string
  ciddi?: boolean
  ek?: string
  /** bağlantı bir dosya indirir (sayfa değil) */
  indir?: boolean
}

function saglikListesi(o: YonetimOzeti): SaglikOgesi[] {
  const s = o.saglik
  return [
    {
      ad: 'Sınıflandırılmamış irsaliye',
      sayi: s.siniflandirilmamis,
      ek: s.siniflandirilmamis > 0 ? `≈ ${eur(s.siniflandirilmamis_tutar)}` : undefined,
      aciklama: 'Kategorisi belli olmadığı için borç hesabına girmiyor. Kuralla toplu ya da İnceleme’den tek tek atanabilir.',
      href: '/yonetim/kurallar',
      eylem: 'Kurallara git',
      ciddi: true,
    },
    { ad: 'İnceleme bekleyen irsaliye', sayi: s.inceleme, aciklama: 'Onay ya da düzeltme bekleyen kayıtlar.', href: '/inceleme', eylem: 'İncelemeye git' },
    {
      ad: 'Planı okunamayan irsaliye',
      sayi: s.plan_okunamadi,
      aciklama: 'Ödeme planı yazısı çözülemedi; vade irsaliye tarihine kondu.',
      href: '/inceleme?sekme=plan',
      eylem: 'Planları düzelt',
    },
    {
      ad: 'Elle düzeltilmiş ama kaynağı değişmiş',
      sayi: s.cakisma,
      aciklama: 'Yeni dosyada değeri değişen, daha önce elle düzeltilmiş irsaliyeler.',
      href: '/inceleme?sekme=cakisma',
      eylem: 'Çakışmalara bak',
    },
    {
      ad: 'Tarihi girilmemiş açık taksit',
      sayi: o.tarihsiz_taksit,
      aciklama: 'Konsinye planında tarih yok; vade irsaliye tarihi sayılıyor.',
      href: '/inceleme?sekme=tarihsiz',
      eylem: 'Tarihleri gir',
    },
    {
      ad: 'Eşleşmeyen KDV ödemesi',
      sayi: Number(o.son_kosu?.kdv_eslesmeyen ?? 0),
      aciklama: 'İrsaliye referansı çözülemeyen KDV (1/5) ödemeleri; tahsise girmez. Liste: Tahsilat Detayı Excel’i → “Eşleşmemiş Ödemeler”.',
      href: '/api/export/tahsilat-detay',
      eylem: 'Excel’i indir',
      indir: true,
    },
    {
      ad: 'Sorumlusu olmayan firma',
      sayi: o.firmalar.sorumlusuz,
      aciklama: 'Pazarlamacı atanmamış; yalnız yönetim rolleri görür.',
      href: '/yonetim/bayiler',
      eylem: 'Bayi listesine git',
    },
    {
      ad: 'Sorumlusu kullanıcıyla eşleşmeyen firma',
      sayi: o.firmalar.sorumlu_eslesmeyen,
      aciklama:
        o.eslesmeyen_sorumlular.length > 0
          ? `Bu e-postalarla aktif kullanıcı yok: ${o.eslesmeyen_sorumlular.slice(0, 4).join(', ')}${o.eslesmeyen_sorumlular.length > 4 ? '…' : ''}`
          : 'Firmadaki sorumlu e-postasıyla açılmış aktif kullanıcı yok; o firmaları kimse görmüyor.',
      href: '/yonetim/bayiler',
      eylem: 'Eşleşmeleri gör',
    },
  ]
}

export default async function YonetimGenelBakis() {
  const session = await requireRole(['yonetici', 'tahsilat_yoneticisi'])
  const supabase = await createServerSupabase()

  let ozet: YonetimOzeti | null
  try {
    ozet = await yonetimOzeti(supabase)
  } catch (e) {
    if (isMissingRelationError(e)) return <MigrationNeeded />
    throw e
  }
  if (!ozet) return <MigrationNeeded />

  const saglik = saglikListesi(ozet)
  const sorunlu = saglik.filter((s) => s.sayi > 0).length
  const hesaptaki = ozet.kategoriler.filter((k) => k.acik > 0 || k.aktif)
  const enBuyuk = Math.max(1, ...hesaptaki.map((k) => k.acik))
  const toplamAcik = hesaptaki.reduce((t, k) => t + k.acik, 0)
  const kosu = ozet.son_kosu

  return (
    <div className="space-y-6">
      <PageHeader
        title="Genel Bakış"
        description="Sistemin anlık durumu. Sorun gösteren her satır, düzeltileceği sayfaya götürür."
        actions={
          <>
            <a href="/api/export/borclar" className={buttonClass('secondary', 'md')}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Borç Raporu
            </a>
            <RecomputeButton />
          </>
        }
      />

      {/* Üst şerit */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OzetKutusu
          ikon={<Users className="h-4 w-4" />}
          baslik="Aktif kullanıcı"
          deger={String(ozet.kullanicilar.aktif)}
          alt={`${ozet.kullanicilar.yonetici} yönetici · ${ozet.kullanicilar.tahsilat_yoneticisi} tahsilat · ${ozet.kullanicilar.pazarlamaci} pazarlamacı`}
          href={isAdminRole(session.role) ? '/yonetim/kullanicilar' : undefined}
        />
        <OzetKutusu
          ikon={<Building2 className="h-4 w-4" />}
          baslik="Firma"
          deger={String(ozet.firmalar.toplam)}
          alt={`${ozet.firmalar.takip_disi} tanesi takip dışı`}
          href="/firmalar"
        />
        <OzetKutusu
          ikon={<Activity className="h-4 w-4" />}
          baslik="Son tam hesap"
          deger={kosu ? trDateTime(kosu.started_at) : '—'}
          alt={kosu ? `${TETIK[kosu.trigger_kind] ?? kosu.trigger_kind} · ${kosu.triggered_by ?? '—'}` : 'Henüz hesap yapılmadı'}
          kucukDeger
        />
        <OzetKutusu
          ikon={<Receipt className="h-4 w-4" />}
          baslik="Hesaptaki açık borç"
          deger={eur(toplamAcik)}
          alt={`${hesaptaki.length} kategori`}
          href="/yonetim/kategoriler"
          kucukDeger
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-5">
        {/* Veri sağlığı */}
        <Card className="xl:col-span-3" padded={false}>
          <div className="border-b border-slate-100 px-5 py-4">
            <CardTitle
              icon={<Activity className="h-4 w-4" />}
              sub={sorunlu === 0 ? 'Her şey yolunda görünüyor.' : `${sorunlu} başlıkta bakılması gereken kayıt var.`}
            >
              Veri sağlığı
            </CardTitle>
          </div>
          <ul className="divide-y divide-slate-100">
            {saglik.map((s) => (
              <li key={s.ad} className="flex items-start gap-3 px-5 py-3">
                {s.sayi === 0 ? (
                  <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-label="Sorun yok" />
                ) : (
                  <TriangleAlert className={'mt-0.5 h-5 w-5 shrink-0 ' + (s.ciddi ? 'text-red-500' : 'text-amber-500')} aria-label="Bakılmalı" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className={s.sayi === 0 ? 'text-slate-500' : 'font-medium text-slate-900'}>{s.ad}</span>
                    <span className={'tabular-nums font-semibold ' + (s.sayi === 0 ? 'text-slate-400' : s.ciddi ? 'text-red-600' : 'text-amber-700')}>
                      {s.sayi.toLocaleString('tr-TR')}
                    </span>
                    {s.ek && <span className="text-xs text-slate-500">{s.ek}</span>}
                  </p>
                  {s.sayi > 0 && <p className="mt-0.5 text-xs text-slate-500">{s.aciklama}</p>}
                </div>
                {s.sayi > 0 &&
                  (s.indir ? (
                    <a href={s.href} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">
                      {s.eylem} <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  ) : (
                    <Link href={s.href} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">
                      {s.eylem} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  ))}
              </li>
            ))}
          </ul>
        </Card>

        {/* Kategori bazında açık borç */}
        <Card className="xl:col-span-2">
          <CardTitle
            icon={<Tags className="h-4 w-4" />}
            sub="Bugün itibarıyla ödenmemiş taksitler; koyu kısım vadesi geçmiş olan."
            action={
              <Link href="/yonetim/kategoriler" className="text-xs font-semibold text-blue-700 hover:underline">
                Kategoriler →
              </Link>
            }
          >
            Kategori bazında açık borç
          </CardTitle>
          <ul className="mt-4 space-y-3.5">
            {hesaptaki.length === 0 && <li className="text-sm text-slate-400">Hesaba katılan kategori yok.</li>}
            {hesaptaki.map((k) => {
              const renk = renkOf(k.renk)
              const davranis = DAVRANISLAR[davranisOf(k.taraf)].kisa
              const oran = (k.acik / enBuyuk) * 100
              const gecOran = k.acik > 0 ? (k.gecikmis / k.acik) * 100 : 0
              return (
                <li key={k.kod}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={'h-2.5 w-2.5 shrink-0 rounded-full ' + renk.nokta} aria-hidden="true" />
                      <span className="truncate font-medium text-slate-800">{k.ad}</span>
                      {davranis !== k.ad && <span className="text-xs text-slate-400">{davranis}</span>}
                      {!k.aktif && <Badge>pasif</Badge>}
                    </span>
                    <span className="shrink-0 tabular-nums font-semibold text-slate-900" title={eur(k.acik)}>
                      {eurKisa(k.acik)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                    <div className={'relative h-full rounded-full ' + renk.nokta} style={{ width: `${Math.max(oran, k.acik > 0 ? 2 : 0)}%` }}>
                      {k.gecikmis > 0 && <div className="absolute inset-y-0 left-0 rounded-full bg-slate-900/35" style={{ width: `${gecOran}%` }} />}
                    </div>
                  </div>
                  {k.gecikmis > 0 && <p className="mt-1 text-xs text-red-600">Vadesi geçmiş: {eur(k.gecikmis)}</p>}
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        {/* Son içe aktarmalar */}
        <Card padded={false}>
          <div className="border-b border-slate-100 px-5 py-4">
            <CardTitle
              icon={<Upload className="h-4 w-4" />}
              action={
                <Link href="/ice-aktarim" className="text-xs font-semibold text-blue-700 hover:underline">
                  İçe Aktarım →
                </Link>
              }
            >
              Son içe aktarmalar
            </CardTitle>
          </div>
          {ozet.son_aktarimlar.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-400">Henüz dosya yüklenmedi.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {ozet.son_aktarimlar.map((a) => {
                const durum = AKTARIM_DURUMU[a.status] ?? { ad: a.status, ton: 'gray' as const }
                return (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                    <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800" title={a.filename ?? ''}>
                        {AKTARIM_TURU[a.kind] ?? a.kind}
                        <span className="font-normal text-slate-500"> · {a.filename ?? 'dosya'}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {trDateTime(a.committed_at ?? a.created_at)} · {a.uploaded_by ?? '—'}
                      </p>
                    </div>
                    <Badge tone={durum.ton}>{durum.ad}</Badge>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* Son değişiklikler */}
        <Card padded={false}>
          <div className="border-b border-slate-100 px-5 py-4">
            <CardTitle
              icon={<History className="h-4 w-4" />}
              action={
                <Link href="/yonetim/denetim" className="text-xs font-semibold text-blue-700 hover:underline">
                  Denetim Kaydı →
                </Link>
              }
            >
              Son değişiklikler
            </CardTitle>
          </div>
          {ozet.son_degisiklikler.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-400">Henüz kayıt yok.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {ozet.son_degisiklikler.map((d) => {
                const islem = islemEtiketi(d.action)
                const alan = alanEtiketi(d.field)
                const kayit = kayitYazisi(d.entity_type, d.entity_id)
                return (
                  <li key={d.id} className="flex items-start gap-3 px-5 py-2.5">
                    <Badge tone={islem.ton} className="mt-0.5">
                      {islem.ad}
                    </Badge>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="truncate text-slate-800">
                        <span className="text-slate-500">{kayit.tur}</span> {kayit.kimlik}
                        {alan && <span className="text-slate-400"> · {alan}</span>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {trDateTime(d.created_at)} · {d.actor_email ?? 'sistem'}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
        Sayılar 31/12 kayıtlarını, iptal edilenleri ve takip dışı firmaları içermez.
        <CalendarX className="h-3.5 w-3.5" aria-hidden="true" />
        Gecikme bugüne göre hesaplanır.
      </p>
    </div>
  )
}

function OzetKutusu({
  ikon,
  baslik,
  deger,
  alt,
  href,
  kucukDeger,
}: {
  ikon: React.ReactNode
  baslik: string
  deger: string
  alt: string
  href?: string
  kucukDeger?: boolean
}) {
  const icerik = (
    <>
      <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <span className="text-slate-400">{ikon}</span>
        {baslik}
      </p>
      <p className={'mt-2 font-bold tabular-nums text-slate-900 ' + (kucukDeger ? 'text-lg' : 'text-2xl')}>{deger}</p>
      <p className="mt-1 truncate text-xs text-slate-500" title={alt}>
        {alt}
      </p>
    </>
  )
  const sinif = 'block rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70'
  return href ? (
    <Link href={href} className={sinif + ' transition-colors hover:ring-blue-300'}>
      {icerik}
    </Link>
  ) : (
    <div className={sinif}>{icerik}</div>
  )
}
