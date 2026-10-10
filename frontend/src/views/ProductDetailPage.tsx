import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { service } from '../../wailsjs/go/models'
import { api, allPages, query } from '../data/api'
import type { Page } from '../data/api'
import { useStore } from '../data/store'
import { statusView } from '../data/status'
import { parseError } from '../lib/errors'
import { convertCents } from '../lib/money'
import { fmtDateShort, monthLabel } from '../lib/format'
import { Badge, Empty, Loading, Money, ViewHead } from '../components/ui'
import { FilterBar, useServerFilters } from '../components/filters'
import { EntityLink } from '../components/entity'

type Row = Record<string, any>

export function ProductDetailPage() {
  const { id = '' } = useParams()
  const productId = Number(id)
  const navigate = useNavigate()
  const currency = useStore((state) => state.currency)
  const revision = useStore((state) => state.revision)
  const toast = useStore((state) => state.toast)
  const filters = useServerFilters('kardex')
  const filterKey = JSON.stringify(filters.filters.map((filter) => [filter.field, filter.op, filter.value, filter.end]))
  const [product, setProduct] = useState<Row | null>(null)
  const [lots, setLots] = useState<Row[]>([])
  const [lotStates, setLotStates] = useState<Record<number, string>>({})
  const [suppliers, setSuppliers] = useState<Row[]>([])
  const [kardex, setKardex] = useState<Page | null>(null)
  const [cursor, setCursor] = useState('')
  const [loading, setLoading] = useState(true)
  const [moreLoading, setMoreLoading] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    void Promise.all([
      allPages(api.Catalog.ListProducts, currency),
      api.Inventory.LotsForProduct(productId),
      api.Inventory.ListKardex(productId, query(currency, filters.filters, '', 6)),
      allPages(api.Catalog.ListSuppliers, currency),
    ]).then(async ([products, productLots, journal, supplierRows]) => {
      if (!active) return
      const selected = products.find((row) => Number(row.id) === productId) ?? null
      const lotRows = selected ? (await api.Inventory.List(query(currency, [new service.Filter({ field: 'product', op: 'equals', value: selected.name })], '', 120))).months.flatMap((month) => month.rows as Row[]) : []
      if (!active) return
      setProduct(selected)
      setLots(productLots as Row[])
      setSuppliers(supplierRows)
      setLotStates(Object.fromEntries(lotRows.map((lot) => [Number(lot.id), String(lot.status)])))
      setKardex(journal)
      setCursor(journal.nextCursor ?? '')
      setLoading(false)
    }).catch((error) => {
      if (active) { toast(parseError(error).message ?? 'No se pudo cargar el producto', 'bad'); setLoading(false) }
    })
    return () => { active = false }
  }, [productId, currency, revision, filterKey])

  const loadMore = async () => {
    if (!cursor || moreLoading) return
    setMoreLoading(true)
    try {
      const next = await api.Inventory.ListKardex(productId, query(currency, filters.filters, cursor, 6))
      setKardex((old) => ({ months: [...(old?.months ?? []), ...(next.months ?? [])], nextCursor: next.nextCursor } as Page))
      setCursor(next.nextCursor ?? '')
    } catch (error) { toast(parseError(error).message ?? 'No se pudo cargar más kardex', 'bad') }
    finally { setMoreLoading(false) }
  }

  if (loading) return <Loading />
  if (!product) return <Empty>Producto no encontrado</Empty>
  const activeLots = lots.filter((lot) => !lot.voided_at)
  const stock = activeLots.reduce((sum, lot) => sum + Number(lot.available ?? 0), 0)
  const stockValue = activeLots.reduce((sum, lot) => sum + convertCents(Number(lot.available ?? 0) * Number(lot.unit_cost_cents ?? 0), lot.currency, currency, Number(lot.tc ?? 10000)), 0)
  const sold = activeLots.reduce((sum, lot) => sum + Number(lot.qty_initial ?? 0) - Number(lot.available ?? 0), 0)
  const supplierIds = [...new Set(activeLots.map((lot) => Number(lot.supplier_id)).filter((supplierId) => supplierId > 0))]

  return <>
    <ViewHead title={product.name} subtitle={`${product.sku} · costo y precio por defecto`} actions={<button type="button" className="iconbtn" aria-label="Volver a productos" onClick={() => navigate('/inventario?tab=products')}><ArrowLeft size={16} /></button>} />
    <div className="kpis">
      <div className="kpi"><span className="kpi__label">Stock total</span><span className="kpi__value">{stock} uds</span><div className="kpi__foot"><span className="kpi__sub">{sold} vendidas</span></div></div>
      <div className="kpi"><span className="kpi__label">Valor del stock</span><span className="kpi__value"><Money cents={stockValue} /></span><div className="kpi__foot"><span className="kpi__sub">{lots.length} lote{lots.length === 1 ? '' : 's'} (sin anular)</span></div></div>
      <div className="kpi"><span className="kpi__label">Costo por defecto</span><span className="kpi__value"><Money cents={product.default_cost_cents} currency={currency} original={product.original_default_cost_cents} documentCurrency={product.default_cost_currency} tc={product.default_cost_tc} /></span></div>
      <div className="kpi"><span className="kpi__label">Precio por defecto</span><span className="kpi__value"><Money cents={product.default_price_cents} currency={currency} original={product.original_default_price_cents} documentCurrency={product.default_price_currency} tc={product.default_price_tc} /></span></div>
    </div>
    <h3 className="sectitle">Proveedores (se vinculan al comprar)</h3>
    {supplierIds.length === 0 ? <span className="muted">Aún sin proveedores</span> : <div className="hstack hstack--wrap">{supplierIds.map((supplierId) => { const supplier = suppliers.find((row) => Number(row.id) === supplierId); return supplier && <EntityLink key={supplierId} kind="supplier" id={supplierId} chip>{supplier.name}</EntityLink> })}</div>}
    <h3 className="sectitle">Lotes</h3>
    {!activeLots.length ? <span className="muted">Sin lotes todavía</span> : <div className="catlist">{activeLots.map((lot) => {
      const state = statusView('lots', lotStates[Number(lot.id)])
      const soldQty = Number(lot.qty_initial) - Number(lot.available)
      return <button key={lot.id} type="button" className={`listrow listrow--click ${state ? `stripe stripe--${state.tone}` : ''}`} onClick={() => navigate(`/inventario?tab=lots&lote=${lot.id}`)}><span className="listrow__main"><span className="listrow__title num">{lot.code}</span><span className="listrow__meta">{fmtDateShort(lot.entry_date)} · {lot.available} disponibles</span></span><span className="listrow__amount num">{soldQty}/{lot.qty_initial} vendidas</span><Badge state={state} /></button>
    })}</div>}
    <h3 className="sectitle">Kardex (saldo acumulado)</h3>
    <FilterBar state={filters} />
    {!kardex?.months.length ? <Empty>Sin movimientos que coincidan</Empty> : kardex.months.map((month) => <section key={month.month} className="jmonth"><header className="jmonth__head"><h2>{monthLabel(month.month)}</h2><span className="jmonth__stats">{month.count} mov.</span></header><div className="table-scroll"><table className="tbl"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Lote</th><th>Ref.</th><th className="num">Cant.</th><th className="num">Costo unit.</th><th className="num">Saldo uds</th><th className="num">Saldo valor</th></tr></thead><tbody>{(month.rows as Row[]).map((row) => <tr key={row.id}><td>{fmtDateShort(row.date)}</td><td>{row.movLabel}</td><td className="num">{row.lotCode}</td><td>{row.refCode || '—'}</td><td className={`num ${row.direction === 'out' ? 'negnum' : ''}`}>{row.direction === 'in' ? '+' : '−'}{row.qty}</td><td className="num"><Money cents={row.unitCents} /></td><td className="num">{row.balanceQty}</td><td className="num"><Money cents={row.balanceValueCents} /></td></tr>)}</tbody></table></div></section>)}
    {cursor && <div className="jmore"><button type="button" className="btn" disabled={moreLoading} onClick={() => void loadMore()}>{moreLoading ? 'Cargando…' : 'Cargar meses anteriores'}</button></div>}
  </>
}
