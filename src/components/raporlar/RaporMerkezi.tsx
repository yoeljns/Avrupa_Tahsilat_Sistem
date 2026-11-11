'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { BookOpen, FileSpreadsheet, FileText, Sheet } from 'lucide-react'
import Card from '@/components/ui/Card'
import { Field, Select } from '@/components/ui/Field'
import IndirDugmesi from '@/components/ui/IndirDugmesi'
import PageHeader from '@/components/ui/PageHeader'
import { BOS_BAKIYE_SUZGEC, SORUMLUSUZ } from '@/lib/bakiye/model'
import { sorumluDosyaEki, suzgecSorgusu, vadeliBakiyelerDosyaAdi } from '@/lib/bakiye/suzgecParam'
import { trDate, trDateTime } from '@/lib/format'
import type { VeriTazeligi } from '@/lib/queries'
import { RAPOR_TURLERI, type RaporTuru } from '@/lib/rapor/tahsilatDurumu'

interface Props {
  /** tüm firmaları gören rol (sorumlu süzgeci ve yönetim raporları) */
  staff: boolean
  sorumlular: string[]
  sorumlusuzVar: boolean
  bugun: string
  /** dönem seçenekleri: bu aydan geriye 12 ay */
  aylar: Array<{ ay: string; ad: string }>
  tazelik: VeriTazeligi | null
}

function Kart({ ikon, baslik, tur, aciklama, children }: { ikon: ReactNode; baslik: string; tur: 'PDF' | 'Excel'; aciklama: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">{ikon}</span>
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
            {baslik}
            <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + (tur === 'PDF' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')}>{tur}</span>
          </h2>
          <p className="mt-1 text-sm text-slate-500">{aciklama}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  )
}

function SorumluSecimi({ deger, onSec, sorumlular, sorumlusuzVar, id }: { deger: string; onSec: (v: string) => void; sorumlular: string[]; sorumlusuzVar: boolean; id: string }) {
  return (
    <Field label="Sorumlu" htmlFor={id}>
      <Select id={id} boyut="sm" value={deger} onChange={(e) => onSec(e.target.value)}>
        <option value="">Tüm firmalar</option>
        {sorumlular.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
        {sorumlusuzVar && <option value={SORUMLUSUZ}>Sorumlusu olmayanlar</option>}
      </Select>
    </Field>
  )
}

export default function RaporMerkezi({ staff, sorumlular, sorumlusuzVar, bugun, aylar, tazelik }: Props) {
  const [tur, setTur] = useState<RaporTuru>('ozet')
  const [sorumlu, setSorumlu] = useState('')
  const [ay, setAy] = useState('')
  const [excelSorumlu, setExcelSorumlu] = useState('')
  const [acik, setAcik] = useState(false)
  const [gecikmis, setGecikmis] = useState(false)

  const sorumluVar = staff && sorumlular.length > 0

  const pdfSorgusu = new URLSearchParams({ tur })
  if (sorumlu) pdfSorgusu.set('sorumlu', sorumlu)
  if (ay) pdfSorgusu.set('ay', ay)
  const pdfEki = sorumluDosyaEki(sorumlu)

  const excelSuzgeci = { ...BOS_BAKIYE_SUZGEC, sorumlu: excelSorumlu, bitenleriGizle: acik, yalnizGecikmis: gecikmis }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<FileText className="h-5 w-5" />}
        title="Raporlar"
        description="Bütün indirmeler tek yerde. Dosyalar düğmeye bastığınız anda, sistemdeki güncel veriyle üretilir."
        actions={
          tazelik && (
            <p className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm ring-1 ring-slate-200/70">
              Son irsaliye <strong className="font-semibold text-slate-800">{trDate(tazelik.son_irsaliye_tarihi)}</strong> · Son ödeme{' '}
              <strong className="font-semibold text-slate-800">{trDate(tazelik.son_odeme_tarihi)}</strong>
              <span className="block text-slate-400">Son hesap {trDateTime(tazelik.son_hesap)}</span>
            </p>
          )
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Kart
          ikon={<FileText className="h-5 w-5" />}
          baslik="Tahsilat Durum Raporu"
          tur="PDF"
          aciklama="Toplam satış, tahsilat, açık ve vadesi geçmiş borç; yaşlandırma; en çok geciken firmalar. Yazdırmaya ve paylaşmaya hazır."
        >
          <fieldset>
            <legend className="text-xs font-semibold text-slate-600">Rapor türü</legend>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
              {(Object.keys(RAPOR_TURLERI) as RaporTuru[]).map((k) => (
                <label
                  key={k}
                  className={
                    'cursor-pointer rounded-xl border p-3 text-sm transition-colors ' +
                    (tur === k ? 'border-blue-500 bg-blue-50/60 ring-1 ring-blue-500' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50')
                  }
                >
                  <input type="radio" name="rapor-turu" value={k} checked={tur === k} onChange={() => setTur(k)} className="sr-only" />
                  <span className="block font-semibold text-slate-900">{RAPOR_TURLERI[k].ad}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{RAPOR_TURLERI[k].aciklama}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {sorumluVar && <SorumluSecimi id="pdf-sorumlu" deger={sorumlu} onSec={setSorumlu} sorumlular={sorumlular} sorumlusuzVar={sorumlusuzVar} />}
            <Field label="Dönem tahsilatı için ay" htmlFor="pdf-ay" hint={tur === 'kisa' ? 'Kısa özette dönem bölümü yoktur.' : undefined}>
              <Select id="pdf-ay" boyut="sm" value={ay} onChange={(e) => setAy(e.target.value)} disabled={tur === 'kisa'}>
                <option value="">Tahsilat kaydı olan son ay</option>
                {aylar.map((a) => (
                  <option key={a.ay} value={a.ay}>
                    {a.ad}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-4">
            <IndirDugmesi
              url={'/api/rapor/tahsilat-durumu?' + pdfSorgusu.toString()}
              yedekAd={`tahsilat_durumu_${tur}${pdfEki ? '_' + pdfEki : ''}_${bugun}.pdf`}
              variant="primary"
              size="md"
            >
              PDF indir
            </IndirDugmesi>
          </div>
        </Kart>

        <Kart
          ikon={<Sheet className="h-5 w-5" />}
          baslik="Vadeli Bakiyeler"
          tur="Excel"
          aciklama={
            <>
              Konsinye borç tablosu: firma başına aylık vadeli ve peşin borç, ödeme ve kalan — renkleri, gizli ayları, notları ve formülleriyle.{' '}
              <Link href="/konsinye/bakiye" className="font-medium text-blue-700 hover:underline">
                Tabloyu ekranda aç →
              </Link>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {sorumluVar && <SorumluSecimi id="excel-sorumlu" deger={excelSorumlu} onSec={setExcelSorumlu} sorumlular={sorumlular} sorumlusuzVar={sorumlusuzVar} />}
            <div className="flex flex-col justify-end gap-1.5 text-sm text-slate-700">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={acik} onChange={(e) => setAcik(e.target.checked)} className="h-4 w-4 accent-blue-600" />
                Borcu bitenleri çıkar
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={gecikmis} onChange={(e) => setGecikmis(e.target.checked)} className="h-4 w-4 accent-red-600" />
                Yalnız gecikmiş borcu olanlar
              </label>
            </div>
          </div>
          <div className="mt-4">
            <IndirDugmesi url={'/api/export/vadeli-bakiyeler' + suzgecSorgusu(excelSuzgeci)} yedekAd={vadeliBakiyelerDosyaAdi(bugun, excelSuzgeci)} variant="primary" size="md">
              Excel indir
            </IndirDugmesi>
          </div>
        </Kart>

        {staff && (
          <Kart
            ikon={<FileSpreadsheet className="h-5 w-5" />}
            baslik="Borç ve tahsilat dökümleri"
            tur="Excel"
            aciklama="Düz listeler: süzmek, sıralamak ve başka hesaplarda kullanmak için."
          >
            <ul className="divide-y divide-slate-100 text-sm">
              <li className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-800">Borç Raporu</span>
                  <span className="block text-xs text-slate-500">Konsinye ve Peşin borç listeleri, vade takvimleri, bakiyeler ve alacaklar.</span>
                </span>
                <IndirDugmesi url="/api/export/borclar" yedekAd={`borclar_${bugun}.xlsx`}>
                  Excel indir
                </IndirDugmesi>
              </li>
              <li className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-800">Tahsilat Detayı</span>
                  <span className="block text-xs text-slate-500">Hangi ödeme hangi irsaliyeye işlendi; işlenmeyen ödemeler ve açık taksitler.</span>
                </span>
                <IndirDugmesi url="/api/export/tahsilat-detay" yedekAd={`tahsilat_detay_${bugun}.xlsx`}>
                  Excel indir
                </IndirDugmesi>
              </li>
            </ul>
          </Kart>
        )}

        <Kart
          ikon={<BookOpen className="h-5 w-5" />}
          baslik="İş Akış Prosedürü"
          tur="PDF"
          aciklama={
            <>
              Sistemin nasıl çalıştığı ve kimin ne yapacağı: dosya yükleme sırası, inceleme, düzeltmeler, raporlar; ödemelerin borca nasıl işlendiği.{' '}
              <Link href="/yardim" className="font-medium text-blue-700 hover:underline">
                Uygulamada oku →
              </Link>
            </>
          }
        >
          <IndirDugmesi url="/api/rapor/prosedur" yedekAd="is_akis_proseduru.pdf" variant="primary" size="md">
            PDF indir
          </IndirDugmesi>
        </Kart>
      </div>
    </div>
  )
}
