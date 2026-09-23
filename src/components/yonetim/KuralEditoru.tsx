'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, FlaskConical, Lock, Plus, Search, Trash2, TriangleAlert, Undo2 } from 'lucide-react'
import KategoriRozeti from '@/components/KategoriRozeti'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card, { CardTitle } from '@/components/ui/Card'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Input, Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import {
  ALAN_ETIKETLERI,
  ISLEC_ETIKETLERI,
  classifyWithRules,
  kuralDogrula,
  type Kural,
  type KuralAlani,
  type KuralIsleci,
  type KuralSonucu,
} from '@/lib/engine/kurallar'
import { eur } from '@/lib/format'
import { postJson } from '@/lib/istek'
import { SINIFSIZ_KOD, atanabilirKategoriler, kategoriEtiketi, type KategoriMeta } from '@/lib/kategoriMeta'
import { kurallarAyni, kurallariNumarala, type BelgeKalibi } from '@/lib/kuralYardimcilari'
import type { GecisTonu, SiniflandirmaGecisi } from '@/lib/siniflandirma'
import { eurKisa } from '@/lib/takvim'

// Tanıma kuralları düzenleyicisi: sıralı atama/öneri kuralları, anında deneme
// kutusu (sunucudakiyle AYNI saf işlev), etki önizlemesi ve onaylı uygulama.

interface Satir extends Kural {
  anahtar: string
}

interface Onizleme {
  ozet: { incelenen: number; degisen: number; etkinDegisen: number; elleKorunan: number; yalnizOneri: number }
  gecisler: SiniflandirmaGecisi[]
  ornekler: Array<{ fis_no: string; firma: string; belge_no: string; eski: string; yeni: string; tutar: number }>
  imza: string
}

const TON: Record<GecisTonu, { ad: string; sinif: string; rozet: 'red' | 'green' | 'amber' | 'gray' }> = {
  kayip: { ad: 'Borç hesabından çıkar', sinif: 'bg-red-50/60', rozet: 'red' },
  kazanc: { ad: 'Borç hesabına girer', sinif: 'bg-emerald-50/60', rozet: 'green' },
  taraf: { ad: 'Sayfa değiştirir (Peşin ↔ Konsinye)', sinif: 'bg-amber-50/60', rozet: 'amber' },
  notr: { ad: 'Aynı sayfada kategori değişir', sinif: '', rozet: 'gray' },
}

let sayac = 0
function satir(k: Kural): Satir {
  sayac += 1
  return { ...k, anahtar: `k${sayac}` }
}

export default function KuralEditoru({
  kurallar,
  kategoriler,
  duzenleyebilir,
  yeniKategori,
  kaliplar,
  turuler,
  taninmayanAdet,
  taninmayanTutar,
}: {
  kurallar: Kural[]
  kategoriler: KategoriMeta[]
  duzenleyebilir: boolean
  yeniKategori?: string
  kaliplar: BelgeKalibi[]
  turuler: Array<{ turu: string; adet: number; tutar: number }>
  taninmayanAdet: number
  taninmayanTutar: number
}) {
  const router = useRouter()
  const toast = useToast()

  const siraliDb = useMemo(() => kurallar.slice().sort((a, b) => a.sira - b.sira || (a.id ?? 0) - (b.id ?? 0)), [kurallar])
  const baslangic = useMemo(
    () => kurallariNumarala(siraliDb.filter((k) => k.sonuc === 'ATA'), siraliDb.filter((k) => k.sonuc === 'ONER')),
    [siraliDb],
  )
  const hedefGecerli = !!yeniKategori && kategoriler.some((k) => k.kod === yeniKategori && k.aktif && k.kod !== SINIFSIZ_KOD)
  const [ata, setAta] = useState<Satir[]>(() => {
    const ilk = siraliDb.filter((k) => k.sonuc === 'ATA').map(satir)
    if (duzenleyebilir && hedefGecerli) {
      ilk.push(satir({ kategori_kod: yeniKategori!, alan: 'BELGE_NO', islec: 'ICERIR', deger: '', sonuc: 'ATA', sira: 0, aktif: true, aciklama: null }))
    }
    return ilk
  })
  const [oner, setOner] = useState<Satir[]>(() => siraliDb.filter((k) => k.sonuc === 'ONER').map(satir))
  const [belge, setBelge] = useState('')
  const [turu, setTuru] = useState('(08) Toptan Satış')
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null)
  const [onizleniyor, setOnizleniyor] = useState(false)
  const [uygulaniyor, setUygulaniyor] = useState(false)
  const [onayAcik, setOnayAcik] = useState(false)
  const [hata, setHata] = useState<string | null>(null)

  const numarali = useMemo(() => kurallariNumarala(ata, oner), [ata, oner])
  const degisti = !kurallarAyni(numarali, baslangic)
  const gecerliKodlar = useMemo(() => new Set(kategoriler.filter((k) => k.aktif).map((k) => k.kod)), [kategoriler])
  const hatalar = useMemo(() => numarali.map((k) => kuralDogrula(k, kategoriler)), [numarali, kategoriler])
  const hataSayisi = hatalar.filter(Boolean).length
  const secenekler = (mevcut: string) => atanabilirKategoriler(kategoriler, mevcut)

  // Deneme kutusu: taslak ve kayıtlı kurallarla ayrı ayrı sonuç
  const denemeVar = belge.trim() !== '' || turu.trim() !== ''
  const deneme = denemeVar ? classifyWithRules(belge, turu, numarali, gecerliKodlar) : null
  const kayitliDeneme = denemeVar && degisti ? classifyWithRules(belge, turu, kurallar, gecerliKodlar) : null
  const eslesenIndeks = deneme?.kural ? numarali.indexOf(deneme.kural) : -1
  const eslesenAnahtar = eslesenIndeks < 0 ? null : eslesenIndeks < ata.length ? ata[eslesenIndeks].anahtar : oner[eslesenIndeks - ata.length]?.anahtar
  const kuralNo = (i: number) => (i < ata.length ? `A${i + 1}` : `Ö${i - ata.length + 1}`)

  function degistir(sonuc: KuralSonucu, anahtar: string, yama: Partial<Kural>) {
    setOnizleme(null)
    const guncelle = (l: Satir[]) => l.map((k) => (k.anahtar === anahtar ? { ...k, ...yama } : k))
    if (yama.sonuc && yama.sonuc !== sonuc) {
      // Grup değişti: diğer listenin sonuna taşı
      const k = (sonuc === 'ATA' ? ata : oner).find((x) => x.anahtar === anahtar)
      if (!k) return
      const tasinan = { ...k, ...yama }
      if (sonuc === 'ATA') {
        setAta((l) => l.filter((x) => x.anahtar !== anahtar))
        setOner((l) => [...l, tasinan])
      } else {
        setOner((l) => l.filter((x) => x.anahtar !== anahtar))
        setAta((l) => [...l, tasinan])
      }
      return
    }
    if (sonuc === 'ATA') setAta(guncelle)
    else setOner(guncelle)
  }

  function tasi(sonuc: KuralSonucu, anahtar: string, yon: -1 | 1) {
    setOnizleme(null)
    const kaydir = (l: Satir[]) => {
      const i = l.findIndex((k) => k.anahtar === anahtar)
      const j = i + yon
      if (i < 0 || j < 0 || j >= l.length) return l
      const y = l.slice()
      ;[y[i], y[j]] = [y[j], y[i]]
      return y
    }
    if (sonuc === 'ATA') setAta(kaydir)
    else setOner(kaydir)
  }

  function sil(sonuc: KuralSonucu, anahtar: string) {
    setOnizleme(null)
    if (sonuc === 'ATA') setAta((l) => l.filter((k) => k.anahtar !== anahtar))
    else setOner((l) => l.filter((k) => k.anahtar !== anahtar))
  }

  function ekle(sonuc: KuralSonucu) {
    setOnizleme(null)
    const ilk = atanabilirKategoriler(kategoriler)[0]?.kod ?? 'PESIN'
    const yeni = satir({ kategori_kod: ilk, alan: 'BELGE_NO', islec: 'ICERIR', deger: '', sonuc, sira: 0, aktif: true, aciklama: null })
    if (sonuc === 'ATA') setAta((l) => [...l, yeni])
    else setOner((l) => [...l, yeni])
  }

  function geriAl() {
    setOnizleme(null)
    setHata(null)
    setAta(siraliDb.filter((k) => k.sonuc === 'ATA').map(satir))
    setOner(siraliDb.filter((k) => k.sonuc === 'ONER').map(satir))
  }

  async function onizle() {
    setHata(null)
    setOnizleniyor(true)
    const r = await postJson<Onizleme>('/api/admin/kurallar/onizle', { kurallar: numarali })
    setOnizleniyor(false)
    if (!r.ok) return setHata(r.error)
    setOnizleme(r.data)
  }

  async function uygula() {
    if (!onizleme) return
    setUygulaniyor(true)
    setHata(null)
    const r = await postJson<{ ozet: Onizleme['ozet'] }>('/api/admin/kurallar', { kurallar: numarali, imza: onizleme.imza })
    setUygulaniyor(false)
    setOnayAcik(false)
    if (!r.ok) {
      if (r.status === 409) {
        setOnizleme(null)
        setHata(r.error)
        return
      }
      return setHata(r.error)
    }
    const n = r.data.ozet.etkinDegisen
    toast(n > 0 ? `Kurallar kaydedildi; ${n.toLocaleString('tr-TR')} irsaliyenin kategorisi güncellendi ve hesap yenilendi.` : 'Kurallar kaydedildi.')
    router.refresh()
  }

  const kayipVar = !!onizleme?.gecisler.some((g) => g.ton === 'kayip')

  const liste = (sonuc: KuralSonucu, satirlar: Satir[], ofset: number) => (
    <ol className="divide-y divide-slate-100">
      {satirlar.length === 0 && <li className="px-5 py-4 text-sm text-slate-400">Kural yok.</li>}
      {satirlar.map((k, i) => {
        const genel = ofset + i
        const hataMetni = hatalar[genel]
        const eslesti = k.anahtar === eslesenAnahtar
        const pasifHedef = !gecerliKodlar.has(k.kategori_kod)
        return (
          <li key={k.anahtar} className={'px-5 py-3 ' + (eslesti ? 'bg-blue-50/70' : k.aktif ? '' : 'bg-slate-50/80')}>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  'inline-flex h-6 min-w-8 items-center justify-center rounded-md px-1.5 text-xs font-bold tabular-nums ' +
                  (eslesti ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600')
                }
                title={eslesti ? 'Deneme kutusundaki örneğe bu kural uydu' : undefined}
              >
                {kuralNo(genel)}
              </span>
              <Select
                value={k.alan}
                onChange={(e) => degistir(sonuc, k.anahtar, { alan: e.target.value as KuralAlani })}
                disabled={!duzenleyebilir}
                boyut="sm"
                tam={false}
                aria-label="Alan"
              >
                {(Object.keys(ALAN_ETIKETLERI) as KuralAlani[]).map((a) => (
                  <option key={a} value={a}>
                    {ALAN_ETIKETLERI[a]}
                  </option>
                ))}
              </Select>
              <Select
                value={k.islec}
                onChange={(e) => degistir(sonuc, k.anahtar, { islec: e.target.value as KuralIsleci })}
                disabled={!duzenleyebilir}
                boyut="sm"
                tam={false}
                aria-label="Koşul"
              >
                {(Object.keys(ISLEC_ETIKETLERI) as KuralIsleci[]).map((a) => (
                  <option key={a} value={a}>
                    {ISLEC_ETIKETLERI[a]}
                  </option>
                ))}
              </Select>
              <Input
                value={k.deger}
                onChange={(e) => degistir(sonuc, k.anahtar, { deger: e.target.value })}
                disabled={!duzenleyebilir}
                maxLength={200}
                placeholder={k.islec === 'REGEX' ? 'örn. ^NUM' : 'örn. NUMUNE'}
                boyut="sm"
                tam={false}
                className={'min-w-[10rem] flex-1' + (k.islec === 'REGEX' ? ' font-mono' : '')}
                aria-label="Değer"
                autoFocus={k.deger === '' && duzenleyebilir}
              />
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <Select
                value={k.kategori_kod}
                onChange={(e) => degistir(sonuc, k.anahtar, { kategori_kod: e.target.value })}
                disabled={!duzenleyebilir}
                boyut="sm"
                tam={false}
                aria-label="Kategori"
              >
                {secenekler(k.kategori_kod).map((c) => (
                  <option key={c.kod} value={c.kod}>
                    {c.ad}
                    {c.aktif ? '' : ' (pasif)'}
                  </option>
                ))}
              </Select>
              <Select
                value={k.sonuc}
                onChange={(e) => degistir(sonuc, k.anahtar, { sonuc: e.target.value as KuralSonucu })}
                disabled={!duzenleyebilir}
                boyut="sm"
                tam={false}
                aria-label="Sonuç"
              >
                <option value="ATA">ata</option>
                <option value="ONER">yalnız öner</option>
              </Select>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={k.aktif}
                  onChange={(e) => degistir(sonuc, k.anahtar, { aktif: e.target.checked })}
                  disabled={!duzenleyebilir}
                  className="h-4 w-4 rounded border-slate-300"
                />
                etkin
              </label>
              {duzenleyebilir && (
                <span className="ml-auto inline-flex items-center gap-0.5">
                  <Button size="sm" variant="ghost" onClick={() => tasi(sonuc, k.anahtar, -1)} disabled={i === 0} aria-label="Yukarı" title="Yukarı (önce denensin)">
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => tasi(sonuc, k.anahtar, 1)}
                    disabled={i === satirlar.length - 1}
                    aria-label="Aşağı"
                    title="Aşağı (sonra denensin)"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => sil(sonuc, k.anahtar)} aria-label="Kuralı sil" title="Kuralı sil">
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-10">
              <Input
                value={k.aciklama ?? ''}
                onChange={(e) => degistir(sonuc, k.anahtar, { aciklama: e.target.value })}
                disabled={!duzenleyebilir}
                maxLength={200}
                placeholder="Gerekçe (isteğe bağlı) — irsaliyede “neden bu kategori” olarak görünür"
                boyut="xs"
                tam={false}
                className="max-w-xl min-w-[12rem] flex-1"
                aria-label="Gerekçe"
              />
              {pasifHedef && !hataMetni && <Badge tone="amber">hedef pasif — atlanır</Badge>}
              {hataMetni && (
                <span className="inline-flex items-center gap-1 text-xs text-red-600">
                  <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /> {hataMetni}
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )

  return (
    <div className="space-y-6">
      {!duzenleyebilir && (
        <p className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
          <Lock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          Kuralları görüntüleyebilir ve deneme kutusunu kullanabilirsiniz; değiştirmek yalnız Yönetici rolüne açıktır.
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        {/* Deneme kutusu */}
        <Card className="xl:col-span-3">
          <CardTitle icon={<FlaskConical className="h-4 w-4" />} sub="Bir Belge No ve Türü yazın; hangi kategoriye düşeceğini ve hangi kuralın karar verdiğini anında görün.">
            Deneme kutusu
          </CardTitle>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Belge No</span>
              <Input className="mt-1" value={belge} onChange={(e) => setBelge(e.target.value)} placeholder="örn. KONSİNYE PEŞİN 05/3-4-5" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Türü</span>
              <Input className="mt-1" value={turu} onChange={(e) => setTuru(e.target.value)} />
            </label>
          </div>
          <div className="mt-4 min-h-[3.5rem] rounded-xl bg-slate-50 px-4 py-3 text-sm">
            {!deneme ? (
              <p className="text-slate-400">Sonuç burada görünecek.</p>
            ) : (
              <>
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-500">Sonuç:</span>
                  {deneme.type !== SINIFSIZ_KOD ? (
                    <KategoriRozeti kod={deneme.type} meta={kategoriler} />
                  ) : (
                    <>
                      <KategoriRozeti kod={SINIFSIZ_KOD} meta={kategoriler} />
                      {deneme.suggested && (
                        <>
                          <span className="text-slate-500">· İnceleme’de öneri:</span>
                          <KategoriRozeti kod={deneme.suggested} meta={kategoriler} />
                        </>
                      )}
                    </>
                  )}
                  {eslesenIndeks >= 0 && <span className="text-xs text-slate-500">kural {kuralNo(eslesenIndeks)}</span>}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {deneme.needsReview && deneme.type !== SINIFSIZ_KOD ? 'İade irsaliyesi: kategori atanır ama yine de incelemeye düşer. ' : ''}
                  Gerekçe: {deneme.reason}
                </p>
                {kayitliDeneme && (kayitliDeneme.type !== deneme.type || (kayitliDeneme.suggested ?? null) !== (deneme.suggested ?? null)) && (
                  <p className="mt-1 text-xs text-amber-700">
                    Kayıtlı kurallarla sonuç: {kategoriEtiketi(kategoriler, kayitliDeneme.type)}
                    {kayitliDeneme.suggested ? ` (öneri: ${kategoriEtiketi(kategoriler, kayitliDeneme.suggested)})` : ''}
                  </p>
                )}
              </>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Karşılaştırma Türkçe harf ve büyük/küçük harf duyarsızdır (“Konsinye Peşin” = “KONSİNYE PEŞİN”). İade irsaliyeleri her zaman
            incelemeye düşer.
          </p>
        </Card>

        {/* Tanınmayanlar */}
        <Card className="xl:col-span-2" padded={false}>
          <div className="border-b border-slate-100 px-5 py-4">
            <CardTitle
              icon={<Search className="h-4 w-4" />}
              sub={
                taninmayanAdet > 0
                  ? `${taninmayanAdet.toLocaleString('tr-TR')} irsaliye (≈ ${eur(taninmayanTutar)}) borç hesabına girmiyor. Bir kalıba tıklayın, deneme kutusuna gelsin.`
                  : 'Sınıflandırılmamış irsaliye yok.'
              }
            >
              Tanınmayan Belge No kalıpları
            </CardTitle>
          </div>
          {kaliplar.length > 0 && (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
              {kaliplar.map((k) => (
                <li key={k.kalip}>
                  <button
                    type="button"
                    onClick={() => {
                      setBelge(k.ornek)
                      setTuru(k.ornekTuru)
                    }}
                    className="flex w-full items-center gap-3 px-5 py-2 text-left hover:bg-slate-50"
                    title={`Örnek: ${k.ornek || '(boş)'}`}
                  >
                    <code className="min-w-0 flex-1 truncate text-xs text-slate-700">{k.kalip}</code>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">{k.adet.toLocaleString('tr-TR')} irs.</span>
                    <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700">{eurKisa(k.tutar)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {turuler.length > 0 && (
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              Türü: {turuler.map((t) => `${t.turu} (${t.adet})`).join(' · ')}
            </p>
          )}
          <p className="border-t border-slate-100 px-5 py-2 text-[11px] text-slate-400"># = rakam dizisi</p>
        </Card>
      </div>

      {/* Kurallar */}
      <Card padded={false}>
        <div className="border-b border-slate-100 px-5 py-4">
          <CardTitle
            sub="Yukarıdan aşağı denenir; ilk uyan kural kategoriyi belirler."
            action={
              duzenleyebilir && (
                <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => ekle('ATA')}>
                  Atama kuralı
                </Button>
              )
            }
          >
            Atama kuralları
          </CardTitle>
        </div>
        {liste('ATA', ata, 0)}
        <div className="border-t border-b border-slate-100 bg-slate-50/60 px-5 py-4">
          <CardTitle
            sub="Hiçbir atama kuralı uymazsa irsaliye “Sınıflandırılmadı” kalır; uyan ilk öneri kuralı İnceleme’de hazır seçim olarak gelir."
            action={
              duzenleyebilir && (
                <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => ekle('ONER')}>
                  Öneri kuralı
                </Button>
              )
            }
          >
            Öneri kuralları
          </CardTitle>
        </div>
        {liste('ONER', oner, ata.length)}
      </Card>

      {/* Değişiklik çubuğu + önizleme */}
      {duzenleyebilir && (degisti || onizleme) && (
        <div className="sticky bottom-4 z-20">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-slate-900 px-5 py-3 text-sm text-white shadow-lg">
            <span className="min-w-0 flex-1">
              {hataSayisi > 0
                ? `${hataSayisi} kuralda hata var; düzeltince önizleyebilirsiniz.`
                : onizleme
                  ? 'Önizleme hazır — aşağıda kontrol edip uygulayın.'
                  : 'Kaydedilmemiş değişiklik var. Önce etkisini görün: hiçbir şey yazılmaz.'}
            </span>
            <Button size="sm" variant="ghostDark" icon={<Undo2 className="h-4 w-4" />} onClick={geriAl}>
              Geri al
            </Button>
            <Button size="sm" variant="primary" onClick={onizle} loading={onizleniyor} disabled={hataSayisi > 0}>
              Etkiyi önizle
            </Button>
          </div>
        </div>
      )}

      {hata && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{hata}</p>}

      {onizleme && (
        <Card padded={false}>
          <div className="border-b border-slate-100 px-5 py-4">
            <CardTitle
              sub={`${onizleme.ozet.incelenen.toLocaleString('tr-TR')} irsaliye yeni kurallarla yeniden denendi. Elle seçilmiş kategorilere dokunulmaz.`}
              action={
                <Button variant="primary" onClick={() => setOnayAcik(true)} disabled={onizleme.ozet.degisen === 0}>
                  Kaydet ve uygula
                </Button>
              }
            >
              Etki önizlemesi
            </CardTitle>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge tone={onizleme.ozet.etkinDegisen > 0 ? 'blue' : 'gray'}>{onizleme.ozet.etkinDegisen.toLocaleString('tr-TR')} irsaliyenin kategorisi değişir</Badge>
              {onizleme.ozet.elleKorunan > 0 && <Badge>{onizleme.ozet.elleKorunan.toLocaleString('tr-TR')} elle seçildiği için korunur</Badge>}
              {onizleme.ozet.yalnizOneri > 0 && <Badge>{onizleme.ozet.yalnizOneri.toLocaleString('tr-TR')} yalnız öneri/gerekçe</Badge>}
              {onizleme.ozet.degisen === 0 && <Badge tone="green">Hiçbir irsaliye etkilenmiyor</Badge>}
            </div>
          </div>
          {onizleme.gecisler.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                    <th className="px-5 py-2 font-medium">Geçiş</th>
                    <th className="px-3 py-2 font-medium">Sonuç</th>
                    <th className="px-3 py-2 text-right font-medium">İrsaliye</th>
                    <th className="px-3 py-2 text-right font-medium">Tutar</th>
                    <th className="px-5 py-2 text-right font-medium">Hesaptaki</th>
                  </tr>
                </thead>
                <tbody>
                  {onizleme.gecisler.map((g) => (
                    <tr key={g.eski + g.yeni} className={'border-b border-slate-100 ' + TON[g.ton].sinif}>
                      <td className="px-5 py-2">
                        <span className="inline-flex items-center gap-2">
                          <KategoriRozeti kod={g.eski} meta={kategoriler} />
                          <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                          <KategoriRozeti kod={g.yeni} meta={kategoriler} />
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={TON[g.ton].rozet}>{TON[g.ton].ad}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{g.adet.toLocaleString('tr-TR')}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{eur(g.tutar)}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{g.tahsisteki.toLocaleString('tr-TR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {onizleme.ornekler.length > 0 && (
            <details className="border-t border-slate-100">
              <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Örnek irsaliyeler (en yüksek tutarlı {onizleme.ornekler.length})
              </summary>
              <div className="max-h-96 overflow-auto">
                <table className="w-full min-w-max text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="px-5 py-2 font-medium">Fiş No</th>
                      <th className="px-3 py-2 font-medium">Firma</th>
                      <th className="px-3 py-2 font-medium">Belge No</th>
                      <th className="px-3 py-2 font-medium">Eski → Yeni</th>
                      <th className="px-5 py-2 text-right font-medium">Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {onizleme.ornekler.map((o) => (
                      <tr key={o.fis_no} className="border-b border-slate-100">
                        <td className="px-5 py-1.5 font-medium">{o.fis_no}</td>
                        <td className="px-3 py-1.5">{o.firma}</td>
                        <td className="max-w-[16rem] truncate px-3 py-1.5" title={o.belge_no}>
                          {o.belge_no || '—'}
                        </td>
                        <td className="px-3 py-1.5">
                          {kategoriEtiketi(kategoriler, o.eski)} → {kategoriEtiketi(kategoriler, o.yeni)}
                        </td>
                        <td className="px-5 py-1.5 text-right tabular-nums">{eur(o.tutar)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </Card>
      )}

      <ConfirmDialog
        acik={onayAcik}
        baslik="Kurallar kaydedilip uygulansın mı?"
        onayMetni="Kaydet ve uygula"
        tehlikeli={kayipVar}
        mesgul={uygulaniyor}
        onOnay={uygula}
        onVazgec={() => setOnayAcik(false)}
      >
        <p>
          <strong>{onizleme?.ozet.etkinDegisen.toLocaleString('tr-TR') ?? 0} irsaliyenin</strong> kategorisi değişecek; gerekiyorsa taksitleri
          kurulur ya da kaldırılır ve tüm firmalar yeniden hesaplanır.
        </p>
        {kayipVar && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
            Bazı irsaliyeler borç hesabından çıkacak (kırmızı satırlar). Emin değilseniz vazgeçip kuralları gözden geçirin.
          </p>
        )}
        <p className="text-xs text-slate-500">Elle seçilmiş kategoriler ve girilmiş ödeme planları değişmez. İşlem denetim kaydına yazılır.</p>
      </ConfirmDialog>
    </div>
  )
}
