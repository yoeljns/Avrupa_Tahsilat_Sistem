'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import Button from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'

export default function RecomputeButton() {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/recompute', { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? 'Hesaplama başarısız.')
        return
      }
      toast('Tüm firmalar yeniden hesaplandı.')
      router.refresh()
    } catch {
      setError('Sunucuya ulaşılamadı.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button onClick={run} loading={busy} icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}>
        {busy ? 'Hesaplanıyor…' : 'Yeniden Hesapla'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}
