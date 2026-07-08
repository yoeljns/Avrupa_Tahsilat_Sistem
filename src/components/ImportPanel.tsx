'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

// İki aşamalı içe aktarma paneli: dosya seç → önizleme → onayla.

interface PreviewResult {
  batchId: string
  counts: Record<string, number>
  total: number
  warnings: string[]
  samples?: {
    updated?: Array<{ key: string; fields: string[] }>
    needs_review?: string[]
    invalid?: Array<{ rowIndex: number; error: string; preview?: string; sheet?: string }>
  }
}

interface ImportPanelProps {
  kind: 'irsaliye' | 'odemeler' | 'bayiler'
  title: string
  description: string
  accept: string
}

const COUNT_LABELS: Record<string, { label: string; tone: string }> = {
  new: { label: 'Yeni', tone: 'text-emerald-700 bg-emerald-50' },
  updated: { label: 'Güncellenecek', tone: 'text-blue-700 bg-blue-50' },
  unchanged: { label: 'Değişmeyen', tone: 'text-slate-600 bg-slate-100' },
  needs_review: { label: 'İnceleme Bekleyecek', tone: 'text-amber-700 bg-amber-50' },
  excluded_31_12: { label: '31/12 (hariç)', tone: 'text-slate-600 bg-slate-100' },
  invalid: { label: 'Geçersiz', tone: 'text-red-700 bg-red-50' },
}

export default function ImportPanel({ kind, title, description, accept }: ImportPanelProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function onPreview() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError('Önce dosya seçin.')
      return
    }
    setBusy('preview')
    setError(null)
    setDone(null)
    setPreview(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/import/${kind}/preview`, { method: 'POST', body: form })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? 'Önizleme başarısız.')
        return
      }
      setPreview(body)
    } catch {
      setError('Sunucuya ulaşılamadı. Dosya çok büyükse birkaç dakika sürebilir; tekrar deneyin.')
    } finally {
      setBusy(null)
    }
  }

  async function onCommit() {
    if (!preview) return
    setBusy('commit')
    setError(null)
    try {
      const res = await fetch(`/api/import/${kind}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: preview.batchId }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? 'İçe aktarma başarısız.')
        return
      }
      setDone('İçe aktarma tamamlandı ve mutabakat yeniden hesaplandı.')
      setPreview(null)
      setFileName(null)
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
    } catch {
      setError('Sunucuya ulaşılamadı.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-lg border border-dashed border-slate-400 bg-slate-50 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100">
          {fileName ?? 'Dosya seç…'}
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              setFileName(e.target.files?.[0]?.name ?? null)
              setPreview(null)
              setDone(null)
              setError(null)
            }}
          />
        </label>
        <button
          onClick={onPreview}
          disabled={busy !== null || !fileName}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy === 'preview' ? 'İnceleniyor…' : 'Önizle'}
        </button>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {done && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{done}</p>}

      {preview && (
        <div className="mt-4 rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-medium text-slate-800">Önizleme — {preview.total} satır okundu:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(preview.counts).map(([k, v]) => {
              const meta = COUNT_LABELS[k] ?? { label: k, tone: 'text-slate-600 bg-slate-100' }
              return (
                <span key={k} className={`rounded-full px-2.5 py-1 text-xs font-medium ${meta.tone}`}>
                  {meta.label}: {v}
                </span>
              )
            })}
          </div>

          {preview.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-amber-700">
              {preview.warnings.map((w, i) => (
                <li key={i}>⚠️ {w}</li>
              ))}
            </ul>
          )}

          {preview.samples?.updated && preview.samples.updated.length > 0 && (
            <details className="mt-3 text-xs text-slate-600">
              <summary className="cursor-pointer font-medium">Güncellenecek kayıt örnekleri</summary>
              <ul className="mt-1 space-y-0.5">
                {preview.samples.updated.map((u) => (
                  <li key={u.key}>
                    {u.key}: <span className="text-slate-400">{u.fields.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {preview.samples?.invalid && preview.samples.invalid.length > 0 && (
            <details className="mt-2 text-xs text-red-600">
              <summary className="cursor-pointer font-medium">Geçersiz satırlar</summary>
              <ul className="mt-1 space-y-0.5">
                {preview.samples.invalid.map((u, i) => (
                  <li key={i}>
                    Satır {u.rowIndex}
                    {u.sheet ? ` (${u.sheet})` : ''}: {u.error}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={onCommit}
              disabled={busy !== null}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy === 'commit' ? 'Aktarılıyor…' : 'Onayla ve Aktar'}
            </button>
            <button
              onClick={() => setPreview(null)}
              disabled={busy !== null}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600"
            >
              Vazgeç
            </button>
            <span className="text-xs text-slate-400">Onaylamazsanız hiçbir veri değişmez.</span>
          </div>
        </div>
      )}
    </div>
  )
}
