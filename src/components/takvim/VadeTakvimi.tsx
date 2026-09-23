'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BOS_SUZGEC,
  SIRALAMA_ETIKETLERI,
  ayAraligi,
  firmalariSirala,
  firmalariSuz,
  gunSutunlari,
  haftaSutunlari,
  sorumluListesi,
  type Siralama,
  type Suzgec,
  type TakvimFirmaSatiri,
} from '@/lib/takvim'
import { DURUM_ETIKET, DURUM_NOKTA } from './durum'
import HucreDetayi, { type SeciliHucre } from './HucreDetayi'
import TakvimMobil from './TakvimMobil'
import TakvimTablosu, { type Gorunum } from './TakvimTablosu'

type SutunTuru = 'gun' | 'hafta'

interface Props {
  firmalar: TakvimFirmaSatiri[]
  /** 'YYYY-MM' */
  ay: string
  /** Türkiye saatine göre bugün (ISO) */
  bugun: string
  taraf: 'PESIN' | 'VADELI'
  varsayilanSutun: SutunTuru
  /** Sorumlu süzgeci yalnız tüm firmaları gören rollerde anlamlı */
  sorumluSuzgeci: boolean
}

const GORUNUMLER: readonly Gorunum[] = ['sade', 'excel']
const SUTUN_TURLERI: readonly SutunTuru[] = ['gun', 'hafta']

// Tercihler bu tarayıcıda hatırlanır; depolama kapalıysa (gizli pencere vb.) varsayılan kullanılır.
function oku<T extends string>(anahtar: string, izinli: readonly T[]): T | null {
  try {
    const v = window.localStorage.getItem(anahtar)
    return v !== null && (izinli as readonly string[]).includes(v) ? (v as T) : null
  } catch {
    return null
  }
}
function yaz(anahtar: string, deger: string) {
  try {
    window.localStorage.setItem(anahtar, deger)
  } catch {
    /* depolama yok — tercih yalnız bu oturumda geçerli */
  }
}

function Secici<T extends string>({
  etiket,
  deger,
  secenekler,
  onSec,
}: {
  etiket: string
  deger: T
  secenekler: ReadonlyArray<readonly [T, string]>
  onSec: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg bg-slate-200/70 p-0.5" role="group" aria-label={etiket}>
      {secenekler.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={deger === v}
          onClick={() => onSec(v)}
          className={
            'rounded-md px-3 py-1 text-xs font-semibold transition-colors ' +
            (deger === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')
          }
        >
          {l}
        </button>
      ))}
    </div>
  )
}

export default function VadeTakvimi({ firmalar, ay, bugun, taraf, varsayilanSutun, sorumluSuzgeci }: Props) {
  const [gorunum, setGorunum] = useState<Gorunum>('sade')
  const [sutunTuru, setSutunTuru] = useState<SutunTuru>(varsayilanSutun)
  const [suzgec, setSuzgec] = useState<Suzgec>(BOS_SUZGEC)
  const [siralama, setSiralama] = useState<Siralama>('kod')
  const [secili, setSecili] = useState<SeciliHucre | null>(null)

  // Kayıtlı tercihler ilk çizimden SONRA okunur (sunucu çıktısıyla uyumsuzluk olmasın)
  useEffect(() => {
    const g = oku('takvim.gorunum', GORUNUMLER)
    const s = oku(`takvim.sutun.${taraf}`, SUTUN_TURLERI)
    if (g) setGorunum(g)
    if (s) setSutunTuru(s)
  }, [taraf])

  const gorunumSec = (g: Gorunum) => {
    setGorunum(g)
    yaz('takvim.gorunum', g)
  }
  const sutunSec = (s: SutunTuru) => {
    setSutunTuru(s)
    yaz(`takvim.sutun.${taraf}`, s)
  }
  const kapat = useCallback(() => setSecili(null), [])

  const { bas, son } = ayAraligi(ay)
  const sutunlar = useMemo(
    () => (sutunTuru === 'hafta' ? haftaSutunlari(bas, son, bugun) : gunSutunlari(firmalar.flatMap((f) => Object.keys(f.gunler)), bugun)),
    [sutunTuru, bas, son, bugun, firmalar],
  )
  const satirlar = useMemo(() => firmalariSirala(firmalariSuz(firmalar, suzgec), siralama), [firmalar, suzgec, siralama])
  const sorumlular = useMemo(() => sorumluListesi(firmalar), [firmalar])
  const suzgecVar = suzgec.arama !== '' || suzgec.sorumlu !== '' || suzgec.yalnizGecikmis || suzgec.bitenleriGizle

  if (firmalar.length === 0) {
    return <p className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm">Bu görünümde borç hareketi yok.</p>
  }

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
        {sorumluSuzgeci && sorumlular.length > 1 && (
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
          onChange={(e) => setSiralama(e.target.value as Siralama)}
          aria-label="Sıralama"
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
        >
          {(Object.keys(SIRALAMA_ETIKETLERI) as Siralama[]).map((k) => (
            <option key={k} value={k}>
              Sırala: {SIRALAMA_ETIKETLERI[k]}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <Secici
            etiket="Görünüm"
            deger={gorunum}
            secenekler={[
              ['sade', 'Sade'],
              ['excel', 'Excel düzeni'],
            ]}
            onSec={gorunumSec}
          />
          <Secici
            etiket="Sütunlar"
            deger={sutunTuru}
            secenekler={[
              ['gun', 'Gün'],
              ['hafta', 'Hafta'],
            ]}
            onSec={sutunSec}
          />
          <button
            type="button"
            onClick={() => window.print()}
            className="hidden rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 md:inline-block"
          >
            Yazdır
          </button>
        </div>
      </div>

      {/* Lejant + sayaç */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 print:hidden">
        {(['gecikti', 'yakin', 'odendi', 'ileri'] as const).map((d) => (
          <span key={d} className="inline-flex items-center gap-1.5">
            <span className={'inline-block h-2.5 w-2.5 rounded-sm ' + DURUM_NOKTA[d]} />
            {DURUM_ETIKET[d]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1 w-5 overflow-hidden rounded-full bg-black/10">
            <span className="block h-full w-2/5 bg-emerald-500" />
          </span>
          kısmi ödeme
        </span>
        <span>
          <span className="text-amber-500">†</span> vade tarihi girilmedi
        </span>
        <span className="sm:ml-auto">
          {satirlar.length === firmalar.length ? `${firmalar.length} firma` : `${satirlar.length} / ${firmalar.length} firma`}
          {gorunum === 'sade' && ' · tutarlar tam avro; kuruş için hücreye tıklayın'}
        </span>
      </div>

      {satirlar.length === 0 ? (
        <div className="mt-3 rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm">
          Süzgeçlere uyan firma yok.{' '}
          {suzgecVar && (
            <button type="button" onClick={() => setSuzgec(BOS_SUZGEC)} className="font-medium text-blue-700 hover:underline">
              Süzgeçleri temizle
            </button>
          )}
        </div>
      ) : (
        <>
          {sutunTuru === 'gun' && sutunlar.length === 0 && (
            <p className="mt-3 text-sm text-slate-500">Bu ayda vade günü yok — önceki/sonraki aylar ve toplamlar gösteriliyor.</p>
          )}
          <div className="mt-3 hidden md:block print:block">
            <TakvimTablosu satirlar={satirlar} sutunlar={sutunlar} gorunum={gorunum} bugun={bugun} ayBas={bas} onSec={setSecili} />
          </div>
          <div className="mt-3 md:hidden print:hidden">
            <TakvimMobil satirlar={satirlar} sutunlar={sutunlar} bugun={bugun} onSec={setSecili} />
          </div>
        </>
      )}

      {secili && <HucreDetayi secim={secili} onKapat={kapat} />}
    </div>
  )
}
