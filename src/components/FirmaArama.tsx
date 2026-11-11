'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { LoaderCircle, Search } from 'lucide-react'
import { useOturum } from '@/components/Oturum'
import { aramayaHazirla, firmaAra, type AranabilirFirma } from '@/lib/firmaArama'

// FİRMA ARAMA — üst çubuk. Kod ya da ad yazılır (Türkçe harf / büyük-küçük duyarsız),
// ok tuşlarıyla seçilir, Enter firma kartını açar. "/" tuşu kutuya odaklanır.
// Liste kutu ilk odaklandığında bir kez yüklenir (sayfa açılışına sorgu eklemez) ve
// birkaç dakika bellekte tutulur.
//
// Sonuçlar gerçek bağlantıdır (<Link>): orta tuşla / yeni sekmede açılabilir ve tıklama
// menüdeki bağlantılarla aynı yoldan geçer; Enter de seçili bağlantıya "tıklar".
// Önceden hazırlama (prefetch) kapalıdır: her tuşta değişen sonuçlar için istek atılmaz.

const ONBELLEK_SURESI = 5 * 60_000
// Bellek KULLANICIYA bağlıdır: aynı sekmede çıkış yapıp başka hesapla girilirse önceki
// kullanıcının firma listesi gösterilmez (pazarlamacı yalnız kendi firmalarını görmeli).
let onbellek: { kim: string; zaman: number; liste: Promise<AranabilirFirma[]> } | null = null

function firmalariYukle(kim: string): Promise<AranabilirFirma[]> {
  if (onbellek && onbellek.kim === kim && Date.now() - onbellek.zaman < ONBELLEK_SURESI) return onbellek.liste
  const liste = fetch('/api/firmalar/kisa')
    .then(async (r) => {
      if (!r.ok) throw new Error(String(r.status))
      const veri = (await r.json()) as { firmalar: Array<[string, string, string, string | null]> }
      return aramayaHazirla(veri.firmalar.map(([id, kod, ad, sehir]) => ({ id, kod, ad, sehir })))
    })
    .catch((e) => {
      onbellek = null // başarısız yükleme saklanmaz; sonraki odakta yeniden denenir
      throw e
    })
  onbellek = { kim, zaman: Date.now(), liste }
  return liste
}

interface Props {
  className?: string
  /** "/" kısayolu bu kutuya odaklansın (sayfada yalnız bir kutuda açılır) */
  kisayol?: boolean
  /** Bir firma seçilip gidildikten sonra (ör. telefon menüsünü kapatmak için) */
  onGidildi?: () => void
}

export default function FirmaArama({ className = '', kisayol = false, onGidildi }: Props) {
  const router = useRouter()
  const kim = useOturum()?.email ?? ''
  const kutu = useRef<HTMLInputElement>(null)
  const listeId = useId()
  const [sorgu, setSorgu] = useState('')
  const [acik, setAcik] = useState(false)
  const [etkin, setEtkin] = useState(0)
  // Yüklenen liste, kimin için yüklendiğiyle birlikte tutulur: oturum değişirse kullanılmaz
  const [yuklu, setYuklu] = useState<{ kim: string; liste: AranabilirFirma[] } | null>(null)
  const firmalar = yuklu && yuklu.kim === kim ? yuklu.liste : null
  const [hata, setHata] = useState(false)

  const sonuclar = useMemo(() => (firmalar ? firmaAra(firmalar, sorgu) : []), [firmalar, sorgu])
  const yaziVar = sorgu.trim() !== ''
  const panel = acik && yaziVar

  /** Yüklemesi süren kullanıcı (aynı anda ikinci istek atılmasın) */
  const yuklenen = useRef<string | null>(null)

  function yukle() {
    setHata(false)
    yuklenen.current = kim
    firmalariYukle(kim)
      .then((liste) => setYuklu({ kim, liste }))
      .catch(() => setHata(true))
      .finally(() => {
        if (yuklenen.current === kim) yuklenen.current = null
      })
  }

  /** Liste bu kullanıcı için henüz yoksa yükler (ilk odakta; oturum değiştiyse yazarken de) */
  function gerekirseYukle() {
    if (!firmalar && yuklenen.current !== kim) yukle()
  }

  /** Bir sonuca gidilirken (bağlantı tıklandığında) kutuyu toparlar */
  function gidildi() {
    setSorgu('')
    setAcik(false)
    kutu.current?.blur()
    onGidildi?.()
  }

  /** Enter: seçili sonucun bağlantısına tıklar; bağlantı bulunamazsa doğrudan gider */
  function etkineGit() {
    const f = sonuclar[Math.min(etkin, sonuclar.length - 1)]
    if (!f) return
    const baglanti = document.getElementById(`${listeId}-${Math.min(etkin, sonuclar.length - 1)}`)
    if (baglanti instanceof HTMLAnchorElement) baglanti.click()
    else {
      router.push(`/firmalar/${f.id}`)
      gidildi()
    }
  }

  // "/" → arama kutusu (yazı alanında değilken)
  useEffect(() => {
    if (!kisayol) return
    const tus = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const h = e.target as HTMLElement | null
      if (h && (h.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(h.tagName))) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      kutu.current?.focus()
    }
    document.addEventListener('keydown', tus)
    return () => document.removeEventListener('keydown', tus)
  }, [kisayol])

  function tus(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      if (sorgu) setSorgu('')
      else kutu.current?.blur()
      return
    }
    if (!panel || sonuclar.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setEtkin((i) => (i + 1) % sonuclar.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setEtkin((i) => (i - 1 + sonuclar.length) % sonuclar.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      etkineGit()
    }
  }

  return (
    <div className={'relative ' + className}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        ref={kutu}
        type="search"
        role="combobox"
        // Sayfalardaki "Firma ara" süzgeç kutularından ayrı bir ad: bu kutu firma kartına götürür
        aria-label="Firma kartına git"
        aria-expanded={panel}
        aria-controls={listeId}
        aria-autocomplete="list"
        aria-activedescendant={panel && sonuclar.length > 0 ? `${listeId}-${Math.min(etkin, sonuclar.length - 1)}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={sorgu}
        placeholder={kisayol ? 'Firma ara  ( / )' : 'Firma ara (kod ya da ad)'}
        onChange={(e) => {
          setSorgu(e.target.value)
          setEtkin(0)
          setAcik(true)
          gerekirseYukle()
        }}
        onFocus={() => {
          setAcik(true)
          gerekirseYukle()
        }}
        onBlur={() => setAcik(false)}
        onKeyDown={tus}
        className="w-full rounded-lg border border-slate-300 bg-slate-50 py-1.5 pr-2 pl-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {panel && (
        <div
          id={listeId}
          role="listbox"
          aria-label="Eşleşen firmalar"
          className="absolute right-0 z-50 mt-1 max-h-[70vh] w-full min-w-[min(22rem,calc(100vw-2rem))] overflow-auto rounded-xl bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200"
        >
          {hata ? (
            <p className="px-3 py-2 text-red-700">
              Firma listesi alınamadı.{' '}
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={yukle} className="font-medium underline">
                Yeniden dene
              </button>
            </p>
          ) : !firmalar ? (
            <p className="flex items-center gap-2 px-3 py-2 text-slate-500">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Firmalar yükleniyor…
            </p>
          ) : sonuclar.length === 0 ? (
            <p className="px-3 py-2 text-slate-500">Eşleşen firma yok.</p>
          ) : (
            sonuclar.map((f, i) => (
              <Link
                key={f.id}
                id={`${listeId}-${i}`}
                href={`/firmalar/${f.id}`}
                prefetch={false}
                role="option"
                aria-selected={i === etkin}
                tabIndex={-1}
                // odak kutuda kalsın: tıklama blur'dan önce işlensin
                onMouseDown={(e) => e.preventDefault()}
                onClick={gidildi}
                onMouseEnter={() => setEtkin(i)}
                className={'flex cursor-pointer items-baseline gap-2 px-3 py-1.5 ' + (i === etkin ? 'bg-blue-50' : '')}
              >
                <span className="shrink-0 font-semibold whitespace-nowrap text-blue-700 tabular-nums">{f.kod}</span>
                <span className="min-w-0 flex-1 truncate text-slate-800" title={f.ad}>
                  {f.ad}
                </span>
                {f.sehir && <span className="shrink-0 text-xs text-slate-400">{f.sehir}</span>}
              </Link>
            ))
          )}
          {firmalar && sonuclar.length > 0 && (
            <p className="border-t border-slate-100 px-3 pt-1.5 pb-1 text-[11px] text-slate-400">↑ ↓ ile seçin, Enter ile açın</p>
          )}
        </div>
      )}
    </div>
  )
}
