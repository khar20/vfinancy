import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { service } from '../../wailsjs/go/models'
import { api, query } from '../data/api'
import type { Currency } from '../data/api'
import { useStore } from '../data/store'
import { statusView } from '../data/status'
import { fmtDate, fmtDateShort, fmtMoney, monthLabel } from '../lib/format'
import { Badge, Card, Empty, Loading, Money, Seg, ViewHead } from '../components/ui'

type Row = Record<string, any>

export function DashboardPage() {
  const currency = useStore((state) => state.currency)
  const revision = useStore((state) => state.revision)
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year' | 'total'>('month')
  const [offset, setOffset] = useState(0)
  const date = new Date()
  date.setMonth(date.getMonth() + offset * (period === 'month' ? 1 : period === 'quarter' ? 3 : 12))
  const anchor = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  const [snapshot, setSnapshot] = useState<{ key: string; dashboard: Row; receivables: Row[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const queryKey = `${period}-${anchor}-${currency}-${revision}`
  useEffect(() => {
    let active = true
    setLoading(true)
    void Promise.all([
      api.Dashboard.GetDashboard(period, anchor, currency),
      api.Sales.List(query(currency, [new service.Filter({ field: 'balance', op: '>', value: 0 })], '', 6)),
    ]).then(([dashboard, page]) => { if (active) { setSnapshot({ key: queryKey, dashboard: dashboard as Row, receivables: page.months.flatMap((month) => month.rows as Row[]) }); setLoading(false) } }).catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [queryKey])
  const dashboard = snapshot?.key === queryKey ? snapshot.dashboard : null
  const receivables = snapshot?.key === queryKey ? snapshot.receivables : []
  return <><ViewHead title="Inicio" subtitle={`Resumen del período · ${monthLabel(anchor)}`} actions={<><button type="button" className="iconbtn" aria-label="Período anterior" onClick={() => setOffset((value) => value - 1)}><ChevronLeft size={15} /></button><button type="button" className="iconbtn" aria-label="Período siguiente" disabled={period === 'total' || offset >= 0} onClick={() => setOffset((value) => Math.min(0, value + 1))}><ChevronRight size={15} /></button><Seg label="Período" options={[{ value: 'month', label: 'Mes' }, { value: 'quarter', label: 'Trimestre' }, { value: 'year', label: 'Año' }, { value: 'total', label: 'Total' }]} value={period} onChange={(value) => { setPeriod(value); setOffset(0) }} /></>} />{loading ? <Loading /> : dashboard && <><div className="kpis"><div className="kpi kpi--accent"><span className="kpi__label">Ventas</span><span className="kpi__value"><Money cents={dashboard.sales ?? 0} /></span><span className="kpi__sub">ventas y envíos vigentes del período</span></div><div className="kpi"><span className="kpi__label">Costos</span><span className="kpi__value"><Money cents={(dashboard.costBase ?? 0) + (dashboard.costExtra ?? 0)} /></span><span className="kpi__sub">Base {fmtMoney(dashboard.costBase, currency)} · Extras {fmtMoney(dashboard.costExtra, currency)}</span></div><div className="kpi kpi--accent"><span className="kpi__label">Utilidad</span><span className="kpi__value"><Money cents={dashboard.profit ?? 0} /></span></div></div><div className="grid-dash"><Card title="Ventas − Costos − Utilidad" subtitle="Detalle por mes"><DashboardChart data={dashboard.series ?? []} currency={currency} /></Card><Card title="Desglose de costos" subtitle="Base de lotes y extras por concepto">{(dashboard.extrasByConcept ?? []).map((row: Row) => <div className="sumrow" key={row.concept}><span>{row.concept}</span><Money cents={row.amount} /></div>)}</Card><Card title="Cuentas por cobrar" subtitle="Ventas y envíos con saldo, agrupados por mes" className="span6" flush>{receivables.length ? groupMonths(receivables).map(([month, rows]) => <section className="jmonth" key={month}><header className="jmonth__head"><h2>{monthLabel(month)}</h2><span className="jmonth__stats">{rows.length} registros</span></header>{rows.map((row) => { const kind = row.kind === 'shipment' ? 'envios' : 'ventas'; return <button type="button" className={`listrow listrow--click tint--${statusView('sales', row.status)?.tone ?? 'amber'}`} key={row.id} onClick={() => { window.location.hash = `#/${kind}?abrir=${encodeURIComponent(row.code)}` }}><span className="listrow__main"><b>{row.code} · {row.client ?? 'Cliente general'}</b><span className="listrow__meta">{fmtDateShort(row.date)}</span></span><span className="listrow__amount"><Money cents={row.balanceCents} /></span><Badge state={statusView('sales', row.status)} /></button>})}</section>) : <Empty>Todo cobrado</Empty>}</Card><Card title="Lotes en remate" subtitle="Lotes con stock disponible" className="span6" flush>{(dashboard.auctions ?? []).length ? (dashboard.auctions as Row[]).map((row) => <button type="button" className="listrow listrow--click tint--red" key={row.id} onClick={() => { window.location.hash = `#/inventario?tab=lots&lote=${row.id}` }}><span className="listrow__main"><b>{row.product}</b><span className="listrow__meta">{row.code} · {row.daysInAuction} días en remate</span></span><span>{row.available} uds</span><Badge state={statusView('lots', 'auction')} /></button>) : <Empty>Sin lotes en remate</Empty>}</Card><Card title="Alertas ligeras" className="span12" flush><Alerts data={dashboard.alerts ?? {}} /></Card></div></>}</>
}

function groupMonths(rows: Row[]): Array<[string, Row[]]> {
  const groups = new Map<string, Row[]>()
  for (const row of rows) { const key = String(row.date).slice(0, 7); groups.set(key, [...(groups.get(key) ?? []), row]) }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))
}

function DashboardChart({ data, currency }: { data: Row[]; currency: Currency }) {
  if (!data.length) return <Empty>Sin datos en el período</Empty>
  const [hover, setHover] = useState<number | null>(null)
  const W = 720, H = 260, left = 58, right = 16, top = 16, bottom = 32
  const innerW = W - left - right, innerH = H - top - bottom
  const max = Math.max(1, ...data.flatMap((row) => [row.sales, row.costBase, row.costExtra, Math.max(0, row.profit)]))
  const y = (value: number) => top + innerH - value / max * innerH
  const slot = innerW / data.length, barWidth = Math.min(16, slot * 0.18)
  const centers = data.map((_, index) => left + slot * (index + 0.5))
  const line = data.map((row, index) => `${centers[index]},${y(row.profit)}`).join(' ')
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  return <div className="tchart"><svg className="tchart__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ventas, costos base, costos extras y utilidad por mes">{ticks.map((fraction) => { const yy = y(max * fraction); return <g key={fraction}><line className="tchart__grid" x1={left} x2={W - right} y1={yy} y2={yy} /><text className="tchart__tick" x={left - 7} y={yy + 3} textAnchor="end">{fmtMoney(Math.round(max * fraction), currency)}</text></g>})}<line className="tchart__axis" x1={left} x2={W - right} y1={y(0)} y2={y(0)} />{data.map((row, index) => { const center = centers[index]; const vals = [row.sales, row.costBase, row.costExtra]; return <g key={row.month} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}><rect className="tchart__hoverzone" x={left + index * slot} y={top} width={slot} height={innerH} /><rect className="tchart__barA" x={center - barWidth * 1.65} y={y(vals[0])} width={barWidth} height={Math.max(0, y(0) - y(vals[0]))} /><rect className="tchart__barB" x={center - barWidth / 2} y={y(vals[1])} width={barWidth} height={Math.max(0, y(0) - y(vals[1]))} /><rect className="tchart__barC" x={center + barWidth * .65} y={y(vals[2])} width={barWidth} height={Math.max(0, y(0) - y(vals[2]))} /><text className="tchart__tick" x={center} y={H - 8} textAnchor="middle">{monthLabel(row.month).slice(0, 3)}</text></g>})}<polyline className="tchart__line" points={line} /><g>{data.map((row, index) => <circle key={row.month} className="tchart__dot" cx={centers[index]} cy={y(row.profit)} r={hover === index ? 4 : 3} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} />)}</g></svg>{hover != null && <div className="tchart__tip" style={{ left: `${Math.max(8, Math.min(82, centers[hover] / W * 100))}%` }}><b className="tchart__tiphead">{monthLabel(data[hover].month)}</b><span><i className="dot dot--a" /> Ventas: <b>{fmtMoney(data[hover].sales, currency)}</b></span><span><i className="dot dot--b" /> Costo base: <b>{fmtMoney(data[hover].costBase, currency)}</b></span><span><i className="dot dot--c" /> Costos extras: <b>{fmtMoney(data[hover].costExtra, currency)}</b></span><span><i className="dot dot--l" /> Utilidad: <b>{fmtMoney(data[hover].profit, currency)}</b></span></div>}<div className="tchart__legend"><span><i className="dot dot--a" />Ventas</span><span><i className="dot dot--b" />Costo base</span><span><i className="dot dot--c" />Extras</span><span><i className="dot dot--l" />Utilidad</span></div></div>
}

function Alerts({ data }: { data: Row }) {
  const items = [
    ...(data.pendingPurchases ?? []).map((row: Row) => ({ code: row.code, date: row.date, label: `${row.code} sigue pendiente`, tone: 'amber', path: 'compras' })),
    ...(data.cardCycles ?? []).map((row: Row) => ({ code: row.cardName, date: row.dueDate, label: `${row.cardName} · ciclo ${fmtDate(row.cycleEnd)}`, tone: 'red', path: 'tarjetas', cardId: row.cardId, cycleEnd: row.cycleEnd })),
    ...(data.overdueSales ?? []).map((row: Row) => ({ code: row.code, date: row.date, label: `${row.code} atrasada`, tone: 'red', path: 'ventas' })),
  ]
  return items.length ? items.map((row, index) => <button className={`listrow listrow--click tint--${row.tone}`} key={`${row.code}-${index}`} type="button" onClick={() => { window.location.hash = row.path === 'tarjetas' ? `#/tarjetas?cardId=${row.cardId}&cycleEnd=${row.cycleEnd}` : `#/${row.path}?abrir=${encodeURIComponent(row.code)}` }}><span className="listrow__main"><b>{row.label}</b><span className="listrow__meta">{fmtDate(row.date)}</span></span><Badge>{row.path === 'tarjetas' ? 'tarjeta' : row.path === 'compras' ? 'compra' : 'venta'}</Badge></button>) : <Empty>Sin alertas</Empty>
}
