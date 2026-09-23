'use client'

import { Fragment, type MouseEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { eur, trDate } from '@/lib/format'
import {
  eurTam,
  gecikmeDagilimi,
  odemeYuzdesi,
  sutunHucresi,
  type Sutun,
  type SutunHucresi,
  type TakvimFirmaSatiri,
} from '@/lib/takvim'
import { DURUM_ETIKET, DURUM_HUCRE, DURUM_KALAN_YAZI } from './durum'
import type { SeciliHucre } from './HucreDetayi'

export type Gorunum = 'sade' | 'excel'

interface Props {
  satirlar: TakvimFirmaSatiri[]
  sutunlar: Sutun[]
  gorunum: Gorunum
  bugun: string
  ayBas: string
  onSec: (s: SeciliHucre) => void
}

// Başlık yükseklikleri sabit: Excel düzeninin ikinci başlık satırı birincinin
// hemen altına yapışır.
// Zemin/yazı rengi ve kenarlar AYRI eklenir: aynı öğede çakışan iki Tailwind
// sınıfı olmasın (hangisinin kazanacağı sınıf sırasına değil CSS sırasına bağlı).
const TH0 = 'sticky border-b border-slate-200 px-2 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap'
const TH = TH0 + ' top-0 bg-slate-100 text-slate-600'
const TD0 = 'border-b border-slate-100 text-right tabular-nums whitespace-nowrap'
const TD = TD0 + ' px-2 py-1.5'
const TF = 'sticky bottom-0 border-t-2 border-slate-300 bg-slate-100 px-2 py-2 text-right tabular-nums whitespace-nowrap font-semibold'

function tutar(v: number, kuruslu: boolean): ReactNode {
  if (v === 0) return <span className="text-slate-300">–</span>
  return kuruslu ? eur(v) : eurTam(v)
}

function ipucu(h: SutunHucresi): string {
  const tarih = h.tarihler.map((d) => trDate(d)).join(', ')
  return `${tarih} — ${DURUM_ETIKET[h.durum]}\nBorç ${eur(h.borc)} · Ödeme ${eur(h.odeme)} · Kalan ${eur(h.kalan)}`
}

interface Toplam {
  borc: number
  odeme: number
  kalan: number
}

export default function TakvimTablosu({ satirlar, sutunlar, gorunum, bugun, ayBas, onSec }: Props) {
  const excel = gorunum === 'excel'

  // "Bugün" işareti: bugünü içeren sütun vurgulanır; yoksa geçmişten geleceğe
  // geçilen yere dikey çizgi çekilir.
  const bugunIdx = sutunlar.findIndex((s) => s.konum === 'bugun')
  const ilkGelecek = sutunlar.findIndex((s) => s.konum === 'gelecek')
  const cizgiIdx = bugunIdx === -1 && ilkGelecek > 0 && sutunlar[ilkGelecek - 1].konum === 'gecmis' ? ilkGelecek : -1

  // Satır hücreleri + alt toplamlar tek geçişte
  const sutunToplam: Toplam[] = sutunlar.map(() => ({ borc: 0, odeme: 0, kalan: 0 }))
  const genel = { once: 0, sonra: 0, borc: 0, odeme: 0, kalan: 0, gecikmis: 0 }
  const hazir = satirlar.map((f) => {
    const hucreler = sutunlar.map((s, i) => {
      const h = sutunHucresi(f.gunler, s, bugun)
      if (h) {
        sutunToplam[i].borc += h.borc
        sutunToplam[i].odeme += h.odeme
        sutunToplam[i].kalan += h.kalan
      }
      return h
    })
    genel.once += f.once_kalan
    genel.sonra += f.sonra_kalan
    genel.borc += f.toplam_borc
    genel.odeme += f.toplam_odeme
    genel.kalan += f.toplam_kalan
    genel.gecikmis += f.gecikmis
    return { f, hucreler, dagilim: gecikmeDagilimi(f, ayBas, bugun) }
  })

  const sec = (e: MouseEvent<HTMLButtonElement>, f: TakvimFirmaSatiri, s: Sutun, h: SutunHucresi) => {
    const r = e.currentTarget.getBoundingClientRect()
    onSec({ firma: f, sutun: s, hucre: h, x: r.left, y: r.bottom })
  }

  // Sütun ayırıcı kenar: "bugün" geçişinde mavi çizgi
  const kenarBaslik = (i: number) => (i === cizgiIdx ? ' border-l-2 border-l-blue-500' : ' border-l border-l-slate-200')
  const kenar = (i: number) => (i === cizgiIdx ? ' border-l-2 border-l-blue-500' : ' border-l border-l-slate-100')
  const baslikRengi = (i: number) => (i === bugunIdx ? ' bg-blue-100 text-blue-900' : ' bg-slate-100 text-slate-600')
  const bugunZemini = (i: number) => (i === bugunIdx ? ' bg-blue-50/60' : '')

  return (
    <div className="max-h-[calc(100vh-7rem)] overflow-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 print:max-h-none print:overflow-visible print:shadow-none print:ring-0">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th
              rowSpan={excel ? 2 : 1}
              className={TH + ' left-0 z-30 h-[42px] min-w-[240px] text-left shadow-[1px_0_0_0_rgb(226,232,240)]'}
            >
              Firma
            </th>
            <th rowSpan={excel ? 2 : 1} className={TH + ' z-20 h-[42px] border-l border-l-slate-200 text-right'}>
              Önceki
              <br />
              aylar
            </th>
            {sutunlar.map((s, i) => (
              <th
                key={s.anahtar}
                colSpan={excel ? 3 : 1}
                className={TH0 + ' top-0 z-20 h-[42px] text-center normal-case tracking-normal' + baslikRengi(i) + kenarBaslik(i)}
                title={s.bas === s.son ? trDate(s.bas) : `${trDate(s.bas)} – ${trDate(s.son)}`}
              >
                <span className="text-xs font-semibold">{s.baslik}</span>
                {i === bugunIdx && <span className="ml-1 rounded bg-blue-600 px-1 text-[10px] font-semibold text-white">bugün</span>}
                {i === cizgiIdx && <span className="ml-1 text-[10px] font-medium text-blue-600">← bugün</span>}
              </th>
            ))}
            <th rowSpan={excel ? 2 : 1} className={TH + ' z-20 h-[42px] border-l border-l-slate-200 text-right'}>
              Sonraki
              <br />
              aylar
            </th>
            {excel ? (
              <>
                <th rowSpan={2} className={TH + ' z-20 h-[42px] border-l border-l-slate-200 text-right'}>
                  Toplam
                  <br />
                  borç
                </th>
                <th rowSpan={2} className={TH + ' z-20 h-[42px] text-right'}>
                  Toplam
                  <br />
                  ödenen
                </th>
                <th rowSpan={2} className={TH + ' z-20 h-[42px] text-right'}>
                  Kalan
                  <br />
                  borç
                </th>
              </>
            ) : (
              <th className={TH + ' z-20 h-[42px] border-l border-l-slate-200 text-right'}>
                Toplam
                <br />
                kalan
              </th>
            )}
          </tr>
          {excel && (
            <tr>
              {sutunlar.map((s, i) => (
                <Fragment key={s.anahtar}>
                  <th className={TH0 + ' top-[42px] z-20 h-[28px] text-right text-[10px]' + baslikRengi(i) + kenarBaslik(i)}>Borç</th>
                  <th className={TH0 + ' top-[42px] z-20 h-[28px] text-right text-[10px]' + baslikRengi(i)}>Ödeme</th>
                  <th className={TH0 + ' top-[42px] z-20 h-[28px] text-right text-[10px]' + baslikRengi(i)}>Kalan</th>
                </Fragment>
              ))}
            </tr>
          )}
        </thead>

        <tbody>
          {hazir.map(({ f, hucreler, dagilim }, satirNo) => {
            const zemin = satirNo % 2 ? 'bg-slate-50' : 'bg-white'
            const onceTamGecikmis = f.once_kalan > 0 && dagilim.once >= f.once_kalan
            return (
              <tr key={f.firm_id} className={'group ' + zemin + ' hover:bg-sky-50'}>
                <td
                  className={
                    'sticky left-0 z-10 max-w-[320px] border-b border-slate-100 px-3 py-2 text-left shadow-[1px_0_0_0_rgb(226,232,240)] group-hover:bg-sky-50 ' +
                    zemin
                  }
                >
                  <div className="flex min-w-0 items-baseline gap-1.5">
                    <Link href={`/firmalar/${f.firm_id}`} className="shrink-0 font-semibold text-blue-700 hover:underline">
                      {f.kod}
                    </Link>
                    <span className="truncate text-slate-700" title={f.ad}>
                      {f.ad}
                    </span>
                    {f.tarihsiz && (
                      <span className="shrink-0 text-amber-500" title="Bazı taksitlerde vade tarihi girilmedi (irsaliye tarihi kullanıldı)">
                        †
                      </span>
                    )}
                  </div>
                  {f.sorumlu && <div className="mt-0.5 text-[11px] font-medium tracking-wide text-slate-400">{f.sorumlu}</div>}
                </td>

                <td className={TD + ' border-l border-l-slate-100'}>
                  <span className={onceTamGecikmis ? 'font-semibold text-red-700' : 'text-slate-700'}>{tutar(f.once_kalan, excel)}</span>
                  {dagilim.once > 0 && !onceTamGecikmis && (
                    <div className="text-[11px] text-red-600">{tutar(dagilim.once, excel)} gecikmiş</div>
                  )}
                </td>

                {hucreler.map((h, i) => {
                  const s = sutunlar[i]
                  if (!excel) {
                    return (
                      <td key={s.anahtar} className={TD0 + ' px-1.5 py-1' + kenar(i) + bugunZemini(i)}>
                        {h && (
                          <button
                            type="button"
                            onClick={(e) => sec(e, f, s, h)}
                            title={ipucu(h)}
                            className={'block w-full min-w-[88px] rounded-md px-2 py-1 text-right whitespace-nowrap ' + DURUM_HUCRE[h.durum]}
                          >
                            <span className="block leading-tight">{h.durum === 'odendi' ? '✓ ödendi' : eurTam(h.kalan)}</span>
                            {h.durum !== 'odendi' && h.odeme > 0 && (
                              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-black/10">
                                <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${odemeYuzdesi(h.borc, h.odeme)}%` }} />
                              </span>
                            )}
                          </button>
                        )}
                      </td>
                    )
                  }
                  return (
                    <Fragment key={s.anahtar}>
                      <td className={TD + kenar(i) + bugunZemini(i)}>{h ? tutar(h.borc, true) : ''}</td>
                      <td className={TD + ' text-emerald-700' + bugunZemini(i)}>{h ? tutar(h.odeme, true) : ''}</td>
                      <td className={TD0 + ' px-0.5 py-0.5' + bugunZemini(i)}>
                        {h && (
                          <button
                            type="button"
                            onClick={(e) => sec(e, f, s, h)}
                            title={ipucu(h)}
                            className={'w-full rounded px-2 py-1.5 text-right hover:bg-slate-100 ' + DURUM_KALAN_YAZI[h.durum]}
                          >
                            {h.kalan > 0 ? eur(h.kalan) : '✓'}
                          </button>
                        )}
                      </td>
                    </Fragment>
                  )
                })}

                <td className={TD + ' border-l border-l-slate-100 text-slate-400'}>
                  {tutar(f.sonra_kalan, excel)}
                  {dagilim.sonra > 0 && <div className="text-[11px] text-red-600">{tutar(dagilim.sonra, excel)} gecikmiş</div>}
                </td>
                {excel && (
                  <>
                    <td className={TD + ' border-l border-l-slate-100'}>{tutar(f.toplam_borc, true)}</td>
                    <td className={TD + ' text-emerald-700'}>{tutar(f.toplam_odeme, true)}</td>
                  </>
                )}
                <td className={TD + (excel ? '' : ' border-l border-l-slate-100')}>
                  <span className="font-semibold text-slate-900">{tutar(f.toplam_kalan, excel)}</span>
                  {f.gecikmis > 0 && <div className="text-[11px] font-medium text-red-600">{tutar(f.gecikmis, excel)} gecikmiş</div>}
                </td>
              </tr>
            )
          })}
        </tbody>

        <tfoot>
          <tr>
            <td className={TF + ' left-0 z-30 text-left shadow-[1px_0_0_0_rgb(226,232,240)]'}>
              TOPLAM <span className="font-normal text-slate-500">· {satirlar.length} firma</span>
            </td>
            <td className={TF + ' z-20' + ' border-l border-l-slate-200 text-red-700'}>{tutar(genel.once, excel)}</td>
            {sutunToplam.map((t, i) =>
              excel ? (
                <Fragment key={sutunlar[i].anahtar}>
                  <td className={TF + ' z-20' + kenar(i)}>{tutar(t.borc, true)}</td>
                  <td className={TF + ' z-20' + ' text-emerald-700'}>{tutar(t.odeme, true)}</td>
                  <td className={TF + ' z-20'}>{tutar(t.kalan, true)}</td>
                </Fragment>
              ) : (
                <td key={sutunlar[i].anahtar} className={TF + ' z-20' + kenar(i)}>
                  {tutar(t.kalan, false)}
                </td>
              ),
            )}
            <td className={TF + ' z-20' + ' border-l border-l-slate-200 text-slate-500'}>{tutar(genel.sonra, excel)}</td>
            {excel && (
              <>
                <td className={TF + ' z-20' + ' border-l border-l-slate-200'}>{tutar(genel.borc, true)}</td>
                <td className={TF + ' z-20' + ' text-emerald-700'}>{tutar(genel.odeme, true)}</td>
              </>
            )}
            <td className={TF + ' z-20' + (excel ? '' : ' border-l border-l-slate-200')}>
              {tutar(genel.kalan, excel)}
              {genel.gecikmis > 0 && <div className="text-[11px] font-medium text-red-600">{tutar(genel.gecikmis, excel)} gecikmiş</div>}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
