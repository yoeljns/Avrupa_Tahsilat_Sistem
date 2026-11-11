'use client'

import { Fragment, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import Link from 'next/link'
import { Eye, EyeOff, Printer } from 'lucide-react'
import Button from '@/components/ui/Button'
import IndirDugmesi from '@/components/ui/IndirDugmesi'
import { RENK, gunAyEtiketi } from '@/lib/bakiye/bicim'
import {
  BAKIYE_SIRALAMA_ETIKETLERI,
  BOS_BAKIYE_SUZGEC,
  SORUMLUSUZ,
  bakiyeGorunumu,
  bakiyeSorumlulari,
  type AyGrubu,
  type BakiyeModeli,
  type BakiyeSatiri,
  type BakiyeSiralama,
  type BakiyeSuzgec,
} from '@/lib/bakiye/model'
import { suzgecSorgusu, vadeliBakiyelerDosyaAdi } from '@/lib/bakiye/suzgecParam'
import { formatCents } from '@/lib/engine/money'

// BAKİYE TABLOSU — elle tutulan "Vadeli Bakiyeler" Excel sayfasının ekrandaki karşılığı.
// Sütun düzeni ve renkler Excel çıktısıyla AYNI modelden ve AYNI renk sabitlerinden gelir
// (src/lib/bakiye/model.ts, bicim.ts). Dosyadaki davranışların karşılıkları:
//   * donmuş bölme      → yapışkan başlık satırları ve sol sütunlar
//   * gizli sütunlar    → kapanmış aylar kapalı gelir, düğmeyle açılır
//   * hücre notu        → köşe işareti; üzerine gelince / dokununca ayrıntı
//   * seçili satır makrosu → tıklanan satır sarıya boyanır

interface Props {
  model: BakiyeModeli
  /** kategori kodu → okunur ad (başlık ipuçları) */
  kategoriAdlari: Record<string, string>
  /** Sorumlu süzgeci yalnız tüm firmaları gören rollerde anlamlı */
  sorumluSuzgeci: boolean
}

type Sutun = { tur: 'ay'; i: number; ay: AyGrubu } | { tur: 'birikimli' }

interface NotBalonu {
  /** tıklanan hücrenin sol ve alt kenarı (ekran konumu) */
  x: number
  y: number
  baslik: string
  satirlar: string[]
}

const zemin = (rrggbb: string): CSSProperties => ({ backgroundColor: '#' + rrggbb })
/** tıklanan satır: dosyadaki makronun sarısı + üstte ve altta koyu çizgi (sarı ay sütunlarından ayrışsın) */
const SECILI: CSSProperties = { backgroundColor: '#' + RENK.seciliSatir, boxShadow: 'inset 0 2px 0 0 #0f172a, inset 0 -2px 0 0 #0f172a' }

// Başlık satırı yükseklikleri sabittir: 2. ve 3. satır bir öncekinin hemen altına yapışır.
const UST = ['top-0 h-[26px]', 'top-[26px] h-[22px]', 'top-[48px] h-[24px]'] as const
const HUCRE = 'border-r border-b border-slate-300 px-2 whitespace-nowrap tabular-nums'
const BASLIK = 'sticky z-20 border-r border-slate-300 px-2 text-center text-[11px] font-bold whitespace-nowrap text-slate-900'

// Sol sabit sütunlar. Telefonda yalnız firma sütunu yapışır; geniş ekranda (xl) üç toplam sütunu da.
const SABIT = {
  sorumlu: 'hidden md:table-cell md:sticky md:left-0 md:w-[88px] md:min-w-[88px] md:max-w-[88px]',
  firma:
    'sticky left-0 w-[150px] min-w-[150px] max-w-[150px] border-r-2 border-r-slate-500 md:left-[88px] md:w-[240px] md:min-w-[240px] md:max-w-[240px] xl:border-r xl:border-r-slate-300',
  satis: 'w-[108px] min-w-[108px] xl:sticky xl:left-[328px]',
  odeme: 'w-[108px] min-w-[108px] xl:sticky xl:left-[436px]',
  kalan: 'w-[108px] min-w-[108px] xl:sticky xl:left-[544px] xl:border-r-2 xl:border-r-slate-500',
} as const

function tutar(v: number): string {
  return v === 0 ? '' : formatCents(v)
}

/** KALAN hücresi: sıfır soluk yazılır, eksi kırmızı (dosyadaki sayı biçimi) */
function KalanYazisi({ v }: { v: number }) {
  if (v === 0) return <span className="opacity-30">0,00</span>
  return <span className={v < 0 ? 'text-red-600' : ''}>{formatCents(v)}</span>
}

interface SatirProps {
  s: BakiyeSatiri
  sutunlar: Sutun[]
  secili: boolean
  onSec: (id: string) => void
  onNot: (e: MouseEvent<HTMLElement>, firmaId: string, baslik: string, satirlar: string[]) => void
}

const Satir = memo(function Satir({ s, sutunlar, secili, onSec, onNot }: SatirProps) {
  const sec = secili ? SECILI : undefined
  const beyaz = secili ? SECILI : zemin(RENK.beyaz)
  return (
    <tr onClick={() => onSec(s.firm_id)} aria-selected={secili} className="cursor-pointer">
      <td
        className={HUCRE + ' z-10 py-1 text-left text-[11px] font-bold ' + SABIT.sorumlu}
        style={{ ...beyaz, color: '#' + (s.sorumluBlok % 2 === 0 ? RENK.kirmizi : RENK.siyah) }}
      >
        {s.sorumlu ?? ''}
      </td>
      <td className={HUCRE + ' z-10 py-1 text-left ' + SABIT.firma} style={beyaz}>
        <div className="flex min-w-0 items-baseline gap-1.5">
          <Link href={`/firmalar/${s.firm_id}`} onClick={(e) => e.stopPropagation()} className="shrink-0 font-semibold text-blue-700 hover:underline">
            {s.kod}
          </Link>
          <span className="truncate text-slate-800" title={s.ad}>
            {s.ad}
          </span>
        </div>
        {s.sorumlu && <div className="truncate text-[10px] font-semibold tracking-wide text-slate-400 md:hidden">{s.sorumlu}</div>}
      </td>
      <td className={HUCRE + ' z-10 py-1 text-right font-bold ' + SABIT.satis} style={sec ?? zemin(RENK.mavi)}>
        {tutar(s.toplamBorc)}
      </td>
      <td className={HUCRE + ' z-10 py-1 text-right font-bold ' + SABIT.odeme} style={beyaz}>
        {tutar(s.toplamOdeme)}
      </td>
      <td className={HUCRE + ' z-10 py-1 text-right font-bold ' + SABIT.kalan} style={sec ?? zemin(RENK.kalanBorc)}>
        <KalanYazisi v={s.toplamKalan} />
        {s.gecikmis > 0 && <div className="text-[10px] leading-tight font-semibold text-red-700">{formatCents(s.gecikmis)} gecikmiş</div>}
      </td>

      {sutunlar.map((st) => {
        if (st.tur === 'birikimli') {
          return (
            <td key="birikimli" className={HUCRE + ' border-r-2 border-r-slate-500 py-1 text-right font-bold'} style={sec ?? zemin(RENK.birikimli)}>
              <KalanYazisi v={s.birikimli} />
            </td>
          )
        }
        const h = s.aylar[st.i]
        return (
          <Fragment key={st.ay.ay}>
            {st.ay.borcSutunlari.map((b, j) => {
              const notlar = h?.notlar[j] ?? null
              return (
                <td
                  key={b.anahtar}
                  className={HUCRE + ' yalniz-ekran relative py-1 text-right' + (notlar ? ' cursor-help' : '')}
                  style={beyaz}
                  title={notlar ? notlar.join('\n') : undefined}
                  onClick={notlar ? (e) => onNot(e, s.firm_id, `${s.kod} · ${st.ay.ad} ${b.etiket}`, notlar) : undefined}
                >
                  {h ? tutar(h.borc[j]) : ''}
                  {notlar && (
                    <span
                      aria-label="Not var"
                      className="absolute top-0 right-0 h-0 w-0 border-t-[7px] border-l-[7px] border-t-red-600 border-l-transparent"
                    />
                  )}
                </td>
              )
            })}
            <td className={HUCRE + ' yalniz-ekran py-1 text-right text-emerald-800'} style={beyaz}>
              {h ? tutar(h.odeme) : ''}
            </td>
            <td className={HUCRE + ' border-r-2 border-r-slate-500 py-1 text-right font-bold'} style={sec ?? zemin(RENK[st.ay.renk])}>
              {h ? <KalanYazisi v={h.kalan} /> : ''}
            </td>
          </Fragment>
        )
      })}
    </tr>
  )
})

export default function BakiyeTablosu({ model, kategoriAdlari, sorumluSuzgeci }: Props) {
  const [suzgec, setSuzgec] = useState<BakiyeSuzgec>(BOS_BAKIYE_SUZGEC)
  const [siralama, setSiralama] = useState<BakiyeSiralama>('sorumlu')
  const [kapananlarAcik, setKapananlarAcik] = useState(false)
  const [seciliId, setSeciliId] = useState<string | null>(null)
  const [balon, setBalon] = useState<NotBalonu | null>(null)
  const kutuRef = useRef<HTMLDivElement>(null)

  // Arama kutusu akıcı kalsın: tablo, yazı bittikten sonra yeniden çizilir
  const gecikmeliSuzgec = useDeferredValue(suzgec)
  const gorunum = useMemo(() => bakiyeGorunumu(model, gecikmeliSuzgec, siralama), [model, gecikmeliSuzgec, siralama])
  const sorumlular = useMemo(() => bakiyeSorumlulari(model), [model])
  const sorumlusuzVar = useMemo(() => model.satirlar.some((s) => s.sorumlu === null), [model])
  const gizliAdet = gorunum.aylar.filter((a) => a.gizli).length

  const sutunlar = useMemo(() => {
    const liste: Sutun[] = []
    gorunum.aylar.forEach((ay, i) => {
      if (!ay.gizli || kapananlarAcik) liste.push({ tur: 'ay', i, ay })
      if (gorunum.birikimliSonrasi === i) liste.push({ tur: 'birikimli' })
    })
    return liste
  }, [gorunum, kapananlarAcik])

  const sec = useCallback((id: string) => setSeciliId((onceki) => (onceki === id ? null : id)), [])
  const notAc = useCallback((e: MouseEvent<HTMLElement>, firmaId: string, baslik: string, satirlar: string[]) => {
    // Not hücresine tıklamak satırı İŞARETLER (işareti kaldırmaz) ve notu açar
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    setSeciliId(firmaId)
    setBalon({ x: r.left, y: r.bottom, baslik, satirlar })
  }, [])

  // Not balonu: Esc ile ya da tablo kaydırılınca kapanır
  useEffect(() => {
    if (!balon) return
    const kapat = () => setBalon(null)
    const tus = (e: KeyboardEvent) => e.key === 'Escape' && kapat()
    const kutu = kutuRef.current
    // Balon açıldığı andaki konum: yalnız GERÇEKTEN kaydırılınca kapanır
    // (tıklamadan hemen önceki kaydırmanın gecikmeli olayı balonu kapatmasın)
    const [sol, ust] = [kutu?.scrollLeft ?? 0, kutu?.scrollTop ?? 0]
    const kaydi = () => {
      if (kutu && (Math.abs(kutu.scrollLeft - sol) > 2 || Math.abs(kutu.scrollTop - ust) > 2)) kapat()
    }
    window.addEventListener('keydown', tus)
    window.addEventListener('resize', kapat)
    kutu?.addEventListener('scroll', kaydi, { passive: true })
    return () => {
      window.removeEventListener('keydown', tus)
      window.removeEventListener('resize', kapat)
      kutu?.removeEventListener('scroll', kaydi)
    }
  }, [balon])

  // Yazdırma: ay başına yalnız KALAN sütunu basılır (bkz. globals.css → .bakiye-tablosu);
  // tablo A4 yatay sayfaya sığacak kadar küçültülür. Genişlik basılacak sütunlardan hesaplanır
  // (yazdırma düzeni 'beforeprint' anında henüz uygulanmamıştır, ölçülemez).
  const yazdirmaGenisligi = 88 + 240 + 3 * 108 + sutunlar.reduce((a, st) => a + (st.tur === 'ay' ? 92 : 96), 0)
  useEffect(() => {
    const once = () => {
      const sayfaGenisligi = 1040 // A4 yatay, 8 mm kenar boşluğu, 96 dpi
      const oran = Math.min(1, sayfaGenisligi / yazdirmaGenisligi)
      kutuRef.current?.style.setProperty('zoom', String(Math.max(0.4, oran)))
    }
    const sonra = () => kutuRef.current?.style.removeProperty('zoom')
    window.addEventListener('beforeprint', once)
    window.addEventListener('afterprint', sonra)
    return () => {
      window.removeEventListener('beforeprint', once)
      window.removeEventListener('afterprint', sonra)
    }
  }, [yazdirmaGenisligi])

  if (model.satirlar.length === 0) {
    return <p className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm">Bu görünümde konsinye borç hareketi yok.</p>
  }

  const suzgecVar = suzgec.arama !== '' || suzgec.sorumlu !== '' || suzgec.yalnizGecikmis || suzgec.bitenleriGizle
  const t = gorunum.toplam
  const firmaSayisi = gorunum.satirlar.length

  return (
    <div>
      {/* Araç çubuğu */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <input
          type="search"
          value={suzgec.arama}
          onChange={(e) => setSuzgec({ ...suzgec, arama: e.target.value })}
          placeholder="Firma ara (kod ya da ad)"
          aria-label="Firma ara"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none sm:w-60"
        />
        {sorumluSuzgeci && sorumlular.length > 0 && (
          <select
            value={suzgec.sorumlu}
            onChange={(e) => setSuzgec({ ...suzgec, sorumlu: e.target.value })}
            aria-label="Sorumlu"
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
          >
            <option value="">Tüm sorumlular</option>
            {sorumlular.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {sorumlusuzVar && <option value={SORUMLUSUZ}>Sorumlusu olmayanlar</option>}
          </select>
        )}
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-1 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={suzgec.yalnizGecikmis}
            onChange={(e) => setSuzgec({ ...suzgec, yalnizGecikmis: e.target.checked })}
            className="h-4 w-4 accent-red-600"
          />
          Yalnız gecikmiş
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-1 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={suzgec.bitenleriGizle}
            onChange={(e) => setSuzgec({ ...suzgec, bitenleriGizle: e.target.checked })}
            className="h-4 w-4 accent-blue-600"
          />
          Borcu bitenleri gizle
        </label>
        <select
          value={siralama}
          onChange={(e) => setSiralama(e.target.value as BakiyeSiralama)}
          aria-label="Sıralama"
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
        >
          {(Object.keys(BAKIYE_SIRALAMA_ETIKETLERI) as BakiyeSiralama[]).map((k) => (
            <option key={k} value={k}>
              Sırala: {BAKIYE_SIRALAMA_ETIKETLERI[k]}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          {gizliAdet > 0 && (
            <Button
              size="sm"
              onClick={() => setKapananlarAcik((v) => !v)}
              aria-pressed={kapananlarAcik}
              icon={kapananlarAcik ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              title="Borcu tamamen kapanmış geçmiş aylar (Excel dosyasında gizli sütunlar)"
            >
              {kapananlarAcik ? 'Kapanan ayları gizle' : `Kapanan ayları göster (${gizliAdet})`}
            </Button>
          )}
          <Button size="sm" onClick={() => window.print()} icon={<Printer className="h-4 w-4" aria-hidden="true" />} className="hidden md:inline-flex">
            Yazdır
          </Button>
          <IndirDugmesi
            url={'/api/export/vadeli-bakiyeler' + suzgecSorgusu(suzgec)}
            yedekAd={vadeliBakiyelerDosyaAdi(model.bugun, suzgec)}
            variant="primary"
            title="Bu tabloyu, ekrandaki süzgeçlerle, Excel dosyası olarak indir"
          >
            Excel&apos;e aktar
          </IndirDugmesi>
        </div>
      </div>

      {/* Lejant + sayaç */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 print:hidden">
        <span>
          <strong className="font-semibold text-slate-700">VADELİ</strong> = Konsinye · <strong className="font-semibold text-slate-700">PEŞİN</strong> = Konsinye Peşin
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0 w-0 border-t-[7px] border-l-[7px] border-t-red-600 border-l-transparent" />
          başlıktaki tarihten farklı vade (üzerine gelin ya da dokunun)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm ring-1 ring-slate-300" style={zemin(RENK.birikimli)} />
          bu aya kadar kalan
        </span>
        <span className="sm:ml-auto">
          {firmaSayisi === model.satirlar.length ? `${firmaSayisi} firma` : `${firmaSayisi} / ${model.satirlar.length} firma`} · tutarlar avro · satıra tıklayınca
          işaretlenir
        </span>
      </div>

      {firmaSayisi === 0 ? (
        <div className="mt-3 rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm">
          Süzgeçlere uyan firma yok.{' '}
          {suzgecVar && (
            <button type="button" onClick={() => setSuzgec(BOS_BAKIYE_SUZGEC)} className="font-medium text-blue-700 hover:underline">
              Süzgeçleri temizle
            </button>
          )}
        </div>
      ) : (
        <div
          ref={kutuRef}
          className="mt-3 max-h-[calc(100vh-7rem)] overflow-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-300 print:max-h-none print:overflow-visible print:rounded-none print:shadow-none print:ring-0"
        >
          <table className="bakiye-tablosu border-separate border-spacing-0 text-xs text-slate-900">
            <caption className="sr-only">Vadeli bakiyeler: firma başına aylık vadeli ve peşin borç, ödeme ve kalan</caption>
            <thead>
              {[0, 1, 2].map((satir) => (
                <tr key={satir}>
                  {/* Sol sabit sütunlar: ilk iki başlık satırı boş, üçüncüde adlar */}
                  {(
                    [
                      ['sorumlu', 'SORUMLU', 'text-left'],
                      ['firma', 'FİRMA ADI', 'text-left'],
                      ['satis', 'TOPLAM SATIŞ', 'text-center'],
                      ['odeme', 'ÖDEMELER', 'text-center'],
                      ['kalan', 'KALAN BORÇ', 'text-center'],
                    ] as const
                  ).map(([anahtar, ad, hiza]) => (
                    <th
                      key={anahtar}
                      scope={satir === 2 ? 'col' : undefined}
                      className={
                        BASLIK +
                        ' z-30 bg-white ' +
                        hiza +
                        ' ' +
                        UST[satir] +
                        ' ' +
                        SABIT[anahtar] +
                        (satir === 2 ? ' border-b-2 border-b-slate-600' : '')
                      }
                    >
                      {satir === 2 ? ad : ''}
                    </th>
                  ))}

                  {sutunlar.map((st) => {
                    if (st.tur === 'birikimli') {
                      return (
                        <th
                          key="birikimli"
                          scope={satir === 2 ? 'col' : undefined}
                          className={BASLIK + ' min-w-[96px] border-r-2 border-r-slate-500 ' + UST[satir] + (satir === 2 ? ' border-b-2 border-b-slate-600 bg-white' : '')}
                          style={satir < 2 ? zemin(RENK.birikimli) : undefined}
                          title="Bu aya kadar (bu ay dahil) açık kalan borç"
                        >
                          {gorunum.birikimliBaslik[satir]}
                        </th>
                      )
                    }
                    const renk = satir < 2 ? zemin(RENK[st.ay.renk]) : undefined
                    const alt = satir === 2 ? ' border-b-2 border-b-slate-600 bg-white' : ''
                    return (
                      <Fragment key={st.ay.ay}>
                        {st.ay.borcSutunlari.map((b) => (
                          <th
                            key={b.anahtar}
                            scope={satir === 2 ? 'col' : undefined}
                            className={BASLIK + ' yalniz-ekran min-w-[86px] ' + UST[satir] + alt}
                            style={renk}
                            title={`${st.ay.ad} · ${kategoriAdlari[b.kategori] ?? b.kategori} · başlık tarihi ${gunAyEtiketi(b.tarih)}`}
                          >
                            {satir === 0 ? gunAyEtiketi(b.tarih) : satir === 1 ? b.etiket : 'BORÇ'}
                          </th>
                        ))}
                        <th scope={satir === 2 ? 'col' : undefined} className={BASLIK + ' yalniz-ekran min-w-[86px] ' + UST[satir] + alt} style={renk}>
                          {satir === 2 ? 'ÖDEME' : ''}
                        </th>
                        <th
                          scope={satir === 2 ? 'col' : undefined}
                          className={BASLIK + ' min-w-[92px] border-r-2 border-r-slate-500 ' + UST[satir] + alt}
                          style={renk}
                        >
                          {satir === 0 ? st.ay.ad : satir === 1 ? 'TOPLAM' : 'KALAN'}
                        </th>
                      </Fragment>
                    )
                  })}
                </tr>
              ))}
            </thead>

            <tbody>
              {gorunum.satirlar.map((s) => (
                <Satir key={s.firm_id} s={s} sutunlar={sutunlar} secili={s.firm_id === seciliId} onSec={sec} onNot={notAc} />
              ))}
            </tbody>

            <tfoot>
              {/* TOPLAM satırı */}
              <tr>
                <td className={HUCRE + ' sticky bottom-[26px] z-30 h-[30px] border-t-2 border-t-slate-600 bg-white ' + SABIT.sorumlu} />
                <td className={HUCRE + ' sticky bottom-[26px] z-30 h-[30px] border-t-2 border-t-slate-600 bg-white text-left font-bold ' + SABIT.firma}>
                  TOPLAM <span className="font-normal text-slate-500">· {firmaSayisi} firma</span>
                </td>
                <td className={HUCRE + ' sticky bottom-[26px] z-20 h-[30px] border-t-2 border-t-slate-600 text-right font-bold xl:z-30 ' + SABIT.satis} style={zemin(RENK.mavi)}>
                  {formatCents(t.borc)}
                </td>
                <td className={HUCRE + ' sticky bottom-[26px] z-20 h-[30px] border-t-2 border-t-slate-600 bg-white text-right font-bold xl:z-30 ' + SABIT.odeme}>
                  {formatCents(t.odeme)}
                </td>
                <td className={HUCRE + ' sticky bottom-[26px] z-20 h-[30px] border-t-2 border-t-slate-600 text-right font-bold xl:z-30 ' + SABIT.kalan} style={zemin(RENK.kalanBorc)}>
                  <KalanYazisi v={t.kalan} />
                </td>
                {sutunlar.map((st) => {
                  if (st.tur === 'birikimli') {
                    return (
                      <td
                        key="birikimli"
                        className={HUCRE + ' sticky bottom-[26px] z-20 h-[30px] border-t-2 border-r-2 border-t-slate-600 border-r-slate-500 text-right font-bold'}
                        style={zemin(RENK.birikimli)}
                      >
                        <KalanYazisi v={t.birikimli} />
                      </td>
                    )
                  }
                  const renk = zemin(RENK[st.ay.renk])
                  const sinif = HUCRE + ' sticky bottom-[26px] z-20 h-[30px] border-t-2 border-t-slate-600 text-right font-bold'
                  return (
                    <Fragment key={st.ay.ay}>
                      {st.ay.borcSutunlari.map((b, j) => (
                        <td key={b.anahtar} className={sinif + ' yalniz-ekran'} style={renk}>
                          {tutar(st.ay.toplam.borc[j])}
                        </td>
                      ))}
                      <td className={sinif + ' yalniz-ekran'} style={renk}>
                        {tutar(st.ay.toplam.odeme)}
                      </td>
                      <td className={sinif + ' border-r-2 border-r-slate-500'} style={renk}>
                        <KalanYazisi v={st.ay.toplam.kalan} />
                      </td>
                    </Fragment>
                  )
                })}
              </tr>
              {/* Ayın kalanı: dosyadaki son satır (ay başına birleşik hücre). Yazdırmada basılmaz:
                  aynı tutar TOPLAM satırının KALAN hücresindedir. */}
              <tr className="yalniz-ekran">
                <td className={'sticky bottom-0 z-30 h-[26px] border-r border-slate-300 bg-white ' + SABIT.sorumlu} />
                <td className={'sticky bottom-0 z-30 h-[26px] bg-white px-2 text-left text-[11px] font-semibold text-slate-500 ' + SABIT.firma}>Ayın kalanı</td>
                <td className={'sticky bottom-0 z-20 h-[26px] border-r border-slate-300 bg-white xl:z-30 ' + SABIT.satis} />
                <td className={'sticky bottom-0 z-20 h-[26px] border-r border-slate-300 bg-white xl:z-30 ' + SABIT.odeme} />
                <td className={'sticky bottom-0 z-20 h-[26px] border-r border-slate-300 bg-white xl:z-30 ' + SABIT.kalan} />
                {sutunlar.map((st) =>
                  st.tur === 'birikimli' ? (
                    <td key="birikimli" className="sticky bottom-0 z-20 h-[26px] border-r-2 border-r-slate-500" style={zemin(RENK.birikimli)} />
                  ) : (
                    <td
                      key={st.ay.ay}
                      colSpan={st.ay.borcSutunlari.length + 2}
                      className="sticky bottom-0 z-20 h-[26px] border-r-2 border-r-slate-500 px-2 text-center font-bold whitespace-nowrap tabular-nums"
                      style={zemin(RENK[st.ay.renk])}
                    >
                      <KalanYazisi v={st.ay.toplam.kalan} />
                    </td>
                  ),
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mt-2 hidden text-[10px] text-slate-500 print:block">
        Yazdırma görünümü: her ayın KALAN tutarı. Borç ve ödeme sütunlarıyla tam tablo için &quot;Excel&apos;e aktar&quot; düğmesini kullanın.
      </p>

      {balon && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setBalon(null)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Hücre notu"
            className="fixed z-50 w-64 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-slate-800 shadow-xl"
            style={{
              left: Math.max(8, Math.min(balon.x, window.innerWidth - 264)),
              ...(balon.y + 140 < window.innerHeight ? { top: balon.y + 6 } : { bottom: window.innerHeight - balon.y + 34 }),
            }}
          >
            <p className="font-semibold text-slate-900">{balon.baslik}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">Sütun başlığındaki tarihten farklı vadeler:</p>
            <ul className="mt-1.5 space-y-0.5 tabular-nums">
              {balon.satirlar.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
