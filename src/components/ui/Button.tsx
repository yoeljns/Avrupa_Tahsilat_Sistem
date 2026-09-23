import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

// Ortak düğme — tüm ekranlarda aynı görünüm. Sunucu ve istemci bileşenlerinde kullanılabilir.

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'dangerOutline' | 'ghostDark'
export type ButtonSize = 'sm' | 'md'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white shadow-sm hover:bg-blue-700 focus-visible:outline-blue-600',
  secondary: 'bg-white text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-slate-400',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:outline-red-600',
  dangerOutline: 'bg-white text-red-600 ring-1 ring-inset ring-red-200 hover:bg-red-50 focus-visible:outline-red-400',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-slate-400',
  /** koyu zemin üstünde */
  ghostDark: 'text-slate-200 hover:bg-slate-800 hover:text-white focus-visible:outline-slate-400',
}
const SIZE: Record<ButtonSize, string> = {
  sm: 'gap-1.5 rounded-lg px-2.5 py-1.5 text-xs',
  md: 'gap-2 rounded-lg px-3.5 py-2 text-sm',
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra = ''): string {
  return (
    'inline-flex items-center justify-center font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ' +
    VARIANT[variant] +
    ' ' +
    SIZE[size] +
    (extra ? ' ' + extra : '')
  )
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  loading?: boolean
}

export default function Button({ variant = 'secondary', size = 'md', icon, loading, className = '', children, disabled, type, ...rest }: Props) {
  return (
    <button type={type ?? 'button'} className={buttonClass(variant, size, className)} disabled={disabled || loading} {...rest}>
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
}
