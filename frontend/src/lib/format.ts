import { formatMoney, formatTc, type Currency } from './money'

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')
const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const shortMonths = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const monthLabel = (key: string) => {
  const [year, month] = key.split('-').map(Number)
  return `${months[(month || 1) - 1][0].toUpperCase()}${months[(month || 1) - 1].slice(1)} ${year}`
}
export const fmtDate = (iso = '') => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'
export const fmtDateShort = (iso = '') => iso ? `${iso.slice(8, 10)} ${shortMonths[Math.max(0, Number(iso.slice(5, 7)) - 1)]}` : '—'
export const fmtMoney = formatMoney
export const fmtTc = formatTc
export const fmtNum = (value: number) => new Intl.NumberFormat('es-PE').format(value)
export const todayISO = () => new Date().toISOString().slice(0, 10)
export const formatDisplay = (value: number, original: number | undefined, docCurrency: Currency, display: Currency, tc: number) => {
  const main = formatMoney(value, display)
  return display === docCurrency || original === undefined ? main : `${main} · ${formatMoney(original, docCurrency)} · TC ${formatTc(tc)}`
}
