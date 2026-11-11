'use client'

import { useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import Button, { type ButtonSize, type ButtonVariant } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { dosyaIndir } from '@/lib/indir'

interface Props {
  /** indirme adresi (aynı site): '/api/export/…' */
  url: string
  /** sunucu ad vermezse kullanılacak dosya adı */
  yedekAd: string
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  title?: string
  className?: string
}

/** Dosya indirme düğmesi: sürerken döner; sunucu hata verirse Türkçe bildirim gösterir. */
export default function IndirDugmesi({ url, yedekAd, children, variant = 'secondary', size = 'sm', title, className = '' }: Props) {
  const bildir = useToast()
  const [suruyor, setSuruyor] = useState(false)

  async function indir() {
    setSuruyor(true)
    const sonuc = await dosyaIndir(url, yedekAd)
    setSuruyor(false)
    if (sonuc.ok) bildir(`${sonuc.dosyaAdi} indirildi.`)
    else bildir(sonuc.error, 'hata')
  }

  return (
    <Button
      variant={variant}
      size={size}
      loading={suruyor}
      onClick={indir}
      title={title}
      icon={<Download className="h-4 w-4" aria-hidden="true" />}
      className={'print:hidden ' + className}
    >
      {children}
    </Button>
  )
}
