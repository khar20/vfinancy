import { useState } from 'react'
import type { ReactNode } from 'react'
import { formatMoney, type Currency } from '../lib/money'
import { useStore } from '../data/store'

export interface TimePoint { label: string; a: number; b: number; line: number }

const compact = (n: number, currency: Currency) => {
  const abs = Math.abs(n)
  const value = abs >= 10000 ? `${Math.round(abs / 1000)}k` : abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : `${Math.round(abs)}`
  return `${n < 0 ? '−' : ''}${currency === 'USD' ? '$' : 'S/'}${value}`
}

export function TimeCompare({ data, aLabel, bLabel, lineLabel, height = 230 }: { data: TimePoint[]; aLabel: string; bLabel: string; lineLabel: string; height?: number }) {
  const currency = useStore((state) => state.currency)
  const [hover, setHover] = useState<number | null>(null)
  const W = 720, H = height, padL = 46, padR = 14, padT = 16, padB = 28
  const iw = W - padL - padR, ih = H - padT - padB, n = Math.max(data.length, 1)
  const values = data.flatMap((point) => [point.a, point.b, point.line])
  const min = Math.min(0, ...values), max = Math.max(0, ...values), low = min === max ? -1 : min, high = min === max ? 1 : max
  const range = high - low, bw = iw / n, barW = Math.min(16, bw * .3)
  const cx = (i: number) => padL + i * bw + bw / 2, y = (value: number) => padT + (high - value) / range * ih, zero = y(0)
  const line = data.map((point, i) => `${cx(i)},${y(point.line)}`).join(' ')
  const ticks = [1, .75, .5, .25, 0].map((fraction) => low + range * fraction)
  const money = (value: number) => formatMoney(value, currency)
  return <div className="tchart"><svg viewBox={`0 0 ${W} ${H}`} className="tchart__svg" role="img" aria-label={`${aLabel}, ${bLabel} y ${lineLabel} por mes`}>
    {ticks.filter((tick) => Math.abs(tick) > .000001).map((tick) => <g key={tick}><line x1={padL} x2={W-padR} y1={y(tick)} y2={y(tick)} className="tchart__grid"/><text x={padL-6} y={y(tick)+3} textAnchor="end" className="tchart__tick">{compact(tick/100,currency)}</text></g>)}
    <line x1={padL} x2={W-padR} y1={zero} y2={zero} className="tchart__axis"/><text x={padL-6} y={zero+3} textAnchor="end" className="tchart__tick">0</text>
    {data.map((point,i) => <g key={`${point.label}-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}><rect x={padL+i*bw} y={padT} width={bw} height={ih} className="tchart__hoverzone"/><rect x={cx(i)-barW-1.5} y={Math.min(zero,y(point.a))} width={barW} height={Math.abs(zero-y(point.a))} className="tchart__barA"/><rect x={cx(i)+1.5} y={Math.min(zero,y(point.b))} width={barW} height={Math.abs(zero-y(point.b))} className="tchart__barB"/><circle cx={cx(i)} cy={y(point.line)} r={hover===i?3.5:2.5} className="tchart__dot"/><text x={cx(i)} y={H-8} textAnchor="middle" className="tchart__tick">{point.label}</text></g>)}
    <polyline points={line} fill="none" className="tchart__line" strokeWidth={1.6}/>
  </svg>{hover !== null && data[hover] && <div className="tchart__tip" style={{ left: `${cx(hover)/W*100}%` }}><span className="tchart__tiphead">{data[hover].label}</span><span><i className="dot dot--a"/> {aLabel}: <b>{money(data[hover].a)}</b></span><span><i className="dot dot--b"/> {bLabel}: <b>{money(data[hover].b)}</b></span><span><i className="dot dot--l"/> {lineLabel}: <b>{money(data[hover].line)}</b></span></div>}<div className="tchart__legend"><span><i className="dot dot--a"/>{aLabel}</span><span><i className="dot dot--b"/>{bLabel}</span><span><i className="dot dot--l"/>{lineLabel}</span></div></div>
}

export function HBars({ items, fmt }: { items: Array<{ label: string; value: number; sub?: string }>; fmt: (n: number) => ReactNode }) {
  const max = Math.max(1, ...items.map((item) => item.value))
  return <div className="hbars">{items.map((item) => <div key={item.label} className="hbars__row"><span className="hbars__label" title={item.label}>{item.label}</span><div className="hbars__track"><div className="hbars__fill" style={{ width: `${item.value/max*100}%` }}/></div><span className="hbars__value">{fmt(item.value)}{item.sub && <em> · {item.sub}</em>}</span></div>)}</div>
}
