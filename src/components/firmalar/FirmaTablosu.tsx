'use client'

import Link from 'next/link'
import { useDeferredValue, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { eur, trDate } from '@/lib/format'
import {
  BOS_FIRMA_SUZGECI,
  FIRMA_DURUM_ETIKETLERI,
  SORUMLUSUZ_FIRMA,
  VARSAYILAN_FIRMA_SIRALAMASI,
  firmaSorumlulari,
  firmaSorumlusu,
  firmaToplamBorcu,
  firmaToplami,
  firmalariSirala,
  firmalariSuz,
  siralamaDegistir,
  type FirmaDurumu,
  type FirmaSiralama,
  type FirmaSiralamaAlani,
  type FirmaSuzgeci,
} from '@/lib/firmaListe'
import type { FirmaListeSatiri } from '@/lib/queries'

// FİRMALAR LİSTESİ — arama, durum ve sorumlu süzgeçleri, başlığa tıklayarak
// sıralama, sabit başlık ve toplam satırı. Liste sunucudan tek seferde gelir;
// süzme ve sıralama tarayıcıda yapılır (src/lib/firmaListe.ts).

interface Props {
  firmalar: FirmaListeSatiri[]
  /** Sorumlu süzgeci yalnız tüm firmaları gören rollerde anlamlı */
  sorumluSuzgeci: boolean
}

interface SutunTanimi {
  alan: FirmaSiralamaAlani
  ad: string
  hiza: 'left' | 'right'
  /** dar ekranda gizlenir */
  genisEkran?: boolean
}

const SUTUNLAR: SutunTanimi[] = [
  { alan: 'kod', ad: 'Kod', hiza: 'left' },
  { alan: 'ad', ad: 'Firma', hiza: 'left' },
  { alan: 'sehir', ad: 'Şehir', hiza: 'left', genisEkran: true },
  { alan: 'sorumlu', ad: 'Sorumlu', hiza: 'left' },
  { alan: 'pesin', ad: 'Peşin borç', hiza: 'right', genisEkran: true },
  { alan: 'vadeli', ad: 'Konsinye borç', hiza: 'right', genisEkran: true },
  { alan: 'toplam', ad: 'Toplam borç', hiza: 'right' },
  { alan: 'gecikmis', ad: 'Vadesi geçmiş', hiza: 'right' },
  { alan: 'alacak', ad: 'Alacak', hiza: 'right' },
  { alan: 'ilk_vade', ad: 'İlk vade', hiza: 'right', genisEkran: true },
]

const TH = 'sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold whitespace-nowrap text-slate-600'
const TD = 'border-b border-slate-100 px-3 py-2 whitespace-nowrap'
const TF = 'sticky bottom-0 z-20 border-t-2 border-slate-300 bg-slate-100 px-3 py-2 font-semibold whitespace-nowrap tabular-nums'
const gizle = (s: SutunTanimi) => (s.genisEkran ? ' hidden lg:table-cell' : '')

const tutar = (v: number) => (v > 0 ? eur(v) : <span className="text-slate-300">–</span>)

export default function FirmaTablosu({ firmalar, sorumluSuzgeci }: Props) {
  const [suzgec, setSuzgec] = useState<FirmaSuzgeci>(BOS_FIRMA_SUZGECI)
  const [siralama, setSiralama] = useState<FirmaSiralama>(VARSAYILAN_FIRMA_SIRALAMASI)

  const gecikmeliSuzgec = useDeferredValue(suzgec)
  const satirlar = useMemo(() => firmalariSirala(firmalariSuz(firmalar, gecikmeliSuzgec), siralama), [firmalar, gecikmeliSuzgec, siralama])
  const toplam = useMemo(() => firmaToplami(satirlar), [satirlar])
  const genel = useMemo(() => firmaToplami(firmalar), [firmalar])
  const { sorumlular, sorumlusuzVar } = useMemo(() => firmaSorumlulari(firmalar), [firmalar])
  const suzgecVar = suzgec.arama !== '' || suzgec.durum !== 'hepsi' || suzgec.sorumlu !== ''

  if (firmalar.length === 0) {
    return (
      <p className="mt-4 rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm">
        Henüz firma yok. Bayi listesini ya da irsaliye dosyasını yükleyince firmalar burada listelenir.
      </p>
    )
  }

  // Özet düğmeleri: tıklayınca ilgili durum süzgeci açılır / kapanır
  const ozet: Array<{ durum: FirmaDurumu; ad: string; adet: number; renk: string }> = [
    { durum: 'borclu', ad: 'borcu olan', adet: genel.borclu, renk: 'text-slate-900' },
    { durum: 'gecikmis', ad: 'vadesi geçmiş', adet: genel.geciken, renk: 'text-red-700' },
    { durum: 'alacakli', ad: 'alacaklı', adet: genel.alacakli, renk: 'text-emerald-700' },
  ]

  return (
    <div className="mt-4">
      {/* Araç çubuğu */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={suzgec.arama}
          onChange={(e) => setSuzgec({ ...suzgec, arama: e.target.value })}
          placeholder="Firma ara (kod, ad ya da şehir)"
          aria-label="Firma ara"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none sm:w-72"
        />
        <select
          value={suzgec.durum}
          onChange={(e) => setSuzgec({ ...suzgec, durum: e.target.value as FirmaDurumu })}
          aria-label="Duruma göre süz"
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
        >
          {(Object.keys(FIRMA_DURUM_ETIKETLERI) as FirmaDurumu[]).map((d) => (
            <option key={d} value={d}>
              {FIRMA_DURUM_ETIKETLERI[d]}
            </option>
          ))}
        </select>
        {sorumluSuzgeci && sorumlular.length > 0 && (
          <select
            value={suzgec.sorumlu}
            onChange={(e) => setSuzgec({ ...suzgec, sorumlu: e.target.value })}
            aria-label="Sorumluya göre süz"
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
          >
            <option value="">Tüm sorumlular</option>
            {sorumlular.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {sorumlusuzVar && <option value={SORUMLUSUZ_FIRMA}>Sorumlusu olmayanlar</option>}
          </select>
        )}
        {suzgecVar && (
          <button type="button" onClick={() => setSuzgec(BOS_FIRMA_SUZGECI)} className="rounded-lg px-2 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50">
            Süzgeçleri temizle
          </button>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs sm:ml-auto">
          {ozet.map((o) => (
            <button
              key={o.durum}
              type="button"
              aria-pressed={suzgec.durum === o.durum}
              onClick={() => setSuzgec({ ...suzgec, durum: suzgec.durum === o.durum ? 'hepsi' : o.durum })}
              className={
                'rounded-full px-2.5 py-1 ring-1 transition-colors ' +
                (suzgec.durum === o.durum ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')
              }
            >
              <strong className={'font-semibold ' + (suzgec.durum === o.durum ? '' : o.renk)}>{o.adet}</strong> {o.ad}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-500" aria-live="polite">
        {satirlar.length === firmalar.length ? `${firmalar.length} firma` : `${satirlar.length} / ${firmalar.length} firma`} · takip dışı bırakılanlar gösterilmez · sütun
        başlığına tıklayarak sıralayın
      </p>

      {satirlar.length === 0 ? (
        <div className="mt-3 rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm">
          Süzgeçlere uyan firma yok.{' '}
          <button type="button" onClick={() => setSuzgec(BOS_FIRMA_SUZGECI)} className="font-medium text-blue-700 hover:underline">
            Süzgeçleri temizle
          </button>
        </div>
      ) : (
        <div className="mt-3 max-h-[calc(100vh-13rem)] overflow-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
          <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {SUTUNLAR.map((s) => {
                  const aktif = siralama.alan === s.alan
                  return (
                    <th
                      key={s.alan}
                      scope="col"
                      aria-sort={aktif ? (siralama.yon === 'artan' ? 'ascending' : 'descending') : 'none'}
                      className={TH + (s.hiza === 'right' ? ' text-right' : ' text-left') + gizle(s)}
                    >
                      <button
                        type="button"
                        onClick={() => setSiralama(siralamaDegistir(siralama, s.alan))}
                        className={'inline-flex items-center gap-1 rounded hover:text-slate-900 ' + (aktif ? 'text-blue-700' : '') + (s.hiza === 'right' ? ' flex-row-reverse' : '')}
                        title={`${s.ad} sütununa göre sırala`}
                      >
                        {s.ad}
                        {aktif ? (
                          siralama.yon === 'artan' ? (
                            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />
                        )}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {satirlar.map((f) => {
                const sorumlu = firmaSorumlusu(f)
                return (
                  <tr key={f.id} className="hover:bg-blue-50/40">
                    <td className={TD}>
                      <Link href={`/firmalar/${f.id}`} className="font-semibold text-blue-700 hover:underline">
                        {f.kod}
                      </Link>
                    </td>
                    <td className={TD + ' max-w-[22rem] truncate'} title={f.ad}>
                      <Link href={`/firmalar/${f.id}`} className="text-slate-800 hover:underline">
                        {f.ad}
                      </Link>
                      {f.oto && (
                        <span className="ml-1.5 rounded bg-slate-100 px-1 text-xs text-slate-500" title="Bayi listesinde olmayan, içe aktarmada otomatik oluşturulan firma">
                          oto
                        </span>
                      )}
                    </td>
                    <td className={TD + ' text-slate-500 hidden lg:table-cell'}>{f.sehir ?? ''}</td>
                    <td className={TD + ' text-xs font-semibold tracking-wide text-slate-600'}>{sorumlu ?? <span className="font-normal text-slate-300">—</span>}</td>
                    <td className={TD + ' text-right tabular-nums hidden lg:table-cell'}>{tutar(f.pesin)}</td>
                    <td className={TD + ' text-right tabular-nums hidden lg:table-cell'}>{tutar(f.vadeli)}</td>
                    <td className={TD + ' text-right font-semibold tabular-nums text-slate-900'}>{tutar(firmaToplamBorcu(f))}</td>
                    <td className={TD + ' text-right tabular-nums text-red-600'}>{tutar(f.gecikmis)}</td>
                    <td className={TD + ' text-right tabular-nums text-emerald-600'}>{tutar(f.alacak)}</td>
                    <td className={TD + ' text-right text-slate-500 hidden lg:table-cell'}>{f.ilk_vade ? trDate(f.ilk_vade) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className={TF} colSpan={2}>
                  TOPLAM <span className="font-normal text-slate-500">· {toplam.firma} firma</span>
                </td>
                <td className={TF + ' hidden lg:table-cell'} />
                <td className={TF} />
                <td className={TF + ' text-right hidden lg:table-cell'}>{tutar(toplam.pesin)}</td>
                <td className={TF + ' text-right hidden lg:table-cell'}>{tutar(toplam.vadeli)}</td>
                <td className={TF + ' text-right'}>{tutar(toplam.toplam)}</td>
                <td className={TF + ' text-right text-red-700'}>{tutar(toplam.gecikmis)}</td>
                <td className={TF + ' text-right text-emerald-700'}>{tutar(toplam.alacak)}</td>
                <td className={TF + ' hidden lg:table-cell'} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
