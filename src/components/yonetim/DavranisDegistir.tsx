'use client'

import { useState } from 'react'
import { ArrowRight, TriangleAlert } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { eur } from '@/lib/format'
import { postJson } from '@/lib/istek'
import { DAVRANISLAR, davranisOf, type DavranisAnahtari, type KategoriMeta } from '@/lib/kategoriMeta'

// Kategorinin davranışını değiştirme: önce etki gösterilir, onayla uygulanır
// (taksitler tek işlemde uyarlanır, ardından tüm firmalar yeniden hesaplanır).

interface Etki {
  irsaliye: number
  tahsisteki: number
  acik: number
  firma: number
  elle_taksitli: number
}

function sonuclar(eski: DavranisAnahtari, yeni: DavranisAnahtari, e: Etki): string[] {
  const n = e.irsaliye.toLocaleString('tr-TR')
  const satirlar: string[] = []
  if (yeni === 'YOK') {
    satirlar.push(`${n} irsaliyenin borcu hesaptan çıkar${e.acik > 0 ? ` (bugün açık: ${eur(e.acik)})` : ''}; ${DAVRANISLAR[eski].sayfa ?? 'sayfa'}ndan kalkar.`)
    satirlar.push('Bu irsaliyelere dağıtılmış ödemeler serbest kalır ve firmanın diğer borçlarına dağıtılır.')
    satirlar.push('Otomatik taksitleri silinir' + (e.elle_taksitli > 0 ? `; elle girilmiş taksitler (${e.elle_taksitli} irsaliye) saklanır ama sayılmaz.` : '.'))
  } else if (eski === 'YOK') {
    satirlar.push(`${n} irsaliye borç hesabına girer ve ${DAVRANISLAR[yeni].sayfa} içinde görünür.`)
    satirlar.push('Taksitleri ödeme planlarından (yoksa irsaliye tarihinden) kurulur; firmaların ödemeleri bunlara da dağıtılır.')
  } else {
    satirlar.push(`${n} irsaliye ${DAVRANISLAR[eski].sayfa}ndan ${DAVRANISLAR[yeni].sayfa}na geçer.`)
    satirlar.push(
      yeni === 'PESIN'
        ? 'Ödemeler artık önce bunları kapatır (en eskiden); vadeli borçlar sonra kapanır.'
        : 'Ödemeler önce peşin borçları kapatır, bunlar planlarındaki vadeye göre sonra kapanır.',
    )
  }
  satirlar.push(`Tüm firmalar yeniden hesaplanır${e.firma > 0 ? ` (${e.firma} firma doğrudan etkilenir)` : ''}. İşlem denetim kaydına yazılır ve geri alınabilir.`)
  return satirlar
}

export default function DavranisDegistir({
  kategori,
  onKapat,
  onUygulandi,
}: {
  kategori: KategoriMeta
  onKapat: () => void
  onUygulandi: (mesaj: string) => void
}) {
  const eski = davranisOf(kategori.taraf)
  const secenekler = (Object.keys(DAVRANISLAR) as DavranisAnahtari[]).filter((a) => a !== eski)
  const [hedef, setHedef] = useState<DavranisAnahtari | null>(null)
  const [etki, setEtki] = useState<Etki | null>(null)
  const [yukleniyor, setYukleniyor] = useState(false)
  const [uygulaniyor, setUygulaniyor] = useState(false)
  const [hata, setHata] = useState<string | null>(null)

  const taraf = (a: DavranisAnahtari) => (a === 'YOK' ? null : a)

  async function sec(a: DavranisAnahtari) {
    setHedef(a)
    setEtki(null)
    setHata(null)
    setYukleniyor(true)
    const r = await postJson<{ etki: Etki }>('/api/admin/kategoriler/taraf', { kod: kategori.kod, taraf: taraf(a), uygula: false })
    setYukleniyor(false)
    if (!r.ok) return setHata(r.error)
    setEtki(r.data.etki)
  }

  async function uygula() {
    if (!hedef) return
    setHata(null)
    setUygulaniyor(true)
    const r = await postJson<{ etki: Etki }>('/api/admin/kategoriler/taraf', { kod: kategori.kod, taraf: taraf(hedef), uygula: true })
    setUygulaniyor(false)
    if (!r.ok) return setHata(r.error)
    onUygulandi(`“${kategori.ad}” artık ${DAVRANISLAR[hedef].ad.toLocaleLowerCase('tr')}; ${r.data.etki.irsaliye} irsaliye uyarlandı ve hesap yenilendi.`)
  }

  return (
    <Modal
      acik
      onKapat={onKapat}
      kapatilamaz={uygulaniyor}
      genislik="lg"
      baslik={`“${kategori.ad}” davranışını değiştir`}
      aciklama={`Şu an: ${DAVRANISLAR[eski].ad} — ${DAVRANISLAR[eski].sayfa ?? 'sayfada görünmez'}`}
      altBilgi={
        <>
          <Button onClick={onKapat} disabled={uygulaniyor}>
            Vazgeç
          </Button>
          <Button variant="primary" onClick={uygula} disabled={!hedef || !etki || yukleniyor} loading={uygulaniyor}>
            {uygulaniyor ? 'Uygulanıyor ve hesaplanıyor…' : 'Değiştir ve yeniden hesapla'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {secenekler.map((a) => {
            const secili = hedef === a
            return (
              <button
                key={a}
                type="button"
                onClick={() => sec(a)}
                disabled={uygulaniyor}
                className={'rounded-xl p-3 text-left ring-inset ' + (secili ? 'bg-blue-50 ring-2 ring-blue-500' : 'bg-white ring-1 ring-slate-200 hover:ring-slate-300')}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  {DAVRANISLAR[eski].kisa} <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden="true" /> {DAVRANISLAR[a].ad}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">{DAVRANISLAR[a].aciklama}</span>
              </button>
            )
          })}
        </div>

        {hata && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{hata}</p>}
        {yukleniyor && <p className="text-sm text-slate-500">Etki hesaplanıyor…</p>}

        {hedef && etki && (
          <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <TriangleAlert className="h-4 w-4" aria-hidden="true" /> Bu değişiklik şunları yapar:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
              {sonuclar(eski, hedef, etki).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-amber-700">İrsaliye</dt>
                <dd className="font-semibold tabular-nums text-amber-950">{etki.irsaliye.toLocaleString('tr-TR')}</dd>
              </div>
              <div>
                <dt className="text-amber-700">Hesaptaki</dt>
                <dd className="font-semibold tabular-nums text-amber-950">{etki.tahsisteki.toLocaleString('tr-TR')}</dd>
              </div>
              <div>
                <dt className="text-amber-700">Açık borç</dt>
                <dd className="font-semibold tabular-nums text-amber-950">{eur(etki.acik)}</dd>
              </div>
              <div>
                <dt className="text-amber-700">Firma</dt>
                <dd className="font-semibold tabular-nums text-amber-950">{etki.firma.toLocaleString('tr-TR')}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </Modal>
  )
}
