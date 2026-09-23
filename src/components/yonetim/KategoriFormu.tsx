'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import KategoriRozeti from '@/components/KategoriRozeti'
import Button from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import Modal from '@/components/ui/Modal'
import { postJson } from '@/lib/istek'
import { DAVRANISLAR, SINIFSIZ_KOD, davranisOf, kodOnerisi, type DavranisAnahtari, type KategoriMeta, type Taraf } from '@/lib/kategoriMeta'
import { RENK_ANAHTARLARI, RENK_PALETI } from '@/lib/renkler'

// Kategori oluştur / düzenle penceresi. Davranış yalnız oluştururken seçilir;
// sonradan değişimi ayrı pencerededir (etkisi önizlenir, taksitler uyarlanır).

const KOD_DESENI = /^[A-Z][A-Z0-9_]{1,29}$/

function tarafOf(a: DavranisAnahtari): Taraf {
  return a === 'YOK' ? null : a
}

export default function KategoriFormu({
  kategori,
  mevcut,
  onKapat,
  onKaydedildi,
}: {
  kategori: KategoriMeta | null
  mevcut: readonly KategoriMeta[]
  onKapat: () => void
  onKaydedildi: (s: { yeni: boolean; kod: string; ad: string }) => void
}) {
  const yeni = kategori === null
  const [ad, setAd] = useState(kategori?.ad ?? '')
  const [kod, setKod] = useState(kategori?.kod ?? '')
  const [kodElle, setKodElle] = useState(false)
  const [kisaAd, setKisaAd] = useState(kategori?.kisa_ad ?? '')
  const [renk, setRenk] = useState(kategori?.renk ?? 'gok')
  const [davranis, setDavranis] = useState<DavranisAnahtari>(kategori ? davranisOf(kategori.taraf) : 'VADELI')
  const [aciklama, setAciklama] = useState(kategori?.aciklama ?? '')
  const [suzgec, setSuzgec] = useState(kategori?.sayfada_suzgec ?? true)
  const [kart, setKart] = useState(kategori?.panoda_kart ?? false)
  const [hata, setHata] = useState<string | null>(null)
  const [mesgul, setMesgul] = useState(false)

  const sinifsiz = kategori?.kod === SINIFSIZ_KOD
  const etkinKod = yeni ? (kodElle ? kod : kodOnerisi(ad)) : kategori.kod
  const hesapta = davranis !== 'YOK' && !sinifsiz
  const sayfa = DAVRANISLAR[davranis].sayfa

  const adHatasi = ad.trim() === '' ? null : mevcut.some((k) => k.kod !== kategori?.kod && k.ad.toLocaleLowerCase('tr') === ad.trim().toLocaleLowerCase('tr')) ? 'Bu adla bir kategori zaten var.' : null
  const kodHatasi =
    !yeni || etkinKod === ''
      ? null
      : !KOD_DESENI.test(etkinKod)
        ? 'Büyük harf ile başlamalı; yalnız büyük harf, rakam ve _ (2–30 karakter).'
        : mevcut.some((k) => k.kod === etkinKod)
          ? 'Bu kod kullanılıyor.'
          : null
  const gecerli = ad.trim().length > 0 && ad.trim().length <= 60 && !adHatasi && !kodHatasi && (!yeni || etkinKod !== '')

  const onizleme: KategoriMeta = {
    kod: etkinKod || 'YENI',
    ad: ad.trim() || 'Yeni kategori',
    kisa_ad: kisaAd.trim() || null,
    renk,
    taraf: sinifsiz ? null : tarafOf(davranis),
    sira: 0,
    aktif: true,
    sistem: false,
    sayfada_suzgec: suzgec,
    panoda_kart: kart,
  }

  async function kaydet(e: React.FormEvent) {
    e.preventDefault()
    if (!gecerli || mesgul) return
    setHata(null)
    if (yeni) {
      setMesgul(true)
      const r = await postJson<{ kod: string }>('/api/admin/kategoriler', {
        action: 'olustur',
        kod: etkinKod,
        ad: ad.trim(),
        kisa_ad: kisaAd.trim() || null,
        renk,
        taraf: tarafOf(davranis),
        aciklama: aciklama.trim() || null,
        sayfada_suzgec: hesapta ? suzgec : false,
        panoda_kart: hesapta ? kart : false,
      })
      setMesgul(false)
      if (!r.ok) return setHata(r.error)
      return onKaydedildi({ yeni: true, kod: r.data.kod, ad: ad.trim() })
    }
    const degisiklik: Record<string, unknown> = {}
    if (ad.trim() !== kategori.ad) degisiklik.ad = ad.trim()
    if ((kisaAd.trim() || null) !== (kategori.kisa_ad ?? null)) degisiklik.kisa_ad = kisaAd.trim() || null
    if (renk !== kategori.renk) degisiklik.renk = renk
    if ((aciklama.trim() || null) !== (kategori.aciklama ?? null)) degisiklik.aciklama = aciklama.trim() || null
    if (suzgec !== kategori.sayfada_suzgec) degisiklik.sayfada_suzgec = suzgec
    if (kart !== kategori.panoda_kart) degisiklik.panoda_kart = kart
    if (Object.keys(degisiklik).length === 0) return onKapat()
    setMesgul(true)
    const r = await postJson('/api/admin/kategoriler', { action: 'guncelle', kod: kategori.kod, ...degisiklik })
    setMesgul(false)
    if (!r.ok) return setHata(r.error)
    onKaydedildi({ yeni: false, kod: kategori.kod, ad: ad.trim() })
  }

  return (
    <Modal
      acik
      onKapat={onKapat}
      kapatilamaz={mesgul}
      genislik="lg"
      baslik={yeni ? 'Yeni satış kategorisi' : `“${kategori.ad}” kategorisini düzenle`}
      aciklama={yeni ? 'Ad, renk ve davranış seçin. İrsaliyeler bu kategoriye tanıma kuralıyla ya da elle atanır.' : undefined}
      altBilgi={
        <>
          <span className="mr-auto flex items-center gap-2 text-xs text-slate-500">
            Önizleme: <KategoriRozeti kod={onizleme.kod} meta={[onizleme]} />
            {onizleme.kisa_ad && <KategoriRozeti kod={onizleme.kod} meta={[onizleme]} kisa />}
          </span>
          <Button onClick={onKapat} disabled={mesgul}>
            Vazgeç
          </Button>
          <Button variant="primary" type="submit" form="kategori-formu" loading={mesgul} disabled={!gecerli}>
            {yeni ? 'Oluştur' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="kategori-formu" onSubmit={kaydet} className="space-y-5">
        {hata && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{hata}</p>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Ad" className="sm:col-span-2" error={adHatasi} hint="Ekranlarda ve raporlarda görünen ad.">
            <Input value={ad} onChange={(e) => setAd(e.target.value)} maxLength={60} placeholder="örn. Proje Satışı" required />
          </Field>
          <Field label="Kısa ad (isteğe bağlı)" hint="Dar yerlerde, düğmelerde.">
            <Input value={kisaAd} onChange={(e) => setKisaAd(e.target.value)} maxLength={20} placeholder="örn. Proje" />
          </Field>
        </div>

        {yeni && (
          <Field label="Kod" error={kodHatasi} hint="Sistem içi kimlik; oluşturulduktan sonra değişmez. Addan kendiliğinden önerilir.">
            <Input
              value={etkinKod}
              onChange={(e) => {
                setKodElle(true)
                setKod(e.target.value.toUpperCase())
              }}
              maxLength={30}
              className="font-mono"
              spellCheck={false}
            />
          </Field>
        )}

        <fieldset>
          <legend className="block text-xs font-semibold text-slate-600">Renk</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {RENK_ANAHTARLARI.map((r) => {
              const p = RENK_PALETI[r]
              const secili = renk === r
              return (
                <label
                  key={r}
                  title={p.ad}
                  className={
                    'relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full ring-offset-2 ' +
                    p.nokta +
                    (secili ? ' ring-2 ring-slate-900' : ' hover:ring-2 hover:ring-slate-300')
                  }
                >
                  <input type="radio" name="renk" value={r} checked={secili} onChange={() => setRenk(r)} className="sr-only" aria-label={p.ad} />
                  {secili && <Check className="h-4 w-4 text-white" aria-hidden="true" />}
                </label>
              )
            })}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">Kırmızı, yeşil, sarı ve mor bilerek yok: sistemde gecikme, ödeme, uyarı ve iade anlamı taşırlar.</p>
        </fieldset>

        {!sinifsiz && (
          <fieldset>
            <legend className="block text-xs font-semibold text-slate-600">Davranış — borç hesabında nasıl sayılır?</legend>
            {yeni ? (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(Object.keys(DAVRANISLAR) as DavranisAnahtari[]).map((a) => {
                  const secili = davranis === a
                  return (
                    <label
                      key={a}
                      className={
                        'cursor-pointer rounded-xl p-3 ring-inset ' + (secili ? 'bg-blue-50 ring-2 ring-blue-500' : 'bg-white ring-1 ring-slate-200 hover:ring-slate-300')
                      }
                    >
                      <input type="radio" name="davranis" value={a} checked={secili} onChange={() => setDavranis(a)} className="sr-only" />
                      <span className="block text-sm font-semibold text-slate-900">{DAVRANISLAR[a].ad}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{DAVRANISLAR[a].aciklama}</span>
                      <span className="mt-1.5 block text-xs font-medium text-blue-700">{DAVRANISLAR[a].sayfa ?? 'Sayfada görünmez'}</span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <strong>{DAVRANISLAR[davranis].ad}</strong> — {DAVRANISLAR[davranis].sayfa ?? 'sayfada görünmez'}.{' '}
                {kategori.sistem ? 'Sistem kategorisinin davranışı değiştirilemez.' : 'Değiştirmek için listedeki “Davranışı değiştir”i kullanın; etkisi önce gösterilir.'}
              </p>
            )}
          </fieldset>
        )}

        {hesapta && (
          <fieldset className="space-y-2">
            <legend className="block text-xs font-semibold text-slate-600">Görünüm</legend>
            <label className="flex items-start gap-3 rounded-lg p-2 hover:bg-slate-50">
              <input type="checkbox" checked={suzgec} onChange={(e) => setSuzgec(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
              <span className="text-sm">
                <span className="font-medium text-slate-800">{sayfa} üstünde süzgeç düğmesi</span>
                <span className="block text-xs text-slate-500">Takvimde yalnız bu kategoriyi göstermek için ayrı düğme çıkar.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-lg p-2 hover:bg-slate-50">
              <input type="checkbox" checked={kart} onChange={(e) => setKart(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
              <span className="text-sm">
                <span className="font-medium text-slate-800">Panoda ayrı kart</span>
                <span className="block text-xs text-slate-500">Pano’da bu kategorinin açık borcu (ve vadesi geçmişi) kendi kartında görünür.</span>
              </span>
            </label>
          </fieldset>
        )}

        <Field label="Açıklama (isteğe bağlı)" hint="Bu kategorinin ne için kullanıldığı; yalnız yönetim panelinde görünür.">
          <Textarea value={aciklama} onChange={(e) => setAciklama(e.target.value)} rows={2} maxLength={300} />
        </Field>
      </form>
    </Modal>
  )
}
