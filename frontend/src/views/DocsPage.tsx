import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, CircleCheck, Plus, Printer, Send, Trash2, Undo2, Wallet, Pencil } from 'lucide-react'
import { service } from '../../wailsjs/go/models'
import { api, allPages, query } from '../data/api'
import type { Currency, Page } from '../data/api'
import { useStore } from '../data/store'
import { statusView } from '../data/status'
import { parseError } from '../lib/errors'
import { cx, fmtDate, fmtDateShort, todayISO } from '../lib/format'
import { formatMoney, tcFromText, tcText, textToCents } from '../lib/money'
import { Badge, Field, Loading, Modal, Money, MoneyInput, Seg, TcField, TextInput, ViewHead } from '../components/ui'
import { DocumentFormModal } from './DocumentFormModal'
import { FilterBar, useServerFilters } from '../components/filters'
import { MonthJournal } from '../components/journal'
import { EntityLink } from '../components/entity'
import { printShipment } from '../components/print'

type Row = Record<string, any>
type Catalog = { clients: Row[]; suppliers: Row[]; products: Row[]; cards: Row[] }

export function DocsPage({ kind }: { kind: 'purchase' | 'sale' | 'shipment' }) {
  const currency = useStore((state) => state.currency)
  const revision = useStore((state) => state.revision)
  const toast = useStore((state) => state.toast)
  const [searchParams] = useSearchParams()
  const [catalog, setCatalog] = useState<Catalog>({ clients: [], suppliers: [], products: [], cards: [] })
  const [page, setPage] = useState<Page | null>(null)
  const [cursor, setCursor] = useState('')
  const [loading, setLoading] = useState(true)
  const [moreLoading, setMoreLoading] = useState(false)
  const filterState = useServerFilters(kind === 'purchase' ? 'purchases' : 'sales')
  const [purchaseTab, setPurchaseTab] = useState('all')
  const [openIds, setOpenIds] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<{ record: service.Purchase | service.Sale; extrasOnly: boolean } | null>(null)
  const filter = kind === 'purchase' ? filterState.filters : [...filterState.filters, new service.Filter({ field: 'kind', op: 'is', value: kind })]
  const filterKey = JSON.stringify(filter.map((item) => ({ field: item.field, op: item.op, value: item.value, end: item.end })))

  useEffect(() => {
    let active = true
    Promise.all([
      allPages(api.Catalog.ListClients, currency), allPages(api.Catalog.ListSuppliers, currency),
      allPages(api.Catalog.ListProducts, currency), allPages(api.Catalog.ListCards, currency),
    ]).then(([clients, suppliers, products, cards]) => { if (active) setCatalog({ clients, suppliers, products, cards }) }).catch(() => {})
    return () => { active = false }
  }, [currency, revision])

  useEffect(() => {
    let active = true
    setLoading(true); setCursor('')
    const loader = kind === 'purchase' ? api.Purchases.List(query(currency, filter, '', 6)) : api.Sales.List(query(currency, filter, '', 6))
    loader.then((result) => { if (active) { setPage(result); setCursor(result.nextCursor ?? ''); setLoading(false) } }).catch((error) => { if (active) { setPage({ months: [] } as unknown as Page); setLoading(false); toast(parseError(error).message ?? 'No se pudieron cargar los registros', 'bad') } })
    return () => { active = false }
  }, [kind, currency, filterKey, revision])

  useEffect(() => {
    const code = searchParams.get('abrir')
    if (!code || !page) return
    let found = false
    for (const month of page.months ?? []) {
      const row = (month.rows as Row[]).find((entry) => entry.code === code)
      if (row) { found = true; setOpenIds((old) => new Set(old).add(Number(row.id))); break }
    }
    if (!found && cursor && !moreLoading) void loadMore()
  }, [page, searchParams, cursor, moreLoading])
  useEffect(() => { useStore.getState().registerNew(() => setCreating(true)); return () => useStore.getState().registerNew(null) }, [])

  const visiblePage = useMemo(() => {
    if (kind !== 'purchase' || purchaseTab === 'all' || !page) return page
    const months = page.months.map((month) => {
      const rows = (month.rows as Row[]).filter((row) => row.for_client_id != null)
      return { ...month, rows, count: rows.length, total: rows.reduce((sum, row) => sum + Number(row.totalCents ?? 0), 0) }
    }).filter((month) => month.count > 0)
    return { ...page, months } as Page
  }, [kind, purchaseTab, page])

  const title = kind === 'purchase' ? 'Compras' : kind === 'sale' ? 'Ventas' : 'Envíos'
  const createLabel = kind === 'purchase' ? 'Nueva compra' : kind === 'sale' ? 'Nueva venta' : 'Nuevo envío'
  const loadMore = async () => {
    if (!cursor || moreLoading) return
    setMoreLoading(true)
    try {
      const q = query(currency, filter, cursor, 6)
      const next = kind === 'purchase' ? await api.Purchases.List(q) : await api.Sales.List(q)
      setPage((old) => ({ months: [...(old?.months ?? []), ...(next.months ?? [])], nextCursor: next.nextCursor } as unknown as Page))
      setCursor(next.nextCursor ?? '')
    } catch (error) { toast(parseError(error).message ?? 'No se pudieron cargar más meses', 'bad') }
    finally { setMoreLoading(false) }
  }

  const counterparty = (row: Row) => kind === 'purchase'
    ? catalog.suppliers.find((supplier) => supplier.id === row.supplier_id)?.name ?? 'Proveedor'
    : catalog.clients.find((client) => client.id === row.client_id)?.name ?? 'Cliente general'

  return <>
    <ViewHead title={title} subtitle={kind === 'purchase' ? 'Órdenes, costos extras y recepción de mercadería' : kind === 'sale' ? 'Ventas, pagos y cuentas por cobrar' : 'Despachos, seguimiento y comprobante'} actions={<button className="btn btn--primary btn--sm" type="button" onClick={() => setCreating(true)}><Plus size={14} /> {createLabel}</button>} />
    {kind === 'purchase' && <div className="pagebar"><Seg label="Compras" options={[{ value: 'all', label: 'Todas' }, { value: 'clients', label: 'Para clientes' }]} value={purchaseTab} onChange={setPurchaseTab} /></div>}
    <FilterBar state={filterState} />
    {loading && !page ? <Loading /> : <MonthJournal page={visiblePage} loading={loading} onMore={() => void loadMore()} emptyText={purchaseTab === 'clients' ? 'Sin compras para clientes' : 'Sin registros que coincidan con los filtros'} renderRow={(row) => {
      const id = Number(row.id)
      const state = statusView(kind === 'purchase' ? 'purchases' : 'sales', row.status)
      const opened = openIds.has(id)
      return <article className={cx('rec', state && `tint--${state.tone}`, row.status === 'voided' && 'rec--void', opened && 'rec--open')}><button className="rec__main" type="button" aria-expanded={opened} onClick={() => setOpenIds((old) => { const next = new Set(old); opened ? next.delete(id) : next.add(id); return next })}><span className="rec__id"><b className="rec__code">{row.code}</b><span className="rec__meta">{title.slice(0, -1)} · {fmtDateShort(row.date)}</span></span><span className="rec__title">{counterparty(row)}</span><span className="rec__amount"><Money cents={row.totalCents ?? 0} currency={currency} original={row.originalTotalCents} documentCurrency={(row.currency ?? 'PEN') as Currency} tc={row.tc} />{Number(row.balanceCents) > 0 && <small className="rec__balance">Saldo {formatMoney(row.balanceCents, currency)}</small>}</span><span className="rec__state"><Badge state={state} /></span><ChevronDown size={14} /></button>{opened && <DocumentDetail kind={kind} row={row} counterparty={counterparty(row)} catalog={catalog} onEdit={(record, extrasOnly = false) => setEditing({ record, extrasOnly })} afterChange={() => { useStore.getState().refresh(); toast(`${row.code} actualizado`) }} />}</article>
    }} />}
    {creating && <DocumentFormModal kind={kind} catalog={catalog} onClose={() => setCreating(false)} />}
    {editing && <DocumentFormModal kind={kind} catalog={catalog} existing={editing.record} extrasOnly={editing.extrasOnly} onClose={() => setEditing(null)} />}
  </>
}

function DocumentDetail({ kind, row, counterparty, catalog, onEdit, afterChange }: { kind: 'purchase' | 'sale' | 'shipment'; row: Row; counterparty: string; catalog: Catalog; onEdit: (record: service.Purchase | service.Sale, extrasOnly?: boolean) => void; afterChange: () => void }) {
  const currency = useStore((state) => state.currency)
  const revision = useStore((state) => state.revision)
  const toast = useStore((state) => state.toast)
  const [document, setDocument] = useState<Row | null>(null)
  const [summary, setSummary] = useState<Row | null>(null)
  const [costing, setCosting] = useState<Row | null>(null)
  const [lots, setLots] = useState<Record<number, Row>>({})
  const [advances, setAdvances] = useState<Row[]>([])
  const [payments, setPayments] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    const request = kind === 'purchase' ? api.Purchases.Get(Number(row.id)) : api.Sales.Get(Number(row.id))
    request.then(async (value) => {
      if (!active) return
      const record = value as Row
      setDocument(record)
      const products = [...new Set((record.items ?? []).map((item: Row) => Number(item.productId)))]
      const lotLists = await Promise.all(products.map((productId) => api.Inventory.LotsForProduct(Number(productId)).catch(() => [])))
      if (active) setLots(Object.fromEntries(lotLists.flatMap((entries) => entries as Row[]).map((lot) => [Number(lot.id), lot])))
      if (kind === 'purchase' && record.forClientId) {
        const found: Row[] = []
        let cursor = ''
        for (let index = 0; index < 120; index++) {
          const page = await api.Payments.List(query(currency, [new service.Filter({ field: 'kind', op: 'is', value: 'advance' })], cursor, 120))
          for (const month of page.months ?? []) found.push(...month.rows as Row[])
          if (!page.nextCursor || page.nextCursor === cursor) break
          cursor = page.nextCursor
        }
        if (active) setAdvances(found.filter((payment) => Number(payment.purchase_id) === Number(record.id)))
      }
    }).catch((error) => toast(parseError(error).message ?? 'No se pudo cargar el detalle', 'bad'))
    if (kind !== 'purchase') {
      api.Sales.Summary(Number(row.id), currency).then((value) => { if (active) setSummary(value as Row) })
      api.Sales.Costing(Number(row.id), currency).then((value) => { if (active) setCosting(value as Row) })
      const loadPayments = async () => {
        const found: Row[] = []
        for (const paymentKind of ['payment', 'advance']) {
          const page = await api.Payments.List(query(currency, [new service.Filter({ field: 'kind', op: 'is', value: paymentKind })], '', 120))
          for (const month of page.months ?? []) found.push(...month.rows as Row[])
        }
        if (active) setPayments(found.filter((payment) => Number(payment.sale_id) === Number(row.id)))
      }
      void loadPayments().catch(() => {})
    }
    return () => { active = false }
  }, [row.id, kind, currency, revision])

  const act = async (action: () => Promise<unknown>, label: string) => {
    setBusy(true)
    try { await action(); afterChange(); toast(label) }
    catch (error) { toast(parseError(error).message ?? 'No se pudo completar la acción', 'bad') }
    finally { setBusy(false) }
  }
  if (!document) return <div className="rec__body"><Loading /></div>
  const totalSales = summary?.totalCents ?? row.totalCents ?? 0
  return <div className="rec__body"><div className="rec__bodyin">
    <div className="meta-grid"><div className="meta-grid__cell"><span className="meta-grid__k">{kind === 'purchase' ? 'Proveedor' : 'Cliente'}</span><span className="meta-grid__v">{kind === 'purchase' ? <EntityLink kind="supplier" id={document.supplierId}>{counterparty}</EntityLink> : document.clientId ? <EntityLink kind="client" id={document.clientId}>{catalog.clients.find((client) => Number(client.id) === Number(document.clientId))?.name ?? counterparty}</EntityLink> : 'Cliente general'}</span></div><div className="meta-grid__cell"><span className="meta-grid__k">Fecha</span><span className="meta-grid__v">{fmtDate(document.date)}</span></div><div className="meta-grid__cell"><span className="meta-grid__k">Moneda · TC</span><span className="meta-grid__v">{document.currency} · {tcText(document.tc)}</span></div>{kind === 'purchase' && <div className="meta-grid__cell"><span className="meta-grid__k">Método de pago</span><span className="meta-grid__v">{document.paymentMethod}{document.cardId ? ` · ${catalog.cards.find((card) => Number(card.id) === Number(document.cardId))?.name ?? ''}` : ''}</span></div>}{kind === 'shipment' && <div className="meta-grid__cell"><span className="meta-grid__k">Dirección</span><span className="meta-grid__v">{document.shipAddress} · {document.shipRegion} · seguridad {document.securityCode}</span></div>}</div>
    <div className="table-scroll"><table className="tbl"><thead><tr><th>Producto</th><th>Detalle · lote</th><th className="num">Cant.</th><th className="num">Unitario</th></tr></thead><tbody>{(document.items ?? []).map((item: Row, index: number) => { const product = catalog.products.find((value) => Number(value.id) === Number(item.productId)); const lot = lots[Number(item.lotId)]; return <tr key={item.id ?? index}><td><EntityLink kind="product" id={item.productId}>{product?.name ?? `Producto ${item.productId}`}</EntityLink></td><td>{item.description || '—'} {lot && <EntityLink kind="lot" id={item.lotId} chip>{lot.code}</EntityLink>}</td><td className="num">{item.qty}</td><td className="num"><Money cents={kind === 'purchase' ? item.unitCostCents : item.unitPriceCents} currency={document.currency} /></td></tr>})}</tbody></table></div>
    {(document.extras ?? []).map((extra: Row) => <div className="sumrow" key={extra.id}>{extra.concept}<Money cents={extra.amountCents} currency={extra.currency} /></div>)}
    <div className="sum-grid"><div className="sumrow sumrow--strong"><span>Total</span><Money cents={kind === 'purchase' ? row.totalCents : totalSales} currency={currency} original={kind === 'purchase' ? row.originalTotalCents : summary?.originalTotalCents} documentCurrency={kind === 'purchase' ? document.currency : summary?.documentCurrency} tc={document.tc} /></div>{kind !== 'purchase' && <><div className="sumrow"><span>Pagado</span><Money cents={summary?.paidCents ?? 0} /></div><div className="sumrow"><span>Saldo</span><Money cents={summary?.balanceCents ?? 0} /></div><div className="sumrow"><span>Costo base de lotes</span><Money cents={costing?.costBaseCents ?? 0} /></div><div className="sumrow"><span>Costos extras proporcionales</span><Money cents={costing?.costExtraCents ?? 0} /></div><div className="sumrow sumrow--strong"><span>Utilidad</span><Money cents={costing?.profitCents ?? 0} /></div></>}</div>
    {kind === 'purchase' && advances.length > 0 && <section className="detail-payments"><h3>Adelantos</h3>{advances.map((advance) => <div className="listrow" key={advance.id}><span className="listrow__main"><b>{advance.code}</b><span className="listrow__meta">{fmtDateShort(advance.date)} · {advance.method}</span></span><Money cents={advance.amount_cents} currency={currency} original={advance.original_amount_cents} documentCurrency={advance.currency} tc={advance.tc} /><Badge state={statusView('payments', advance.status)} />{advance.status === 'active' && <button className="btn btn--xs" type="button" onClick={() => void act(() => api.Payments.RefundAdvance(Number(advance.id)), 'Adelanto devuelto')}>Devolver</button>}</div>)}</section>}
    {kind !== 'purchase' && payments.length > 0 && <section className="detail-payments"><h3>Cobros y adelantos</h3>{payments.map((payment) => <div className="listrow" key={payment.id}><span className="listrow__main"><b>{payment.code}</b><span className="listrow__meta">{fmtDateShort(payment.date)} · {payment.method}</span></span><Money cents={payment.amount_cents} currency={currency} original={payment.original_amount_cents} documentCurrency={payment.currency} tc={payment.tc} />{payment.kind === 'advance' && <Badge state={statusView('payments', payment.status)} />}</div>)}</section>}
    <div className="rec__foot hstack hstack--wrap">{kind === 'purchase' && row.status === 'pending' && <button className="btn btn--primary btn--xs" type="button" disabled={busy} onClick={() => void act(() => api.Purchases.ReceivePurchase(Number(row.id)), 'Compra recibida')}><CircleCheck size={13} /> Marcar recibida</button>}{kind === 'purchase' && row.status === 'reserved' && document.forClientId && <SellReservedAction purchase={document as service.Purchase} catalog={catalog} />}{kind === 'purchase' && document.forClientId && <AdvanceAction purchase={document as service.Purchase} />}{kind === 'purchase' && document.forClientId && row.status !== 'voided' && <button type="button" className="btn btn--xs" disabled={busy} onClick={() => window.confirm('¿Cancelar el encargo? Los adelantos activos pasarán a Devuelto y se liberarán los lotes.') && void act(() => api.Purchases.CancelOrder(Number(row.id)), 'Encargo cancelado')}>Cancelar encargo</button>}{kind === 'shipment' && row.status !== 'delivered' && row.status !== 'voided' && <button className="btn btn--primary btn--xs" type="button" disabled={busy} onClick={() => void act(() => api.Sales.AdvanceShipment(Number(row.id)), 'Estado del envío actualizado')}><Send size={13} /> Avanzar estado</button>}{kind === 'shipment' && <button className="btn btn--xs" type="button" onClick={() => printShipment(document as service.Sale, catalog.products, catalog.clients.find((client) => Number(client.id) === Number(document.clientId))?.name ?? 'Cliente general', Number(summary?.originalTotalCents ?? 0))}><Printer size={13} /> Comprobante</button>}{row.status !== 'voided' && (kind !== 'purchase' || row.status === 'pending') && <button type="button" className="btn btn--xs" disabled={busy} onClick={() => onEdit(document as service.Purchase | service.Sale, kind === 'purchase' && row.status !== 'pending')}><Pencil size={13} /> Editar</button>}{kind !== 'purchase' && Number(summary?.balanceCents ?? 0) > 0 && <PaymentAction sale={document as service.Sale} />}<button type="button" className="btn btn--xs" disabled={busy || row.status === 'voided'} onClick={() => onEdit(document as service.Purchase | service.Sale, true)}>Editar extras</button>{row.status === 'voided' ? <button className="btn btn--xs" type="button" onClick={() => void act(() => kind === 'purchase' ? api.Purchases.Restore(Number(row.id)) : api.Sales.Restore(Number(row.id)), 'Registro restaurado')}><Undo2 size={13} /> Restaurar</button> : <button className="btn btn--xs" type="button" disabled={busy} onClick={() => void act(() => kind === 'purchase' ? api.Purchases.Void(Number(row.id)) : api.Sales.Void(Number(row.id)), 'Registro anulado')}><Trash2 size={13} /> Anular</button>}</div>
  </div></div>
}

function PaymentAction({ sale }: { sale: service.Sale }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" className="btn btn--xs" onClick={() => setOpen(true)}><Wallet size={13} /> Registrar cobro</button>{open && <PaymentDialog sale={sale} onClose={() => setOpen(false)} />}</>
}

function AdvanceAction({ purchase }: { purchase: service.Purchase }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" className="btn btn--xs" onClick={() => setOpen(true)}><Wallet size={13} /> Registrar adelanto</button>{open && <AdvanceDialog purchase={purchase} onClose={() => setOpen(false)} />}</>
}

function AdvanceDialog({ purchase, onClose }: { purchase: service.Purchase; onClose: () => void }) {
  const [code, setCode] = useState(''); const [amount, setAmount] = useState(''); const [currency, setCurrency] = useState<Currency>('PEN'); const [date, setDate] = useState(todayISO()); const [method, setMethod] = useState(useStore.getState().settings.last_payment_method ?? 'cash'); const [tc, setTc] = useState('3.7500'); const [busy, setBusy] = useState(false); const toast = useStore((state) => state.toast)
  useEffect(() => { void api.Payments.NextCode().then(setCode); void api.Settings.DefaultTC().then((rate) => setTc(tcText(rate))) }, [])
  return <Modal title={`Registrar adelanto · ${purchase.code}`} onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const rate = tcFromText(tc); if (!rate) throw new Error('TC no válido'); await api.Payments.AddAdvance(new service.Payment({ code, clientId: purchase.forClientId, purchaseId: purchase.id, date, method, amountCents: textToCents(amount) ?? 0, currency, tc: rate })); useStore.getState().refresh(); toast('Adelanto registrado'); onClose() } catch (error) { toast(parseError(error).message ?? 'No se pudo registrar el adelanto', 'bad') } finally { setBusy(false) } }}><Field label="Código" required><TextInput className="input--mono" value={code} onChange={(event) => setCode(event.target.value)} /></Field><Field label="Monto" required><MoneyInput currency={currency} value={amount} onChange={setAmount} /></Field><div className="formgrid"><Field label="Fecha"><TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Método"><select className="select" value={method} onChange={(event) => setMethod(event.target.value)}><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="wallet">Billetera digital</option></select></Field></div><Seg options={[{ value: 'PEN', label: 'S/' }, { value: 'USD', label: '$' }]} value={currency} onChange={setCurrency} /><Field label="TC (S/ por $)" required><TcField value={tc} onChange={setTc} /></Field><div className="hstack"><button className="btn" type="button" onClick={onClose}>Cancelar</button><button className="btn btn--primary" disabled={busy}>{busy ? 'Guardando…' : 'Registrar adelanto'}</button></div></form></Modal>
}

function SellReservedAction({ purchase, catalog }: { purchase: service.Purchase; catalog: Catalog }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" className="btn btn--primary btn--xs" onClick={() => setOpen(true)}><Send size={13} /> Vender a cliente</button>{open && <SellReservedDialog purchase={purchase} catalog={catalog} onClose={() => setOpen(false)} />}</>
}

function SellReservedDialog({ purchase, catalog, onClose }: { purchase: service.Purchase; catalog: Catalog; onClose: () => void }) {
  const [items, setItems] = useState(() => (purchase.items ?? []).map((item) => ({ productId: item.productId, qty: String(item.qty), price: '' })))
  const [kind, setKind] = useState<'sale' | 'shipment'>('sale')
  const [region, setRegion] = useState('')
  const [address, setAddress] = useState('')
  const [securityCode, setSecurityCode] = useState('')
  const [tc, setTc] = useState('3.7500')
  const [busy, setBusy] = useState(false)
  const toast = useStore((state) => state.toast)
  useEffect(() => { void api.Settings.DefaultTC().then((rate) => setTc(tcText(rate))) }, [])
  return <Modal title={`Vender a cliente · ${purchase.code}`} onClose={onClose} wide><form className="stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const rate = tcFromText(tc); if (!rate) throw new Error('TC no válido'); const saleItems = items.map((item) => new service.SaleItem({ productId: item.productId, lotId: 0, qty: Number(item.qty), unitPriceCents: textToCents(item.price) ?? 0, description: '' })); await api.Sales.SellToClient(Number(purchase.forClientId), purchase.id, new service.Sale({ kind, clientId: purchase.forClientId, purchaseId: purchase.id, date: todayISO(), currency: 'PEN', tc: rate, items: saleItems, extras: [], paidNowCents: 0, paymentMethod: 'cash', shipRegion: region, shipAddress: address, securityCode })); useStore.getState().refresh(); toast('Venta creada desde el encargo'); onClose() } catch (error) { toast(parseError(error).message ?? 'No se pudo vender a cliente', 'bad') } finally { setBusy(false) } }}><div className="forminfo">Las unidades se asignarán a los lotes reservados en orden FIFO. Los adelantos activos se aplicarán automáticamente.</div><Field label="Tipo de documento"><Seg options={[{ value: 'sale', label: 'Venta' }, { value: 'shipment', label: 'Envío' }]} value={kind} onChange={setKind} /></Field>{items.map((item, index) => <div className="formgrid" key={`${item.productId}-${index}`}><Field label="Producto"><span>{catalog.products.find((product) => Number(product.id) === Number(item.productId))?.name ?? `Producto ${item.productId}`}</span></Field><Field label="Cantidad" required><TextInput type="number" min="1" step="1" value={item.qty} onChange={(event) => setItems((old) => old.map((line, i) => i === index ? { ...line, qty: event.target.value } : line))} /></Field><Field label="Precio unitario (S/)" required><MoneyInput currency="PEN" value={item.price} onChange={(price) => setItems((old) => old.map((line, i) => i === index ? { ...line, price } : line))} /></Field></div>)}{kind === 'shipment' && <div className="formgrid"><Field label="Región" required><TextInput value={region} onChange={(event) => setRegion(event.target.value)} /></Field><Field label="Dirección" required><TextInput value={address} onChange={(event) => setAddress(event.target.value)} /></Field><Field label="Código de seguridad"><TextInput inputMode="numeric" maxLength={4} value={securityCode} onChange={(event) => setSecurityCode(event.target.value.replace(/\D/g, '').slice(0, 4))} /></Field></div>}<Field label="TC (S/ por $)" required><TcField value={tc} onChange={setTc} /></Field><div className="hstack"><button className="btn" type="button" onClick={onClose}>Cancelar</button><button className="btn btn--primary" disabled={busy}>{busy ? 'Guardando…' : `Crear ${kind === 'sale' ? 'venta' : 'envío'}`}</button></div></form></Modal>
}

function PaymentDialog({ sale, onClose }: { sale: service.Sale; onClose: () => void }) {
  const [code, setCode] = useState(''); const [amount, setAmount] = useState(''); const [date, setDate] = useState(todayISO()); const [method, setMethod] = useState(useStore.getState().settings.last_payment_method ?? 'cash'); const [tc, setTc] = useState('3.7500'); const [busy, setBusy] = useState(false); const toast = useStore((state) => state.toast)
  useEffect(() => { void api.Payments.NextCode().then(setCode); void api.Settings.DefaultTC().then((rate) => setTc(tcText(rate))) }, [])
  return <Modal title={`Registrar cobro · ${sale.code}`} onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const rate = tcFromText(tc); if (!rate) throw new Error('TC no válido'); await api.Payments.AddPayment(new service.Payment({ code, saleId: sale.id, date, method, amountCents: textToCents(amount) ?? 0, currency: sale.currency, tc: rate })); useStore.getState().refresh(); toast('Cobro registrado'); onClose() } catch (error) { toast(parseError(error).message ?? 'No se pudo registrar el cobro', 'bad') } finally { setBusy(false) } }}><Field label="Código" required><TextInput className="input--mono" value={code} onChange={(event) => setCode(event.target.value)} /></Field><Field label="Monto" required><MoneyInput currency={sale.currency as Currency} value={amount} onChange={setAmount} /></Field><div className="formgrid"><Field label="Fecha"><TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Método"><select className="select" value={method} onChange={(event) => setMethod(event.target.value)}><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="wallet">Billetera digital</option></select></Field></div><Field label="TC (S/ por $)" required><TcField value={tc} onChange={setTc} /></Field><div className="hstack"><button className="btn" type="button" onClick={onClose}>Cancelar</button><button className="btn btn--primary" disabled={busy}>{busy ? 'Guardando…' : 'Registrar cobro'}</button></div></form></Modal>
}
