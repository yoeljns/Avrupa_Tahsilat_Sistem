'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { Search, UserCheck, UserX, X } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card, { CardTitle } from '@/components/ui/Card'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Input, Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { postJson } from '@/lib/istek'
import { sade } from '@/lib/takvim'

// Firma başına sorumlu (pazarlamacı) atama — dosya yüklemeden. Seçilen firmalara
// tek adımda sorumlu atanır ya da sorumluları kaldırılır. Sorumlu; pazarlamacının
// hangi firmaları göreceğini, tablolardaki SORUMLU sütununu ve rapor kırılımlarını belirler.

export interface SorumluFirma {
  id: string
  kod: string
  ad: string
  sehir: string | null
  /** sorumlu e-postası (küçük harf) ya da null */
  sorumlu: string | null
}

export interface SorumluSecenek {
  email: string
  ad: string | null
  /** bu e-postayla AKTİF kullanıcı var mı */
  aktifKullanici: boolean
  rol: string | null
  /** şu an bu e-postaya atanmış firma sayısı */
  firma: number
}

const YENI = '__yeni__'

/** 'ercan@avrupagroup.com' → 'ERCAN' (tablolarda görünen sorumlu adı) */
function sorumluAdi(email: string): string {
  return email.split('@')[0].toUpperCase()
}

export default function SorumluAtama({ firmalar, secenekler }: { firmalar: SorumluFirma[]; secenekler: SorumluSecenek[] }) {
  const router = useRouter()
  const toast = useToast()
  const [ara, setAra] = useState('')
  const [suzgec, setSuzgec] = useState('hepsi') // 'hepsi' | 'bos' | e-posta
  const [secili, setSecili] = useState<Set<string>>(new Set())
  const [hedef, setHedef] = useState('')
  const [yeniEmail, setYeniEmail] = useState('')
  const [mesgul, setMesgul] = useState(false)
  const [kaldirOnay, setKaldirOnay] = useState(false)

  const secenekHaritasi = useMemo(() => new Map(secenekler.map((s) => [s.email, s])), [secenekler])
  const kullanicilar = useMemo(() => secenekler.filter((s) => s.aktifKullanici), [secenekler])
  const digerleri = useMemo(() => secenekler.filter((s) => !s.aktifKullanici), [secenekler])
  const sorumlusuz = useMemo(() => firmalar.filter((f) => !f.sorumlu).length, [firmalar])

  const gorunen = useMemo(() => {
    const q = sade(ara)
    return firmalar.filter((f) => {
      if (suzgec === 'bos' ? !!f.sorumlu : suzgec !== 'hepsi' && f.sorumlu !== suzgec) return false
      return !q || sade(`${f.kod} ${f.ad} ${f.sehir ?? ''}`).includes(q)
    })
  }, [firmalar, ara, suzgec])

  const gorunenSecili = gorunen.filter((f) => secili.has(f.id)).length
  const hepsiSecili = gorunen.length > 0 && gorunenSecili === gorunen.length

  function degistir(id: string) {
    setSecili((s) => {
      const y = new Set(s)
      if (y.has(id)) y.delete(id)
      else y.add(id)
      return y
    })
  }
  function hepsiniDegistir() {
    setSecili((s) => {
      const y = new Set(s)
      for (const f of gorunen) {
        if (hepsiSecili) y.delete(f.id)
        else y.add(f.id)
      }
      return y
    })
  }

  const hedefEmail = (hedef === YENI ? yeniEmail : hedef).trim().toLowerCase()

  async function ata(email: string | null) {
    setMesgul(true)
    const r = await postJson<{ degisen: number; kullaniciYok: boolean }>('/api/admin/sorumlu', { firmIds: Array.from(secili), email })
    setMesgul(false)
    setKaldirOnay(false)
    if (!r.ok) return toast(r.error, 'hata')
    const n = r.data.degisen
    if (email) {
      toast(n > 0 ? `${n} firmanın sorumlusu ${sorumluAdi(email)} oldu.` : 'Seçilen firmaların sorumlusu zaten buydu; değişiklik yok.')
      if (r.data.kullaniciYok) {
        toast('Bu e-postayla aktif kullanıcı yok. Firmalar etiketlendi; pazarlamacının giriş yapabilmesi için Kullanıcılar sayfasından hesap açın.', 'bilgi')
      }
    } else {
      toast(n > 0 ? `${n} firmanın sorumlusu kaldırıldı.` : 'Seçilen firmalarda sorumlu yoktu; değişiklik yok.')
    }
    setSecili(new Set())
    setHedef('')
    setYeniEmail('')
    router.refresh()
  }

  return (
    <Card padded={false}>
      <div className="border-b border-slate-100 px-5 py-4">
        <CardTitle
          icon={<UserCheck className="h-4 w-4" />}
          sub={`${firmalar.length.toLocaleString('tr-TR')} firma · ${sorumlusuz.toLocaleString('tr-TR')} firmada sorumlu yok`}
        >
          Firmalar ve sorumluları
        </CardTitle>
        <p className="mt-2 max-w-3xl text-xs text-slate-500">
          Firmaları işaretleyip sorumlu seçin. Sorumlu; pazarlamacının hangi firmaları göreceğini, tablolardaki ve Excel&apos;deki SORUMLU sütununu ve
          raporlardaki sorumlu kırılımını belirler. Borç hesabını etkilemez.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input boyut="sm" className="pl-8" type="search" value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Firma ara (kod, ad ya da şehir)" aria-label="Firma ara" />
          </div>
          <Select boyut="sm" tam={false} value={suzgec} onChange={(e) => setSuzgec(e.target.value)} aria-label="Sorumluya göre süz">
            <option value="hepsi">Tüm firmalar</option>
            <option value="bos">Sorumlusu olmayanlar ({sorumlusuz})</option>
            {secenekler
              .filter((s) => s.firma > 0)
              .map((s) => (
                <option key={s.email} value={s.email}>
                  {sorumluAdi(s.email)} ({s.firma})
                </option>
              ))}
          </Select>
          <span className="text-xs text-slate-500 sm:ml-auto">
            {gorunen.length === firmalar.length ? `${firmalar.length} firma` : `${gorunen.length} / ${firmalar.length} firma`}
          </span>
        </div>
      </div>

      {secili.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-blue-200 bg-blue-50 px-5 py-3 text-sm">
          <span className="font-semibold text-blue-900">{secili.size} firma seçili</span>
          <Select boyut="sm" tam={false} value={hedef} onChange={(e) => setHedef(e.target.value)} aria-label="Atanacak sorumlu" className="max-w-full sm:max-w-xs">
            <option value="">Sorumlu seçin…</option>
            {kullanicilar.length > 0 && (
              <optgroup label="Kullanıcılar">
                {kullanicilar.map((s) => (
                  <option key={s.email} value={s.email}>
                    {(s.ad ?? sorumluAdi(s.email)) + ' — ' + s.email}
                  </option>
                ))}
              </optgroup>
            )}
            {digerleri.length > 0 && (
              <optgroup label="Kullanımdaki diğer e-postalar">
                {digerleri.map((s) => (
                  <option key={s.email} value={s.email}>
                    {s.email}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={YENI}>Başka e-posta yaz…</option>
          </Select>
          {hedef === YENI && (
            <Input
              boyut="sm"
              tam={false}
              type="email"
              value={yeniEmail}
              onChange={(e) => setYeniEmail(e.target.value)}
              placeholder="ornek@avrupagroup.com"
              aria-label="Sorumlu e-postası"
              className="w-56"
            />
          )}
          <Button size="sm" variant="primary" loading={mesgul && !kaldirOnay} disabled={mesgul || !hedefEmail} onClick={() => ata(hedefEmail)}>
            Sorumlu ata
          </Button>
          <Button size="sm" variant="dangerOutline" icon={<UserX className="h-3.5 w-3.5" aria-hidden="true" />} disabled={mesgul} onClick={() => setKaldirOnay(true)}>
            Sorumluyu kaldır
          </Button>
          <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" aria-hidden="true" />} disabled={mesgul} onClick={() => setSecili(new Set())}>
            Seçimi temizle
          </Button>
        </div>
      )}

      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-max text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <th className="w-10 px-5 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-blue-600"
                  checked={hepsiSecili}
                  onChange={hepsiniDegistir}
                  aria-label={hepsiSecili ? 'Görünen firmaların seçimini kaldır' : 'Görünen firmaların hepsini seç'}
                />
              </th>
              <th className="px-3 py-2 font-medium">Kod</th>
              <th className="px-3 py-2 font-medium">Firma</th>
              <th className="px-3 py-2 font-medium">Şehir</th>
              <th className="px-5 py-2 font-medium">Sorumlu</th>
            </tr>
          </thead>
          <tbody>
            {gorunen.map((f) => {
              const s = f.sorumlu ? secenekHaritasi.get(f.sorumlu) : undefined
              const isaretli = secili.has(f.id)
              return (
                <tr key={f.id} className={'border-b border-slate-100 ' + (isaretli ? 'bg-blue-50/60' : 'hover:bg-slate-50')}>
                  <td className="px-5 py-2">
                    <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={isaretli} onChange={() => degistir(f.id)} aria-label={`${f.kod} ${f.ad} seç`} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/firmalar/${f.id}`} className="font-medium text-blue-700 hover:underline">
                      {f.kod}
                    </Link>
                  </td>
                  <td className="max-w-[28rem] truncate px-3 py-2" title={f.ad}>
                    {f.ad}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{f.sehir ?? ''}</td>
                  <td className="px-5 py-2">
                    {f.sorumlu ? (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-800">{sorumluAdi(f.sorumlu)}</span>
                        <span className="text-xs text-slate-500">{f.sorumlu}</span>
                        {s && !s.aktifKullanici && (
                          <Badge tone="amber" title="Bu e-postayla aktif kullanıcı yok; firma pazarlamacı girişinde görünmez">
                            kullanıcı yok
                          </Badge>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">— atanmadı</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {gorunen.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">
                  Süzgeçlere uyan firma yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        acik={kaldirOnay}
        baslik="Sorumlu kaldırılsın mı?"
        onayMetni="Sorumluyu kaldır"
        tehlikeli
        mesgul={mesgul}
        onOnay={() => ata(null)}
        onVazgec={() => setKaldirOnay(false)}
      >
        <p>
          Seçili <strong>{secili.size} firmanın</strong> sorumlusu kaldırılacak. Bu firmaları yalnız yönetim görür; pazarlamacılar göremez.
        </p>
      </ConfirmDialog>
    </Card>
  )
}
