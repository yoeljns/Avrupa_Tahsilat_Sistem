'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { Check, Copy, KeyRound, Lock, Power, Search, ShieldCheck, UserPlus, X } from 'lucide-react'
import Badge, { type BadgeTone } from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card, { CardTitle } from '@/components/ui/Card'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { postJson } from '@/lib/istek'

// Kullanıcı yönetimi (yalnız yönetici). Rol değişikliği, pasifleştirme ve şifre
// sıfırlama onayla yapılır; geçici şifre kopyalanana kadar ekranda kalır.

export interface UserRow {
  id: string
  email: string
  fullName: string | null
  role: string
  isActive: boolean
  /** Bayi listesinde bu e-postaya atanmış firma sayısı */
  firmaSayisi: number
  sahip: boolean
}

const ROLLER: Array<{ value: string; label: string; ton: BadgeTone; aciklama: string }> = [
  { value: 'pazarlamaci', label: 'Pazarlamacı', ton: 'gray', aciklama: 'Yalnız kendisine atanmış firmaların borçlarını görür.' },
  { value: 'tahsilat_yoneticisi', label: 'Tahsilat Yöneticisi', ton: 'blue', aciklama: 'Tüm firmaları görür; içe aktarır, irsaliye düzenler, rapor indirir.' },
  { value: 'yonetici', label: 'Yönetici', ton: 'violet', aciklama: 'Her şey + kullanıcılar, kategoriler ve tanıma kuralları.' },
]
const ROL = new Map(ROLLER.map((r) => [r.value, r]))

type Suzgec = 'hepsi' | 'yonetici' | 'tahsilat_yoneticisi' | 'pazarlamaci' | 'pasif'

type Onay =
  | { tur: 'rol'; u: UserRow; yeniRol: string }
  | { tur: 'durum'; u: UserRow }
  | { tur: 'sifre'; u: UserRow }

function basHarfler(u: UserRow): string {
  const kaynak = (u.fullName ?? u.email.split('@')[0]).trim()
  const parca = kaynak.split(/[\s._-]+/).filter(Boolean)
  return ((parca[0]?.[0] ?? '') + (parca[1]?.[0] ?? '')).toLocaleUpperCase('tr-TR') || '?'
}

export default function UserAdmin({ users, selfId, sahipMi }: { users: UserRow[]; selfId: string; sahipMi: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('pazarlamaci')
  const [olusturuluyor, setOlusturuluyor] = useState(false)
  const [formHata, setFormHata] = useState<string | null>(null)
  const [sifre, setSifre] = useState<{ email: string; sifre: string; kopyalandi: boolean } | null>(null)
  const [ara, setAra] = useState('')
  const [suzgec, setSuzgec] = useState<Suzgec>('hepsi')
  const [onay, setOnay] = useState<Onay | null>(null)
  const [mesgul, setMesgul] = useState(false)

  const sayilar = useMemo(() => {
    const s: Record<Suzgec, number> = { hepsi: users.length, yonetici: 0, tahsilat_yoneticisi: 0, pazarlamaci: 0, pasif: 0 }
    for (const u of users) {
      if (!u.isActive) s.pasif++
      else if (u.role in s) s[u.role as Suzgec]++
    }
    return s
  }, [users])

  const gorunen = useMemo(() => {
    const q = ara.trim().toLocaleLowerCase('tr-TR')
    return users.filter((u) => {
      if (suzgec === 'pasif' ? u.isActive : suzgec !== 'hepsi' && (u.role !== suzgec || !u.isActive)) return false
      if (!q) return true
      return u.email.toLocaleLowerCase('tr-TR').includes(q) || (u.fullName ?? '').toLocaleLowerCase('tr-TR').includes(q)
    })
  }, [users, ara, suzgec])

  async function olustur(e: React.FormEvent) {
    e.preventDefault()
    setFormHata(null)
    setOlusturuluyor(true)
    const r = await postJson<{ tempPassword: string }>('/api/admin/users', { action: 'create', email, fullName: fullName || undefined, role })
    setOlusturuluyor(false)
    if (!r.ok) return setFormHata(r.error)
    setSifre({ email: email.trim().toLowerCase(), sifre: r.data.tempPassword, kopyalandi: false })
    setEmail('')
    setFullName('')
    toast('Kullanıcı oluşturuldu.')
    router.refresh()
  }

  async function onayla() {
    if (!onay) return
    setMesgul(true)
    const u = onay.u
    const govde =
      onay.tur === 'rol'
        ? { action: 'update', userId: u.id, role: onay.yeniRol }
        : onay.tur === 'durum'
          ? { action: 'update', userId: u.id, isActive: !u.isActive }
          : { action: 'update', userId: u.id, resetPassword: true }
    const r = await postJson<{ tempPassword?: string }>('/api/admin/users', govde)
    setMesgul(false)
    setOnay(null)
    if (!r.ok) return toast(r.error, 'hata')
    if (onay.tur === 'sifre' && r.data.tempPassword) {
      setSifre({ email: u.email, sifre: r.data.tempPassword, kopyalandi: false })
      toast('Yeni geçici şifre oluşturuldu.')
    } else {
      toast(onay.tur === 'rol' ? `${u.email} artık ${ROL.get(onay.yeniRol)?.label}.` : u.isActive ? `${u.email} pasifleştirildi.` : `${u.email} aktifleştirildi.`)
    }
    router.refresh()
  }

  async function kopyala() {
    if (!sifre) return
    try {
      await navigator.clipboard.writeText(sifre.sifre)
      setSifre({ ...sifre, kopyalandi: true })
    } catch {
      toast('Kopyalanamadı; şifreyi seçip elle kopyalayın.', 'hata')
    }
  }

  const SUZGECLER: Array<{ k: Suzgec; ad: string }> = [
    { k: 'hepsi', ad: 'Tümü' },
    { k: 'yonetici', ad: 'Yönetici' },
    { k: 'tahsilat_yoneticisi', ad: 'Tahsilat Yöneticisi' },
    { k: 'pazarlamaci', ad: 'Pazarlamacı' },
    { k: 'pasif', ad: 'Pasif' },
  ]

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle icon={<UserPlus className="h-4 w-4" />} sub="Kişiye e-posta gitmez; oluşan geçici şifreyi siz iletirsiniz. İlk girişte kendisi değiştirebilir (Hesabım).">
          Yeni kullanıcı
        </CardTitle>
        <form onSubmit={olustur} className="mt-4 grid grid-cols-1 items-end gap-3 md:grid-cols-[2fr_2fr_1.5fr_auto]">
          <Field label="E-posta">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kisi@avrupagroup.com" />
          </Field>
          <Field label="Ad Soyad">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Rol">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLLER.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="primary" loading={olusturuluyor} disabled={!email.trim()}>
            Oluştur
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">{ROL.get(role)?.aciklama}</p>
        {formHata && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formHata}</p>}
      </Card>

      {sifre && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-emerald-50 px-5 py-4 ring-1 ring-emerald-200">
          <KeyRound className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm text-emerald-900">
            <p>
              <strong>{sifre.email}</strong> için geçici şifre — şimdi kopyalayıp iletin, bu ekrandan ayrılınca bir daha gösterilmez:
            </p>
            <p className="mt-1 font-mono text-base font-semibold tracking-wide select-all">{sifre.sifre}</p>
          </div>
          <Button variant={sifre.kopyalandi ? 'secondary' : 'primary'} onClick={kopyala} icon={sifre.kopyalandi ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}>
            {sifre.kopyalandi ? 'Kopyalandı' : 'Kopyala'}
          </Button>
          <button type="button" onClick={() => setSifre(null)} className="rounded p-1 text-emerald-700 hover:bg-emerald-100" aria-label="Kapat">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex flex-wrap gap-1.5">
            {SUZGECLER.map((s) => (
              <button
                key={s.k}
                type="button"
                onClick={() => setSuzgec(s.k)}
                className={
                  'rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ' +
                  (suzgec === s.k ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')
                }
              >
                {s.ad} <span className={suzgec === s.k ? 'text-blue-100' : 'text-slate-400'}>{sayilar[s.k]}</span>
              </button>
            ))}
          </div>
          <label className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input boyut="sm" value={ara} onChange={(e) => setAra(e.target.value)} placeholder="E-posta ya da ad ara" className="pl-8" aria-label="Kullanıcı ara" />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                <th className="px-5 py-2 font-medium">Kullanıcı</th>
                <th className="px-3 py-2 font-medium">Rol</th>
                <th className="px-3 py-2 text-right font-medium">Firma</th>
                <th className="px-3 py-2 font-medium">Durum</th>
                <th className="px-5 py-2 text-right font-medium">İşlemler</th>
              </tr>
            </thead>
            <tbody>
              {gorunen.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                    Kullanıcı bulunamadı.
                  </td>
                </tr>
              )}
              {gorunen.map((u) => {
                const kendisi = u.id === selfId
                const kilitli = u.sahip && !sahipMi
                const rol = ROL.get(u.role)
                return (
                  <tr key={u.id} className={'border-b border-slate-100 ' + (u.isActive ? '' : 'bg-slate-50/80 text-slate-500')}>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-3">
                        <span
                          className={
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ' +
                            (u.isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500')
                          }
                          aria-hidden="true"
                        >
                          {basHarfler(u)}
                        </span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 font-medium text-slate-900">
                            {u.email}
                            {kendisi && <Badge tone="blue">siz</Badge>}
                            {u.sahip && (
                              <Badge tone="violet" title="Sistemin sahibi: veri sıfırlama yalnız bu hesaba açıktır">
                                <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Sahip
                              </Badge>
                            )}
                          </p>
                          <p className="text-xs text-slate-500">{u.fullName ?? '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {kendisi || kilitli ? (
                        <Badge tone={rol?.ton ?? 'gray'}>{rol?.label ?? u.role}</Badge>
                      ) : (
                        <Select
                          boyut="xs"
                          tam={false}
                          value={u.role}
                          onChange={(e) => setOnay({ tur: 'rol', u, yeniRol: e.target.value })}
                          aria-label={`${u.email} rolü`}
                        >
                          {ROLLER.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {u.role === 'pazarlamaci' ? (
                        u.firmaSayisi > 0 ? (
                          u.firmaSayisi
                        ) : (
                          <span className="text-xs text-amber-700" title="Bayi listesinde bu e-postaya atanmış firma yok; pazarlamacı hiçbir firma göremez">
                            atanmamış
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-slate-400">tümü</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">{u.isActive ? <Badge tone="green">Aktif</Badge> : <Badge>Pasif</Badge>}</td>
                    <td className="px-5 py-2.5 text-right">
                      {kilitli ? (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" /> yalnız sahibi değiştirebilir
                        </span>
                      ) : (
                        <span className="inline-flex gap-1.5">
                          <Button size="sm" icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => setOnay({ tur: 'sifre', u })}>
                            Şifre sıfırla
                          </Button>
                          {!kendisi && (
                            <Button
                              size="sm"
                              variant={u.isActive ? 'dangerOutline' : 'secondary'}
                              icon={<Power className="h-3.5 w-3.5" aria-hidden="true" />}
                              onClick={() => setOnay({ tur: 'durum', u })}
                            >
                              {u.isActive ? 'Pasifleştir' : 'Aktifleştir'}
                            </Button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmDialog
        acik={onay !== null}
        baslik={
          onay?.tur === 'rol'
            ? 'Rol değiştirilsin mi?'
            : onay?.tur === 'sifre'
              ? 'Şifre sıfırlansın mı?'
              : onay?.u.isActive
                ? 'Kullanıcı pasifleştirilsin mi?'
                : 'Kullanıcı aktifleştirilsin mi?'
        }
        onayMetni={onay?.tur === 'rol' ? 'Rolü değiştir' : onay?.tur === 'sifre' ? 'Yeni şifre oluştur' : onay?.u.isActive ? 'Pasifleştir' : 'Aktifleştir'}
        tehlikeli={onay?.tur === 'durum' && onay.u.isActive}
        mesgul={mesgul}
        onOnay={onayla}
        onVazgec={() => setOnay(null)}
      >
        {onay?.tur === 'rol' && (
          <p>
            <strong>{onay.u.email}</strong>: {ROL.get(onay.u.role)?.label} → <strong>{ROL.get(onay.yeniRol)?.label}</strong>. {ROL.get(onay.yeniRol)?.aciklama}
          </p>
        )}
        {onay?.tur === 'sifre' && (
          <p>
            <strong>{onay.u.email}</strong> için yeni bir geçici şifre oluşturulur; eski şifresi hemen geçersiz olur.
          </p>
        )}
        {onay?.tur === 'durum' &&
          (onay.u.isActive ? (
            <p>
              <strong>{onay.u.email}</strong> artık giriş yapamaz. Kayıtları ve geçmişi silinmez; istediğiniz zaman yeniden aktifleştirebilirsiniz.
            </p>
          ) : (
            <p>
              <strong>{onay.u.email}</strong> yeniden giriş yapabilir.
            </p>
          ))}
      </ConfirmDialog>
    </div>
  )
}
