import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

// Form alanları — tek tip kenarlık, odak halkası ve yazı boyu.
// Dolgu/yazı boyu ve genişlik prop'la seçilir: aynı öğeye çakışan Tailwind
// sınıfları (py-2 + py-1.5 gibi) verilmesin — hangisinin kazanacağı belirsizdir.

const TABAN =
  'block rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500'

export type AlanBoyu = 'xs' | 'sm' | 'md'

const BOY: Record<AlanBoyu, string> = {
  xs: 'px-2 py-1 text-xs',
  sm: 'px-2.5 py-1.5 text-sm',
  md: 'px-3 py-2 text-sm',
}
// Açılır listede ok simgesine yer: sağ dolgu ayrıca (px ile çakışmasın diye pl + pr)
const SECIM_BOY: Record<AlanBoyu, string> = {
  xs: 'pl-2 pr-7 py-1 text-xs',
  sm: 'pl-2.5 pr-8 py-1.5 text-sm',
  md: 'pl-3 pr-8 py-2 text-sm',
}

interface Ortak {
  boyut?: AlanBoyu
  /** false → içerik kadar geniş (varsayılan: tam genişlik) */
  tam?: boolean
}

function sinif(boy: string, tam: boolean, ek: string): string {
  return TABAN + ' ' + boy + (tam ? ' w-full' : '') + (ek ? ' ' + ek : '')
}

export function Input({ className = '', boyut = 'md', tam = true, ...rest }: InputHTMLAttributes<HTMLInputElement> & Ortak) {
  return <input className={sinif(BOY[boyut], tam, className)} {...rest} />
}

export function Select({ className = '', boyut = 'md', tam = true, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & Ortak & { children: ReactNode }) {
  return (
    <select className={sinif(SECIM_BOY[boyut], tam, className)} {...rest}>
      {children}
    </select>
  )
}

export function Textarea({ className = '', boyut = 'md', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & Omit<Ortak, 'tam'>) {
  return <textarea className={sinif(BOY[boyut], true, className)} {...rest} />
}

/** Etiket + alan + açıklama/hata */
export function Field({
  label,
  hint,
  error,
  children,
  className = '',
  htmlFor,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  children: ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-600">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}
