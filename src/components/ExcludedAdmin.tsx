'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { ClipboardPaste, Plus, Search, Undo2 } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Card, { CardTitle } from '@/components/ui/Card'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { postJson } from '@/lib/istek'

// Takip dışı firma kodları. Her değişiklik borç kapsamını değiştirir → tam hesap (birkaç saniye).

export interface ExcludedRow {
  code: string
  note: string | null
  addedBy: string | null
  /** Bu kodla (Türkçe harf duyarsız) eşleşen firmalar */
  firmalar: Array<{ id: string; kod: string; ad: string }>
}

/** Yapıştırılan metinden kodlar: satır, virgül ya da noktalı virgülle ayrılmış */
function kodlariAyikla(metin: string): string[] {
  return Array.from(
    new Set(
      metin
        .split(/[\n,;\t]+/)
        .map((s) => s.trim().replace(/\s+/g, ' '))
        .filter((s) => s.length >= 2 && s.length <= 30),
    ),
  )
}

export default function ExcludedAdmin({ rows }: { rows: ExcludedRow[] }) {
  const router = useRouter()
  const toast = useToast()
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [toplu, setToplu] = useState(false)
  const [metin, setMetin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ara, setAra] = useState('')
  const [cikarilacak, setCikarilacak] = useState<ExcludedRow | null>(null)

  const topluKodlar = useMemo(() => kodlariAyikla(metin), [metin])
  const gorunen = useMemo(() => {
    const q = ara.trim().toLocaleUpperCase('tr-TR')
    if (!q) return rows
    return rows.filter((r) => r.code.toLocaleUpperCase('tr-TR').includes(q) || r.firmalar.some((f) => f.ad.toLocaleUpperCase('tr-TR').includes(q)))
  }, [rows, ara])

  async function ekle(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const govde = toplu ? { action: 'add', codes: topluKodlar, note: note.trim() || undefined } : { action: 'add', code: code.trim(), note: note.trim() || undefined }
    setBusy(true)
    const r = await postJson<{ eklenen: number }>('/api/admin/excluded', govde)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    toast(`${r.data.eklenen} kod takip dışına alındı; hesap yenilendi.`)
    setCode('')
    setNote('')
    setMetin('')
    router.refresh()
  }

  async function cikar(r: ExcludedRow) {
    setBusy(true)
    const s = await postJson('/api/admin/excluded', { action: 'remove', code: r.code })
    setBusy(false)
    setCikarilacak(null)
    if (!s.ok) return toast(s.error, 'hata')
    toast(`${r.code} yeniden takibe alındı; hesap yenilendi.`)
    router.refresh()
  }

  const eklenebilir = toplu ? topluKodlar.length > 0 : code.trim().length >= 2

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle
          icon={<Plus className="h-4 w-4" />}
          sub="Eklenen kodun irsaliye ve ödemeleri içe aktarılır ama borç takibine, tahsise ve ekranlara dahil edilmez."
          action={
            <Button size="sm" variant="ghost" icon={<ClipboardPaste className="h-4 w-4" aria-hidden="true" />} onClick={() => setToplu((t) => !t)}>
              {toplu ? 'Tek kod ekle' : 'Toplu yapıştır'}
            </Button>
          }
        >
          Takip dışına al
        </CardTitle>
        <form onSubmit={ekle} className="mt-4 space-y-3">
          {toplu ? (
            <Field
              label="Firma kodları"
              hint={topluKodlar.length > 0 ? `${topluKodlar.length} kod okundu: ${topluKodlar.slice(0, 6).join(', ')}${topluKodlar.length > 6 ? '…' : ''}` : 'Excel’den sütunu kopyalayıp yapıştırın; her satıra bir kod (virgül de olur).'}
            >
              <Textarea rows={4} value={metin} onChange={(e) => setMetin(e.target.value)} placeholder={'54 C03\n34 O02\n…'} className="font-mono" />
            </Field>
          ) : null}
          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[12rem_1fr_auto]">
            {!toplu && (
              <Field label="Firma kodu">
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="örn. 99 X01" maxLength={30} />
              </Field>
            )}
            <Field label="Not (isteğe bağlı)" className={toplu ? 'md:col-span-2' : ''}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="örn. grup içi firma" />
            </Field>
            <Button type="submit" variant="primary" loading={busy} disabled={!eklenebilir}>
              {toplu ? `${topluKodlar.length || ''} kodu ekle`.trim() : 'Ekle'}
            </Button>
          </div>
        </form>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </Card>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
          <p className="text-sm font-semibold text-slate-900">Liste ({rows.length})</p>
          <label className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input boyut="sm" value={ara} onChange={(e) => setAra(e.target.value)} placeholder="Kod ya da firma ara" className="pl-8" aria-label="Ara" />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                <th className="px-5 py-2 font-medium">Kod</th>
                <th className="px-3 py-2 font-medium">Eşleşen firma</th>
                <th className="px-3 py-2 font-medium">Not</th>
                <th className="px-3 py-2 font-medium">Ekleyen</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {gorunen.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                    {rows.length === 0 ? 'Takip dışı firma yok.' : 'Aramayla eşleşen kod yok.'}
                  </td>
                </tr>
              )}
              {gorunen.map((r) => (
                <tr key={r.code} className="border-b border-slate-100">
                  <td className="px-5 py-2.5 font-mono font-medium">{r.code}</td>
                  <td className="px-3 py-2.5">
                    {r.firmalar.length === 0 ? (
                      <Badge tone="amber" title="Sistemde bu kodla bir firma yok; ileride gelirse kendiliğinden takip dışı olur">
                        eşleşen firma yok
                      </Badge>
                    ) : (
                      <span className="flex flex-col">
                        {r.firmalar.map((f) => (
                          <Link key={f.id} href={`/firmalar/${f.id}`} className="text-blue-700 hover:underline">
                            {f.kod !== r.code ? `${f.kod} · ` : ''}
                            {f.ad}
                          </Link>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{r.note ?? ''}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{r.addedBy ?? ''}</td>
                  <td className="px-5 py-2.5 text-right">
                    <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => setCikarilacak(r)} disabled={busy}>
                      Takibe geri al
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmDialog
        acik={cikarilacak !== null}
        baslik={`${cikarilacak?.code ?? ''} yeniden takibe alınsın mı?`}
        onayMetni="Takibe al"
        mesgul={busy}
        onOnay={() => cikarilacak && cikar(cikarilacak)}
        onVazgec={() => setCikarilacak(null)}
      >
        <p>
          Bu firmanın irsaliye ve ödemeleri borç takibine yeniden girer; tüm firmalar yeniden hesaplanır (birkaç saniye sürebilir).
        </p>
      </ConfirmDialog>
    </div>
  )
}
