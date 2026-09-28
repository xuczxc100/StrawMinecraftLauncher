const uiLocale = () => (typeof document !== 'undefined' && document.documentElement.lang) || undefined

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatCount(n: number, locale = uiLocale()): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function formatDate(value: string | number | undefined, locale = uiLocale()): string {
  if (!value) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function percent(progress: number, total: number): number {
  if (!total) return 0
  return Math.max(0, Math.min(100, Math.round((progress / total) * 100)))
}
