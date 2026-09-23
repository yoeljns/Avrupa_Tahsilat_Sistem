'use client'

import { useState, type ReactNode } from 'react'
import { Input } from './Field'
import Button from './Button'
import Modal from './Modal'

interface Props {
  acik: boolean
  baslik: ReactNode
  children: ReactNode
  onayMetni?: string
  vazgecMetni?: string
  tehlikeli?: boolean
  /** Kullanıcının bu metni yazması gerekir (geri alınamaz işlemler) */
  yaziliOnay?: string
  mesgul?: boolean
  onOnay: () => void
  onVazgec: () => void
}

/** "Emin misiniz?" penceresi — önemli işlemler onaysız yapılmasın. */
export default function ConfirmDialog({
  acik,
  baslik,
  children,
  onayMetni = 'Onayla',
  vazgecMetni = 'Vazgeç',
  tehlikeli = false,
  yaziliOnay,
  mesgul = false,
  onOnay,
  onVazgec,
}: Props) {
  const [yazilan, setYazilan] = useState('')
  const hazir = !yaziliOnay || yazilan.trim() === yaziliOnay
  const kapat = () => {
    setYazilan('')
    onVazgec()
  }
  return (
    <Modal
      acik={acik}
      onKapat={kapat}
      baslik={baslik}
      genislik="sm"
      kapatilamaz={mesgul}
      altBilgi={
        <>
          <Button onClick={kapat} disabled={mesgul}>
            {vazgecMetni}
          </Button>
          <Button variant={tehlikeli ? 'danger' : 'primary'} onClick={onOnay} disabled={!hazir} loading={mesgul} data-autofocus={!yaziliOnay || undefined}>
            {onayMetni}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-600">{children}</div>
      {yaziliOnay && (
        <div className="mt-4">
          <label className="block text-xs font-semibold text-slate-600">
            Onaylamak için <span className="font-mono text-slate-900">{yaziliOnay}</span> yazın
          </label>
          <Input className="mt-1" value={yazilan} onChange={(e) => setYazilan(e.target.value)} autoComplete="off" data-autofocus />
        </div>
      )}
    </Modal>
  )
}
