'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

// Veri sıfırlama paneli — yalnız yy@avrupagroup.com görür (sayfa tarafında da korunur).

export default function ResetDataPanel() {
  const router = useRouter()
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/reset-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? 'Sıfırlama başarısız.')
        return
      }
      const s = body.summary
      setDone(
        `Sıfırlama tamamlandı: ${s.invoices} irsaliye, ${s.payments} ödeme, ${s.runs} mutabakat koşusu ve ${s.batches} içe aktarma kaydı silindi.`,
      )
      setConfirm('')
      router.refresh()
    } catch {
      setError('Sunucuya ulaşılamadı.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl rounded-2xl border border-red-300 bg-red-50 p-6">
      <h2 className="text-base font-bold text-red-900">Tüm ödeme ve irsaliye verisini sıfırla</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-800">
        <li>
          <strong>Silinir:</strong> tüm irsaliyeler ve taksitleri, tüm ödemeler, mutabakat sonuçları, içe aktarma
          geçmişi — yaptığınız düzenlemeler (iptal, tutar, vade) dahil.
        </li>
        <li>
          <strong>Korunur:</strong> firmalar ve pazarlamacı eşleşmeleri, kullanıcılar ve şifreler, takip dışı firma
          listesi, denetim kaydı (bu sıfırlama da denetime işlenir).
        </li>
        <li>Bu işlem GERİ ALINAMAZ. Sonrasında dosyaları yeniden yükleyerek sıfırdan başlarsınız.</li>
      </ul>

      <label className="mt-4 block text-sm font-medium text-red-900">
        Onaylamak için kutuya <code className="rounded bg-red-100 px-1 font-mono">SIFIRLA</code> yazın:
      </label>
      <input
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className="mt-1 w-48 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm"
        placeholder="SIFIRLA"
      />

      {error && <p className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800">{error}</p>}
      {done && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{done}</p>}

      <button
        onClick={run}
        disabled={busy || confirm !== 'SIFIRLA'}
        className="mt-4 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
      >
        {busy ? 'Sıfırlanıyor…' : 'Verileri Kalıcı Olarak Sıfırla'}
      </button>
    </div>
  )
}
