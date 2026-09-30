'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Button from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { formatCents } from '@/lib/engine/money'
import { oneriKurus } from '@/lib/odemeTutari'

// EUR tutarı olmayan (ya da elle tutarı dosyayla çelişen) ödemeye EUR girişi.
// Öneri yalnız kutuyu doldurur; kayıt her zaman kullanıcının onayıyla yapılır.

export interface OdemeTutarGirisiProps {
  id: string
  islemKodu: string
  durum: 'eksik' | 'cakisma'
  gelenTl: number | null
  oneriKur: number | null
  /** dosyadaki DÖVİZ EURO (kuruş) */
  dosyadaki: number | null
  /** elle girilmiş EUR (kuruş) */
  elle: number | null
}

export default function OdemeTutarGirisi({ id, islemKodu, durum, gelenTl, oneriKur, dosyadaki, elle }: OdemeTutarGirisiProps) {
  const router = useRouter()
  const toast = useToast()
  const [deger, setDeger] = useState('')
  const [mesgul, setMesgul] = useState(false)
  const oneri = oneriKurus(gelenTl, oneriKur)

  async function gonder(govde: Record<string, unknown>, basari: string) {
    setMesgul(true)
    try {
      const res = await fetch(`/api/payments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(govde),
      })
      const r = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) return toast(r.error ?? 'Kayıt yapılamadı.', 'hata')
      toast(basari)
      setDeger('')
      router.refresh()
    } finally {
      setMesgul(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {durum === 'cakisma' && (
        <span className="text-xs text-slate-600">
          Elle: <strong>{elle !== null ? formatCents(elle) : '—'} €</strong> · dosyada: {dosyadaki !== null ? formatCents(dosyadaki) : '—'} €
        </span>
      )}
      <Input
        aria-label={`${islemKodu} EUR tutarı`}
        value={deger}
        onChange={(e) => setDeger(e.target.value)}
        placeholder={durum === 'eksik' ? 'örn. 17.382,63' : 'Yeni EUR'}
        inputMode="decimal"
        boyut="sm"
        tam={false}
        className="w-36"
      />
      {oneri !== null && durum === 'eksik' && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setDeger(formatCents(oneri))}
          title={`GELEN TL ÷ kur ${oneriKur?.toLocaleString('tr-TR', { maximumFractionDigits: 4 })}`}
        >
          Öneri: {formatCents(oneri)} €
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="primary"
        loading={mesgul}
        disabled={mesgul || deger.trim() === ''}
        onClick={() => gonder({ amountEur: deger.trim() }, `${islemKodu}: tutar kaydedildi, firma yeniden hesaplandı.`)}
      >
        Kaydet
      </Button>
      {durum === 'cakisma' && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={mesgul}
          onClick={() => gonder({ clearOverride: true }, `${islemKodu}: dosyadaki tutar kullanılıyor.`)}
        >
          Dosyadakini kullan
        </Button>
      )}
    </div>
  )
}
