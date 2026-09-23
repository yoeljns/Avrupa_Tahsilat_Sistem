'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowLeftRight, ArrowUp, Filter, LayoutGrid, ListChecks, Lock, Pencil, Plus, Power, Trash2, X } from 'lucide-react'
import KategoriRozeti from '@/components/KategoriRozeti'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { eur } from '@/lib/format'
import { postJson } from '@/lib/istek'
import { DAVRANISLAR, SINIFSIZ_KOD, davranisOf, type DavranisAnahtari } from '@/lib/kategoriMeta'
import type { KategoriKullanimi } from '@/lib/queries'
import { renkOf } from '@/lib/renkler'
import KategoriFormu from './KategoriFormu'
import DavranisDegistir from './DavranisDegistir'

// Yönetim → Satış Kategorileri. Yönetici oluşturur/düzenler/sıralar; Tahsilat Yöneticisi salt okur.

export function nerede(k: Pick<KategoriKullanimi, 'kod' | 'taraf'>): string {
  if (k.kod === SINIFSIZ_KOD) return 'İnceleme kuyruğu (borç hesabına girmez)'
  const d = DAVRANISLAR[davranisOf(k.taraf)]
  return d.sayfa ?? 'Yalnız firma kartında, bilgi olarak'
}

const DAVRANIS_TONU: Record<DavranisAnahtari, 'indigo' | 'blue' | 'gray'> = { PESIN: 'indigo', VADELI: 'blue', YOK: 'gray' }

export default function KategoriPaneli({ kategoriler, duzenleyebilir }: { kategoriler: KategoriKullanimi[]; duzenleyebilir: boolean }) {
  const router = useRouter()
  const toast = useToast()

  // Sıra: "Sınıflandırılmadı" her zaman en sonda ve yerinden oynamaz
  const ilkSira = useMemo(() => kategoriler.filter((k) => k.kod !== SINIFSIZ_KOD).map((k) => k.kod), [kategoriler])
  const [sira, setSira] = useState<string[]>(ilkSira)
  const [siraKaydediliyor, setSiraKaydediliyor] = useState(false)
  const siraDegisti = sira.join('|') !== ilkSira.join('|')
  // Sunucudan yeni liste gelince (ekleme/silme) yerel sırayı ona eşitle
  const [oncekiIlk, setOncekiIlk] = useState(ilkSira)
  if (oncekiIlk !== ilkSira) {
    setOncekiIlk(ilkSira)
    setSira(ilkSira)
  }

  const harita = useMemo(() => new Map(kategoriler.map((k) => [k.kod, k])), [kategoriler])
  const sirali = [...sira.map((kod) => harita.get(kod)).filter((k): k is KategoriKullanimi => !!k), ...kategoriler.filter((k) => k.kod === SINIFSIZ_KOD)]
  const meta = kategoriler

  const [form, setForm] = useState<{ tur: 'yeni' } | { tur: 'duzenle'; kategori: KategoriKullanimi } | null>(null)
  const [davranis, setDavranis] = useState<KategoriKullanimi | null>(null)
  const [onay, setOnay] = useState<{ tur: 'pasif' | 'sil'; kategori: KategoriKullanimi } | null>(null)
  const [mesgul, setMesgul] = useState<string | null>(null)
  const [yeniOlusan, setYeniOlusan] = useState<{ kod: string; ad: string } | null>(null)

  function tasi(kod: string, yon: -1 | 1) {
    setSira((s) => {
      const i = s.indexOf(kod)
      const j = i + yon
      if (i < 0 || j < 0 || j >= s.length) return s
      const yeni = s.slice()
      ;[yeni[i], yeni[j]] = [yeni[j], yeni[i]]
      return yeni
    })
  }

  async function siraKaydet() {
    setSiraKaydediliyor(true)
    const r = await postJson('/api/admin/kategoriler', { action: 'sirala', kodlar: sira })
    setSiraKaydediliyor(false)
    if (!r.ok) return toast(r.error, 'hata')
    toast('Sıralama kaydedildi. Seçenekler ve süzgeçler bu sırayla gösterilir.')
    router.refresh()
  }

  async function aktiflik(k: KategoriKullanimi, aktif: boolean) {
    setMesgul(k.kod)
    const r = await postJson('/api/admin/kategoriler', { action: 'guncelle', kod: k.kod, aktif })
    setMesgul(null)
    setOnay(null)
    if (!r.ok) return toast(r.error, 'hata')
    toast(aktif ? `“${k.ad}” yeniden kullanıma açıldı.` : `“${k.ad}” pasifleştirildi.`)
    router.refresh()
  }

  async function sil(k: KategoriKullanimi) {
    setMesgul(k.kod)
    const r = await postJson('/api/admin/kategoriler', { action: 'sil', kod: k.kod })
    setMesgul(null)
    setOnay(null)
    if (!r.ok) return toast(r.error, 'hata')
    toast(`“${k.ad}” silindi.`)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* Davranışlar: bir kategorinin ne işe yaradığını belirleyen tek seçim */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {(Object.keys(DAVRANISLAR) as DavranisAnahtari[]).map((a) => (
          <div key={a} className="rounded-xl bg-white p-4 ring-1 ring-slate-200/70">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Badge tone={DAVRANIS_TONU[a]}>{DAVRANISLAR[a].ad}</Badge>
              <span className="text-xs font-normal text-slate-500">{DAVRANISLAR[a].sayfa ?? 'Sayfada görünmez'}</span>
            </p>
            <p className="mt-1.5 text-xs text-slate-500">{DAVRANISLAR[a].aciklama}</p>
          </div>
        ))}
      </div>

      {!duzenleyebilir && (
        <p className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
          <Lock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          Bu ayarları görüntüleyebilirsiniz; değiştirmek yalnız Yönetici rolüne açıktır.
        </p>
      )}

      {yeniOlusan && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
          <span className="min-w-0 flex-1">
            <strong>“{yeniOlusan.ad}”</strong> hazır. İrsaliyelerin bu kategoriye kendiliğinden düşmesi için bir tanıma kuralı ekleyin
            (örneğin Belge No’da geçen bir kelime). Tek tek atamak için İnceleme ya da irsaliye düzenleme de kullanılabilir.
          </span>
          <Link
            href={`/yonetim/kurallar?yeni=${encodeURIComponent(yeniOlusan.kod)}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <ListChecks className="h-4 w-4" aria-hidden="true" /> Kural ekle
          </Link>
          <button type="button" onClick={() => setYeniOlusan(null)} className="rounded p-1 text-emerald-700 hover:bg-emerald-100" aria-label="Kapat">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Kategoriler ({kategoriler.length})</h2>
            <p className="text-xs text-slate-500">Sıra; seçeneklerde, süzgeç düğmelerinde ve raporlarda kullanılır.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {siraDegisti && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setSira(ilkSira)} disabled={siraKaydediliyor}>
                  Sırayı geri al
                </Button>
                <Button size="sm" variant="primary" onClick={siraKaydet} loading={siraKaydediliyor}>
                  Sırayı kaydet
                </Button>
              </>
            )}
            {duzenleyebilir && (
              <Button variant="primary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setForm({ tur: 'yeni' })}>
                Yeni kategori
              </Button>
            )}
          </div>
        </div>

        <ul className="divide-y divide-slate-100">
          {sirali.map((k, i) => {
            const d = davranisOf(k.taraf)
            const sinifsiz = k.kod === SINIFSIZ_KOD
            const silinebilir = !k.sistem && k.irsaliye === 0 && k.kural === 0
            const renk = renkOf(k.renk)
            return (
              <li key={k.kod} className={'border-l-4 px-5 py-4 ' + renk.kenar + (k.aktif ? '' : ' bg-slate-50/80')}>
                <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                  {/* Kimlik */}
                  <div className="min-w-[14rem] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <KategoriRozeti kod={k.kod} meta={meta} />
                      {k.kisa_ad && k.kisa_ad !== k.ad && <span className="text-xs text-slate-500">kısa: {k.kisa_ad}</span>}
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{k.kod}</code>
                      {k.sistem && (
                        <Badge title="Sistem kategorisi: davranışı değişmez, silinemez">
                          <Lock className="h-3 w-3" aria-hidden="true" /> Sistem
                        </Badge>
                      )}
                      {!k.aktif && <Badge tone="amber">Pasif</Badge>}
                    </div>
                    {k.aciklama && <p className="mt-1 text-xs text-slate-500">{k.aciklama}</p>}
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                      {!sinifsiz && <Badge tone={DAVRANIS_TONU[d]}>{DAVRANISLAR[d].ad}</Badge>}
                      <span className="text-slate-500">{nerede(k)}</span>
                      {!sinifsiz && k.taraf !== null && (
                        <>
                          <span className={'inline-flex items-center gap-1 ' + (k.sayfada_suzgec ? 'text-slate-700' : 'text-slate-400 line-through')}>
                            <Filter className="h-3.5 w-3.5" aria-hidden="true" /> süzgeç düğmesi
                          </span>
                          <span className={'inline-flex items-center gap-1 ' + (k.panoda_kart ? 'text-slate-700' : 'text-slate-400 line-through')}>
                            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" /> panoda kart
                          </span>
                        </>
                      )}
                    </p>
                  </div>

                  {/* Kullanım */}
                  <dl className="grid w-full grid-cols-2 gap-x-5 gap-y-2 text-xs sm:w-[27rem] sm:shrink-0 sm:grid-cols-[4.5rem_3.5rem_1fr_3rem] sm:text-right">
                    <div>
                      <dt className="text-slate-400">İrsaliye</dt>
                      <dd className="font-semibold tabular-nums text-slate-800">{k.irsaliye.toLocaleString('tr-TR')}</dd>
                      {k.elle > 0 && <dd className="text-[11px] text-slate-400">{k.elle} elle</dd>}
                    </div>
                    <div>
                      <dt className="text-slate-400">Firma</dt>
                      <dd className="font-semibold tabular-nums text-slate-800">{k.firma.toLocaleString('tr-TR')}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">{k.taraf === null ? 'Tutar' : 'Açık borç'}</dt>
                      <dd className="font-semibold whitespace-nowrap tabular-nums text-slate-800">{eur(k.taraf === null ? k.tutar : k.acik)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Kural</dt>
                      <dd className="font-semibold tabular-nums text-slate-800">{sinifsiz ? '—' : k.kural}</dd>
                    </div>
                  </dl>
                </div>

                {duzenleyebilir && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {!sinifsiz && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => tasi(k.kod, -1)} disabled={i === 0} aria-label={`${k.ad} yukarı`} title="Yukarı taşı">
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => tasi(k.kod, 1)}
                          disabled={i >= sira.length - 1}
                          aria-label={`${k.ad} aşağı`}
                          title="Aşağı taşı"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
                      </>
                    )}
                    <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => setForm({ tur: 'duzenle', kategori: k })}>
                      Düzenle
                    </Button>
                    {!k.sistem && (
                      <Button size="sm" icon={<ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => setDavranis(k)}>
                        Davranışı değiştir
                      </Button>
                    )}
                    {!k.sistem &&
                      (k.aktif ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Power className="h-3.5 w-3.5" aria-hidden="true" />}
                          onClick={() => setOnay({ tur: 'pasif', kategori: k })}
                          loading={mesgul === k.kod}
                        >
                          Pasifleştir
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Power className="h-3.5 w-3.5" aria-hidden="true" />}
                          onClick={() => aktiflik(k, true)}
                          loading={mesgul === k.kod}
                        >
                          Aktifleştir
                        </Button>
                      ))}
                    {!k.sistem && (
                      <Button
                        size="sm"
                        variant="dangerOutline"
                        icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                        onClick={() => setOnay({ tur: 'sil', kategori: k })}
                        disabled={!silinebilir}
                        title={silinebilir ? 'Kalıcı olarak sil' : 'İrsaliyede ya da kuralda kullanılan kategori silinemez; pasifleştirin.'}
                      >
                        Sil
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Card>

      {form && (
        <KategoriFormu
          kategori={form.tur === 'duzenle' ? form.kategori : null}
          mevcut={kategoriler}
          onKapat={() => setForm(null)}
          onKaydedildi={(sonuc) => {
            setForm(null)
            if (sonuc.yeni) setYeniOlusan({ kod: sonuc.kod, ad: sonuc.ad })
            toast(sonuc.yeni ? `“${sonuc.ad}” oluşturuldu.` : 'Değişiklikler kaydedildi.')
            router.refresh()
          }}
        />
      )}

      {davranis && (
        <DavranisDegistir
          kategori={davranis}
          onKapat={() => setDavranis(null)}
          onUygulandi={(mesaj) => {
            setDavranis(null)
            toast(mesaj)
            router.refresh()
          }}
        />
      )}

      <ConfirmDialog
        acik={onay?.tur === 'pasif'}
        baslik={`“${onay?.kategori.ad ?? ''}” pasifleştirilsin mi?`}
        onayMetni="Pasifleştir"
        mesgul={!!mesgul}
        onOnay={() => onay && aktiflik(onay.kategori, false)}
        onVazgec={() => setOnay(null)}
      >
        <p>Kategori; atama seçeneklerinden, tanıma kuralı hedeflerinden ve süzgeç düğmelerinden kalkar.</p>
        {onay && onay.kategori.irsaliye > 0 && (
          <p>
            Bu kategorideki <strong>{onay.kategori.irsaliye.toLocaleString('tr-TR')} irsaliye</strong> olduğu gibi kalır ve hesaba katılmaya
            devam eder. İstediğiniz zaman yeniden aktifleştirebilirsiniz.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        acik={onay?.tur === 'sil'}
        baslik={`“${onay?.kategori.ad ?? ''}” silinsin mi?`}
        onayMetni="Kalıcı olarak sil"
        tehlikeli
        mesgul={!!mesgul}
        onOnay={() => onay && sil(onay.kategori)}
        onVazgec={() => setOnay(null)}
      >
        <p>Kategori hiçbir irsaliyede ya da kuralda kullanılmıyor; silindiğinde geri getirilemez (aynı adla yeniden oluşturulabilir).</p>
      </ConfirmDialog>
    </div>
  )
}
