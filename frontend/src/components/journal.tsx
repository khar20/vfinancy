import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Page } from '../data/api'
import { fmtMoney, monthLabel } from '../lib/format'
import { useStore } from '../data/store'
import { Empty, Loading } from './ui'
import { cx } from '../lib/format'

export function MonthJournal({ page, loading, onMore, renderRow, emptyText = 'Sin registros que coincidan con los filtros' }: { page: Page | null; loading: boolean; onMore: () => void; renderRow: (row: Record<string, any>) => ReactNode; emptyText?: string }) {
  const currency = useStore((state) => state.currency)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  if (loading && !page) return <Loading />
  if (!page?.months?.length) return <Empty>{emptyText}</Empty>
  return <div className="journal">{page.months.map((month) => {
    const open = !collapsed.has(month.month)
    return <section className="jmonth" key={month.month}><header className="jmonth__head"><button className="jmonth__toggle" type="button" aria-expanded={open} onClick={() => setCollapsed((previous) => { const next = new Set(previous); open ? next.add(month.month) : next.delete(month.month); return next })}><h2>{monthLabel(month.month)}</h2><ChevronDown className={cx('jmonth__chev', open && 'is-open')} size={13} /></button><span className="jmonth__stats">{month.count} registros{month.total ? <> · total <b>{fmtMoney(month.total, currency)}</b></> : null}</span></header>{open && <div className="jmonth__list">{month.rows.map((row, index) => <div key={String(row.id ?? row.code ?? index)}>{renderRow(row)}</div>)}</div>}</section>
  })}{page.nextCursor && <div className="jmore"><button className="btn" type="button" onClick={onMore}>Cargar meses anteriores</button></div>}</div>
}
