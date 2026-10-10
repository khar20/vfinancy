import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2, Undo2 } from 'lucide-react'
import { service } from '../../wailsjs/go/models'
import { api, allPages, query } from '../data/api'
import type { Currency, Page } from '../data/api'
import { useStore } from '../data/store'
import { statusView } from '../data/status'
import { parseError } from '../lib/errors'
import { fmtDateShort } from '../lib/format'
import { centsText, textToCents } from '../lib/money'
import { Badge, Empty, Field, Loading, Modal, ModalActions, Money, MoneyInput, Seg, TextInput, ViewHead } from '../components/ui'
import { FilterBar, useServerFilters } from '../components/filters'
import { EntityLink } from '../components/entity'
import { MonthJournal } from '../components/journal'

type Row = Record<string, any>

export function ProductDetailPage() {
  const { id = '' } = useParams()
  const productId = Number(id)
  const navigate = useNavigate()
  const currency = useStore((state) => state.currency)
  const revision = useStore((state) => state.revision)
  const toast = useStore((state) => state.toast)
  const filters = useServerFilters('kardex')
  const filterKey = JSON.stringify(filters.filters.map((f) => [f.field, f.op, f.value, f.end]))
  const [product, setProduct] = useState<Row | null>(null)
  const [lots, setLots] = useState<Row[]>([])
  const [lotStates, setLotStates] = useState<Record<number, string>>({})
  const [kardex, setKardex] = useState<Page | null>(null)
  const [cursor, setCursor] = useState('')
  const [loading, setLoading] = useState(true)
  const [moreLoading, setMoreLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [voided, setVoided] = useState(false)
  useEffect(() => {
    let active = true
    setLoading(true)
    const load = async () => {
      const [products, productLots, journal] = await Promise.all([
        allPages(api.Catalog.ListProducts, currency),
        api.Inventory.LotsForProduct(productId),
        api.Inventory.ListKardex(productId, query(currency, filters.filters, '', 6)),
      ])
      const selected = products.find((item) => Number(item.id) === productId) ?? null
      let states: Record<number, string> = {}
      if (selected) {
        const lotPage = await api.Inventory.List(query(currency, [new service.Filter({ field: 'product', op: 'equals', value: selected.name })], '', 120))
        states = Object.fromEntries(lotPage.months.flatMap((month) => month.rows as Row[]).map((lot) => [Number(lot.id), String(lot.status)]))
      }
      if (active) { setProduct(selected); setLots(productLots as Row[]); setLotStates(states); setKardex(journal); setCursor(journal.nextCursor ?? ''); setVoided(selected?.voided_at != null); setLoading(false) }
    }
    void load().catch((error) => { if (active) { toast(parseError(error).message ?? 'No se pudo cargar el producto', 'bad'); setLoading(false) } })
    return () => { active = false }
  }, [productId, currency, revision, filterKey])
  const loadMore = async () => {
    if (!cursor || moreLoading) return
    setMoreLoading(true)
    try { const next = await api.Inventory.ListKardex(productId, query(currency, filters.filters, cursor, 6)); setKardex((old) => ({ months: [...(old?.months ?? []), ...(next.months ?? [])], nextCursor: next.nextCursor } as unknown as Page)); setCursor(next.nextCursor ?? '') }
    catch (error) { toast(parseError(error).message ?? 'No se pudo cargar más kardex', 'bad') }
    finally { setMoreLoading(false) }
  }
  if (loading) return <Loading />
  if (!product) return <Empty>Producto no encontrado</Empty>
  const stock = lots.reduce((sum, lot) => sum + Number(lot.available ?? 0), 0)
  const voidRestore = async () => {
    try { if (voided) await api.Catalog.RestoreProduct(productId); else await api.Catalog.VoidProduct(productId); setVoided(!voided); useStore.getState().refresh(); toast(voided ? 'Producto restaurado' : 'Producto anulado') }
    catch (error) { toast(parseError(error).message ?? 'No se pudo actualizar el producto', 'bad') }
  }
  return <><ViewHead title={product.name} subtitle={`${product.sku} · detalle de producto`} actions={<div className="hstack"><button type="button" className="iconbtn" aria-label="Volver a productos" onClick={() => navigate('/inventario?tab=products')}><ArrowLeft size={16} /></button><button type="button" className="btn btn--sm" onClick={() => setEditing(true)}><Pencil size={13} /> Editar</button><button type="button" className="btn btn--sm" onClick={() => void voidRestore()}>{voided ? <Undo2 size={13} /> : <Trash2 size={13} />}{voided ? ' Restaurar' : ' Anular'}</button></div>} />{voided && <div className="formwarn">Producto anulado</div>}<div className="kpis"><div className="kpi"><span className="kpi__label">Stock total</span><span className="kpi__value">{stock} uds</span></div><div className="kpi"><span className="kpi__label">Lotes</span><span className="kpi__value">{lots.length}</span></div><div className="kpi"><span className="kpi__label">Costo por defecto</span><span className="kpi__value"><Money cents={product.default_cost_cents} currency={currency} original={product.original_default_cost_cents} documentCurrency={product.default_cost_currency} tc={product.default_cost_tc} /></span></div><div className="kpi"><span className="kpi__label">Precio por defecto</span><span className="kpi__value"><Money cents={product.default_price_cents} currency={currency} original={product.original_default_price_cents} documentCurrency={product.default_price_currency} tc={product.default_price_tc} /></span></div></div><h3 className="sectitle">Lotes</h3>{lots.length ? <div className="catlist">{lots.map((lot) => <div className={`listrow ${lotStates[Number(lot.id)] ? `tint--${statusView('lots', lotStates[Number(lot.id)])?.tone}` : ''}`} key={lot.id}><span className="listrow__main"><EntityLink kind="lot" id={lot.id}><b>{lot.code}</b></EntityLink><span className="listrow__meta">{fmtDateShort(lot.entry_date)} · {lot.available} disponibles</span></span><Badge state={statusView('lots', lotStates[Number(lot.id)])} /><Money cents={lot.unit_cost_cents} currency={lot.currency} /></div>)}</div> : <Empty>Sin lotes registrados</Empty>}<h3 className="sectitle">Kardex (saldo acumulado)</h3><FilterBar state={filters} /><MonthJournal page={kardex} loading={false} onMore={() => void loadMore()} emptyText="Sin movimientos" renderRow={(row) => <div className="listrow"><span>{fmtDateShort(row.date)}</span><span>{row.direction === 'in' ? 'Entrada' : 'Salida'}</span><span>{row.code}</span><span className="num">{row.qty}</span><b>Saldo {row.balance}</b></div>} />{moreLoading && <small className="muted">Cargando kardex…</small>}{editing && <ProductEditModal product={product} onClose={() => setEditing(false)} />}</>
}

export function ProductEditModal({ product, onClose }: { product: Row; onClose: () => void }) {
  const [name, setName] = useState(product.name)
  const [sku, setSku] = useState(product.sku)
  const [cost, setCost] = useState(centsText(Number(product.original_default_cost_cents ?? product.default_cost_cents)))
  const [price, setPrice] = useState(centsText(Number(product.original_default_price_cents ?? product.default_price_cents)))
  const [costCurrency, setCostCurrency] = useState<Currency>(product.default_cost_currency)
  const [priceCurrency, setPriceCurrency] = useState<Currency>(product.default_price_currency)
  const [busy, setBusy] = useState(false)
  const toast = useStore((state) => state.toast)
  return <Modal title="Editar producto" onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await api.Catalog.SaveProduct(new service.Product({ id: Number(product.id), sku, name, defaultCostCents: textToCents(cost) ?? 0, defaultCostCurrency: costCurrency, defaultPriceCents: textToCents(price) ?? 0, defaultPriceCurrency: priceCurrency })); useStore.getState().refresh(); toast('Producto actualizado'); onClose() } catch (error) { toast(parseError(error).message ?? 'No se pudo actualizar el producto', 'bad') } finally { setBusy(false) } }}><Field label="Nombre" required><TextInput value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="SKU" required><TextInput className="input--mono" value={sku} onChange={(event) => setSku(event.target.value)} /></Field><Field label="Costo por defecto"><MoneyInput currency={costCurrency} value={cost} onChange={setCost} /></Field><Seg options={[{ value: 'USD', label: '$' }, { value: 'PEN', label: 'S/' }]} value={costCurrency} onChange={setCostCurrency} /><Field label="Precio por defecto"><MoneyInput currency={priceCurrency} value={price} onChange={setPrice} /></Field><Seg options={[{ value: 'PEN', label: 'S/' }, { value: 'USD', label: '$' }]} value={priceCurrency} onChange={setPriceCurrency} /><div className="hstack"><ModalActions onClose={onClose} busy={busy} label="Guardar cambios" /></div></form></Modal>
}
