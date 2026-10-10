export const MAX_MONEY_CENTS = 9_999_999_999
export type Currency = 'PEN' | 'USD'

export function textToCents(text: string): number | null {
  const value = text.trim().replace(/,/g, '')
  if (!/^\d*(\.\d{0,2})?$/.test(value) || value === '') return null
  const [whole = '0', fraction = ''] = value.split('.')
  const cents = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0') || '0')
  return Number.isSafeInteger(cents) && cents <= MAX_MONEY_CENTS ? cents : null
}

export function centsText(cents: number): string {
  const n = Math.trunc(cents)
  const sign = n < 0 ? '-' : ''
  const absolute = Math.abs(n)
  return `${sign}${Math.floor(absolute / 100).toLocaleString('en-US')}.${String(absolute % 100).padStart(2, '0')}`
}

export function formatMoney(cents: number, currency: Currency): string {
  return `${currency === 'USD' ? '$' : 'S/'} ${centsText(cents)}`
}

export function formatTc(scaled: number): string {
  const n = Math.trunc(scaled)
  return `${Math.floor(n / 10000)}.${String(n % 10000).padStart(4, '0')}`
}

export function tcFromText(value: string): number | null {
  if (!/^\d{1,2}(\.\d{0,4})?$/.test(value)) return null
  const [whole = '0', fraction = ''] = value.split('.')
  const scaled = Number(whole) * 10000 + Number(fraction.padEnd(4, '0') || '0')
  return scaled >= 5000 && scaled <= 200000 ? scaled : null
}

export function tcText(scaled: number): string {
  return formatTc(scaled)
}

export function sanitizeMoney(text: string): string {
  let value = text.replace(/[^\d.]/g, '')
  const dot = value.indexOf('.')
  if (dot >= 0) value = value.slice(0, dot + 1) + value.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  const [whole = '', fraction] = value.split('.')
  const clean = whole.replace(/^0+(?=\d)/, '').slice(0, 8)
  return fraction === undefined ? clean : `${clean || '0'}.${fraction}`
}

export function sanitizeTc(text: string): string {
  let value = text.replace(/[^\d.]/g, '')
  const dot = value.indexOf('.')
  if (dot >= 0) value = value.slice(0, dot + 1) + value.slice(dot + 1).replace(/\./g, '').slice(0, 4)
  return value.slice(0, 7)
}
