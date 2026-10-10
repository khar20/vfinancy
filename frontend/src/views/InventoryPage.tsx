import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, Plus, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { service } from '../../wailsjs/go/models'
import { api, allPages, query } from '../data/api'
import type { Currency, Page } from '../data/api'
import { useStore } from '../data/store'
import { statusView } from '../data/status'
import { parseError } from '../lib/errors'
import { fmtDateShort, todayISO } from '../lib/format'
import { centsText, tcFromText, tcText, textToCents } from '../lib/money'
import { Badge, Field, Modal, ModalActions, Money, MoneyInput, Seg, TcField, TextInput, ViewHead } from '../components/ui'
import { FilterBar, useServerFilters } from '../components/filters'
import { MonthJournal } from '../components/journal'
import { Autocomplete } from '../components/Autocomplete'

type Row = Record<string, any>

export function InventoryPage() {
  const currency = useStore((state) => state.currency)
  const revision = useStore((state) => state.revision)
  const toast = useStore((state) => state.toast)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const tab = params.get('tab') === 'products' ? 'products' : 'lots'
  const [createLot, setCreateLot] = useState(false)
  const [createProduct, setCreateProduct] = useState(false)
  const [editingLot, setEditingLot] = useState<Row | null>(null)
  const [openLot, setOpenLot] = useState<number | null>(null)
  const [page, setPage] = useState<Page | null>(null)
  const [cursor, setCursor] = useState('')
  const [loading, setLoading] = useState(true)
  const filters = useServerFilters(tab)
  const filterKey = JSON.stringify(filters.filters.map((filter) => [filter.field, filter.op, filter.value, filter.end]))
  const catalog = useCatalogRows(currency, revision)

  useEffect(() => { let active = true; setLoading(true); setCursor(''); const fetch = tab === 'lots' ? api.Inventory.List(query(currency, filters.filters, '', 6)) : api.Catalog.ListProducts(query(currency, filters.filters, '', 6)); fetch.then((result) => { if (active) { setPage(result); setCursor(result.nextCursor ?? ''); setLoading(false) } }).catch((error) => { if (active) { setPage({ months: [] } as unknown as Page); setLoading(false); toast(parseError(error).message ?? 'No se pudo cargar inventario', 'bad') } }); return () => { active = false } }, [tab, currency, filterKey, revision])
  const loadMore = async () => { if (!cursor) return; setLoading(true); try { const q = query(currency, filters.filters, cursor, 6); const next = tab === 'lots' ? await api.Inventory.List(q) : await api.Catalog.ListProducts(q); setPage((old) => ({ months: [...(old?.months ?? []), ...next.months], nextCursor: next.nextCursor } as unknown as Page)); setCursor(next.nextCursor ?? '') } catch (error) { toast(parseError(error).message ?? 'No se pudieron cargar más meses', 'bad') } finally { setLoading(false) } }
  useEffect(() => { useStore.getState().registerNew(() => tab === 'lots' ? setCreateLot(true) : setCreateProduct(true)); return () => useStore.getState().registerNew(null) }, [tab])
  useEffect(() => {
    const requested = Number(params.get('lote'))
    if (!(requested > 0) || tab !== 'lots' || !page || loading) return
    const found = page.months.some((month) => month.rows.some((row) => Number((row as Row).id) === requested))
    if (found) { setOpenLot(requested); window.setTimeout(() => document.getElementById(`lot-${requested}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80) }
    else if (cursor) void loadMore()
  }, [params, page, tab, loading, cursor])

  return <><ViewHead title="Inventario" subtitle="Lotes, productos y movimientos de almacén" actions={tab === 'lots' ? <button className="btn btn--primary btn--sm" type="button" onClick={() => setCreateLot(true)}><Plus size={14} /> Ingresar lote</button> : <button className="btn btn--primary btn--sm" type="button" onClick={() => setCreateProduct(true)}><Plus size={14} /> Nuevo producto</button>} /><div className="pagebar"><Seg label="Vista de inventario" options={[{ value: 'lots', label: 'Lotes' }, { value: 'products', label: 'Productos' }]} value={tab} onChange={(value) => setParams({ tab: value })} /></div><FilterBar state={filters} />{tab === 'lots' ? <MonthJournal page={page} loading={loading} onMore={() => void loadMore()} emptyText="Sin lotes" renderRow={(lot) => {
    const status = statusView('lots', lot.status)
    const productName = catalog.products.find((product) => Number(product.id) === Number(lot.product_id))?.name ?? `Producto ${lot.product_id}`
    const sold = Number(lot.qty_initial ?? 0) - Number(lot.available ?? 0)
    const days = lot.daysLeft == null ? null : Number(lot.daysLeft)
    const expanded = openLot === Number(lot.id)
    return <article className={`rec rec--lot ${status ? `tint--${status.tone}` : ''} ${lot.status === 'voided' ? 'rec--void' : ''} ${expanded ? 'rec--open' : ''}`} id={`lot-${lot.id}`} key={lot.id}><button className="rec__main" type="button" aria-expanded={expanded} onClick={() => setOpenLot(expanded ? null : Number(lot.id))}><span className="rec__id"><b className="rec__code">{lot.code}</b><span className="rec__meta">{lot.source === 'manual' ? 'Ingreso manual' : 'Compra'} · {fmtDateShort(lot.entry_date)}</span></span><span className="rec__title"><a href={`#/inventario/producto/${lot.product_id}`} onClick={(event) => event.stopPropagation()}>{productName}</a></span><span className="rec__amount">{sold}/{lot.qty_initial} vendidas<div className="bar bar--inline"><div className="bar__fill" style={{ width: `${Math.min(100, sold / Math.max(1, Number(lot.qty_initial)) * 100)}%` }} /></div></span><Badge state={status} /><span className="rec__subtext">{days == null ? '' : days > 0 ? `${days} días restantes` : `${Math.abs(days)} días en remate`}</span><ChevronDown size={14} /></button>{expanded && <div className="rec__body"><div className="rec__bodyin"><div className="meta-grid"><div className="meta-grid__cell"><span className="meta-grid__k">Disponible</span><span className="meta-grid__v">{lot.available} uds</span></div><div className="meta-grid__cell"><span className="meta-grid__k">Costo unitario</span><span className="meta-grid__v"><Money cents={lot.unit_cost_cents} currency={lot.currency} original={lot.original_unit_cost_cents} documentCurrency={lot.currency} tc={lot.tc} /></span></div><div className="meta-grid__cell"><span className="meta-grid__k">Cuenta regresiva</span><span className="meta-grid__v">{lot.countdown_days == null ? 'Global' : lot.countdown_days === 0 ? 'Desactivada' : `${lot.countdown_days} días`}</span></div></div><div className="rec__foot hstack hstack--wrap"><button className="btn btn--xs" type="button" onClick={async () => { try { await api.Inventory.RestartCountdown(Number(lot.id)); useStore.getState().refresh() } catch (error) { toast(parseError(error).message ?? 'No se pudo reiniciar', 'bad') } }}><RotateCcw size={13} /> Reiniciar contador</button>{lot.status === 'auction' && <button className="btn btn--xs" type="button" onClick={async () => { try { await api.Inventory.DismissAuction(Number(lot.id)); useStore.getState().refresh() } catch (error) { toast(parseError(error).message ?? 'No se pudo quitar el remate', 'bad') } }}>Quitar remate</button>}{lot.source === 'manual' && <button className="btn btn--xs" type="button" onClick={() => setEditingLot(lot)}>Editar lote</button>}{lot.status === 'voided' ? <button className="btn btn--xs" type="button" onClick={async () => { await api.Inventory.Restore(Number(lot.id)); useStore.getState().refresh() }}><Undo2 size={13} /> Restaurar</button> : <button className="btn btn--xs" type="button" onClick={async () => { try { await api.Inventory.Void(Number(lot.id)); useStore.getState().refresh() } catch (error) { toast(parseError(error).message ?? 'No se pudo anular el lote', 'bad') } }}><Trash2 size={13} /> Anular</button>}</div></div></div>}</article>
  }} /> : <MonthJournal page={page} loading={loading} onMore={() => void loadMore()} emptyText="Sin productos" renderRow={(product) => <button type="button" className="listrow listrow--click" onClick={() => { navigate(`/inventario/producto/${product.id}`) }}><span className="listrow__main"><b>{product.name}</b><span className="listrow__meta">{product.sku} · {product.stock ?? 0} uds</span></span><span className="listrow__metric"><small>Costo</small><Money cents={product.default_cost_cents} currency={currency} original={product.original_default_cost_cents} documentCurrency={product.default_cost_currency} tc={product.default_cost_tc} /></span><span className="listrow__metric"><small>Precio</small><Money cents={product.default_price_cents} currency={currency} original={product.original_default_price_cents} documentCurrency={product.default_price_currency} tc={product.default_price_tc} /></span></button>} />}{createLot && <ManualLotModal suppliers={catalog.suppliers} onClose={() => setCreateLot(false)} />}{editingLot && <ManualLotModal lot={editingLot} suppliers={catalog.suppliers} onClose={() => setEditingLot(null)} />}{createProduct && <ProductModal onClose={() => setCreateProduct(false)} />}</>
}

function useCatalogRows(currency: Currency, revision: number) {
  const [products, setProducts] = useState<Row[]>([])
  const [suppliers, setSuppliers] = useState<Row[]>([])
  useEffect(() => { let active = true; Promise.all([allPages(api.Catalog.ListProducts, currency), allPages(api.Catalog.ListSuppliers, currency)]).then(([productRows, supplierRows]) => { if (active) { setProducts(productRows); setSuppliers(supplierRows) } }).catch(() => {}); return () => { active = false } }, [currency, revision])
  return { products, suppliers }
}

function ManualLotModal({ lot, suppliers: initialSuppliers, onClose }: { lot?: Row; suppliers: Row[]; onClose: () => void }) {
  const [code, setCode] = useState(String(lot?.code ?? ''))
  const [productId, setProductId] = useState(String(lot?.product_id ?? ''))
  const [supplierId, setSupplierId] = useState(String(lot?.supplier_id ?? ''))
  const [qty, setQty] = useState(String(lot?.qty_initial ?? 1))
  const [cost, setCost] = useState(centsText(Number(lot?.unit_cost_cents ?? 0)))
  const [currency, setCurrency] = useState<Currency>((lot?.currency ?? 'PEN') as Currency)
  const [tc, setTc] = useState(tcText(Number(lot?.tc ?? 37500)))
  const [date, setDate] = useState(String(lot?.entry_date ?? todayISO()))
  const [countdown, setCountdown] = useState(lot?.countdown_days == null ? '' : String(lot.countdown_days))
  const [products, setProducts] = useState<Row[]>([])
  const [suppliers, setSuppliers] = useState(initialSuppliers)
  const [quickKind, setQuickKind] = useState<'product' | 'supplier' | null>(null)
  const [quickName, setQuickName] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useStore((state) => state.toast)
  useEffect(() => { void allPages(api.Catalog.ListProducts, currency).then(setProducts); if (!lot) { void api.Inventory.NextCode().then(setCode); void api.Settings.DefaultTC().then((rate) => setTc(tcText(rate))) } }, [])
  return <Modal title={lot ? `Editar lote ${lot.code}` : 'Ingresar lote manual'} onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const rate = tcFromText(tc); if (!rate) throw new Error('TC no válido'); await api.Inventory.SaveManualLot(new service.ManualLot({ id: Number(lot?.id ?? 0), code, productId: Number(productId), supplierId: supplierId ? Number(supplierId) : undefined, qty: Number(qty), unitCostCents: textToCents(cost) ?? 0, currency, tc: rate, entryDate: date, countdownDays: countdown === '' ? undefined : Number(countdown) })); useStore.getState().refresh(); toast(lot ? 'Lote actualizado' : `Lote ${code} ingresado`); onClose() } catch (error) { toast(parseError(error).message ?? 'No se pudo guardar el lote', 'bad') } finally { setBusy(false) } }}><Field label="Código" required><TextInput className="input--mono" value={code} onChange={(event) => setCode(event.target.value)} /></Field><Field label="Producto" required><Autocomplete options={products.map((product) => ({ value: String(product.id), label: product.name, sub: product.sku }))} value={productId} onChange={setProductId} placeholder="Producto…" onCreate={(name) => { setQuickName(name); setQuickKind('product') }} /></Field><div className="formgrid"><Field label="Cantidad" required><TextInput type="number" min="1" step="1" value={qty} onChange={(event) => setQty(event.target.value)} /></Field><Field label="Fecha de ingreso" required><TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field></div><Field label="Costo unitario" required><MoneyInput currency={currency} value={cost} onChange={setCost} /></Field><Field label="Moneda"><Seg options={[{ value: 'PEN', label: 'S/' }, { value: 'USD', label: '$' }]} value={currency} onChange={setCurrency} /></Field><Field label="TC (S/ por $)" required><TcField value={tc} onChange={setTc} /></Field><Field label="Proveedor (opcional)"><Autocomplete options={suppliers.map((supplier) => ({ value: String(supplier.id), label: supplier.name }))} value={supplierId} onChange={setSupplierId} placeholder="Sin proveedor" onCreate={(name) => { setQuickName(name); setQuickKind('supplier') }} /></Field><Field label="Días de cuenta regresiva (vacío usa global)"><TextInput type="number" min="0" step="1" value={countdown} onChange={(event) => setCountdown(event.target.value)} /></Field><div className="hstack"><ModalActions onClose={onClose} busy={busy} label={lot ? 'Guardar cambios' : 'Ingresar lote'} /></div></form>{quickKind && <QuickCatalogModal kind={quickKind} name={quickName} onClose={() => setQuickKind(null)} onCreated={(row) => { if (quickKind === 'product') { setProducts((old) => [...old, row]); setProductId(String(row.id)) } else { setSuppliers((old) => [...old, row]); setSupplierId(String(row.id)) }; setQuickKind(null) }} />}</Modal>
}

function QuickCatalogModal({ kind, name: initialName, onClose, onCreated }: { kind: 'product' | 'supplier'; name: string; onClose: () => void; onCreated: (row: Row) => void }) {
  const [name, setName] = useState(initialName); const [busy, setBusy] = useState(false); const toast = useStore((state) => state.toast)
  return <Modal title={kind === 'product' ? 'Nuevo producto' : 'Nuevo proveedor'} onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const row = kind === 'product' ? await api.Catalog.QuickCreateProduct(name) : await api.Catalog.QuickCreateSupplier(name); useStore.getState().refresh(); onCreated(row as Row) } catch (error) { toast(parseError(error).message ?? 'No se pudo crear', 'bad') } finally { setBusy(false) } }}><Field label="Nombre" required><TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Field><div className="hstack"><ModalActions onClose={onClose} busy={busy} label="Guardar" /></div></form></Modal>
}

function ProductModal({ onClose }: { onClose: () => void }) {
  const [sku, setSku] = useState(''); const [name, setName] = useState(''); const [cost, setCost] = useState(''); const [price, setPrice] = useState(''); const [costCurrency, setCostCurrency] = useState<Currency>('USD'); const [priceCurrency, setPriceCurrency] = useState<Currency>('PEN'); const [busy, setBusy] = useState(false); const toast = useStore((state) => state.toast)
  useEffect(() => { void api.Catalog.NextCode('product').then(setSku).catch(() => {}) }, [])
  return <Modal title="Nuevo producto" onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await api.Catalog.SaveProduct(new service.Product({ sku, name, defaultCostCents: textToCents(cost) ?? 0, defaultCostCurrency: costCurrency, defaultPriceCents: textToCents(price) ?? 0, defaultPriceCurrency: priceCurrency })); useStore.getState().refresh(); toast('Producto creado'); onClose() } catch (error) { toast(parseError(error).message ?? 'No se pudo crear el producto', 'bad') } finally { setBusy(false) } }}><Field label="Nombre" required><TextInput value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="SKU" required><TextInput className="input--mono" value={sku} onChange={(event) => setSku(event.target.value)} /></Field><Field label="Costo por defecto"><MoneyInput currency={costCurrency} value={cost} onChange={setCost} /></Field><Seg options={[{ value: 'USD', label: '$' }, { value: 'PEN', label: 'S/' }]} value={costCurrency} onChange={setCostCurrency} /><Field label="Precio por defecto"><MoneyInput currency={priceCurrency} value={price} onChange={setPrice} /></Field><Seg options={[{ value: 'PEN', label: 'S/' }, { value: 'USD', label: '$' }]} value={priceCurrency} onChange={setPriceCurrency} /><div className="hstack"><ModalActions onClose={onClose} busy={busy} label="Guardar producto" /></div></form></Modal>
}
