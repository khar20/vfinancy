import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, CircleCheck, Plus, Printer, Send, Undo2, Wallet, XCircle } from 'lucide-react'
import { service } from '../../wailsjs/go/models'
import { api, allPages, query } from '../data/api'
import type { Currency, Page } from '../data/api'
import { useStore } from '../data/store'
import { statusView } from '../data/status'
import { parseError } from '../lib/errors'
import { cx, fmtDate, fmtDateShort, todayISO } from '../lib/format'
import { formatMoney, tcFromText, tcText, textToCents } from '../lib/money'
import { Badge, Field, Loading, Modal, Money, MoneyInput, Seg, TcField, TextInput, ViewHead } from '../components/ui'
import { RowMenu } from '../components/menu'
import { DocumentFormModal } from './DocumentFormModal'
import { FilterBar, useServerFilters } from '../components/filters'
import { MonthJournal } from '../components/journal'
import { EntityLink } from '../components/entity'
import { printShipment } from '../components/print'

type Row = Record<string, any>
type Catalog = { clients: Row[]; suppliers: Row[]; products: Row[]; cards: Row[] }
const isPurchaseKind = (kind: string): boolean => kind === 'purchase'

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
      return <article className={cx('rec', state && `stripe stripe--${state.tone}`, row.status === 'voided' && 'rec--void', opened && 'rec--open')}><button className="rec__main" type="button" aria-expanded={opened} onClick={() => setOpenIds((old) => { const next = new Set(old); opened ? next.delete(id) : next.add(id); return next })}><span className="rec__id"><b className={cx('rec__code', row.status === 'voided' && 'rec__code--void')}>{row.code}</b><span className="rec__meta">{title.slice(0, -1)} · {fmtDateShort(row.date)}</span></span><span className="rec__title">{counterparty(row)}</span><span className="rec__amount"><Money cents={row.totalCents ?? 0} currency={currency} original={row.originalTotalCents} documentCurrency={(row.currency ?? 'PEN') as Currency} tc={row.tc} />{Number(row.balanceCents) > 0 && <small className="rec__balance">Saldo {formatMoney(row.balanceCents, currency)}</small>}</span><span className="rec__state"><Badge state={state} /></span><ChevronDown size={14} /></button>{opened && <DocumentDetail kind={kind} row={row} counterparty={counterparty(row)} catalog={catalog} onEdit={(record, extrasOnly = false) => setEditing({ record, extrasOnly })} afterChange={() => { useStore.getState().refresh(); toast(`${row.code} actualizado`) }} />}</article>
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
  const [purchaseTotals, setPurchaseTotals] = useState<service.DocumentTotals | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    setDocument(null)
    setPurchaseTotals(null)
    setSummary(null)
    setCosting(null)
    const request = kind === 'purchase' ? api.Purchases.Get(Number(row.id)) : api.Sales.Get(Number(row.id))
    request.then(async (value) => {
      if (!active) return
      const record = value as Row
      setDocument(record)
      if (kind === 'purchase') void api.Purchases.PreviewTotal(record as service.Purchase, currency).then((totals) => { if (active) setPurchaseTotals(totals) }).catch(() => { if (active) setPurchaseTotals(null) })
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
      api.Sales.Summary(Number(row.id), currency).then((value) => { if (active) setSummary(value as Row) }).catch(() => { if (active) setSummary(null) })
      api.Sales.Costing(Number(row.id), currency).then((value) => { if (active) setCosting(value as Row) }).catch(() => { if (active) setCosting(null) })
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
  if (isPurchaseKind(kind)) return <PurchaseDetail document={document as service.Purchase} row={row} counterparty={counterparty} catalog={catalog} lots={lots} advances={advances} totals={purchaseTotals} busy={busy} act={act} onEdit={onEdit} />
  if (kind === 'sale') return <SaleDetail document={document as service.Sale} row={row} catalog={catalog} lots={lots} summary={summary} costing={costing} busy={busy} act={act} onEdit={onEdit} />
  return <ShipmentDetail document={document as service.Sale} row={row} catalog={catalog} lots={lots} summary={summary} costing={costing} busy={busy} act={act} onEdit={onEdit} />
}

type SaleDetailProps = {
  document: service.Sale
  row: Row
  catalog: Catalog
  lots: Record<number, Row>
  summary: Row | null
  costing: Row | null
  busy: boolean
  act: (action: () => Promise<unknown>, label: string) => Promise<void>
  onEdit: (record: service.Purchase | service.Sale, extrasOnly?: boolean) => void
}

function SaleDetail({ document, row, catalog, lots, summary, costing, busy, act, onEdit }: SaleDetailProps) {
  const currency = useStore((state) => state.currency)
  const payments = document.payments ?? []
  const advance = payments.find((payment) => payment.kind === 'advance')
  const charges = payments.filter((payment) => payment.kind === 'payment')
  const client = document.clientId == null ? null : catalog.clients.find((entry) => Number(entry.id) === Number(document.clientId))
  const balance = Number(summary?.balanceCents ?? 0)
  const total = Number(summary?.totalCents ?? row.totalCents ?? 0)

  return <div className="rec__body"><div className="rec__bodyin">
    <div className="meta-grid">
      <div className="meta-grid__cell"><span className="meta-grid__k">Cliente</span><span className="meta-grid__v">{client ? <EntityLink kind="client" id={client.id}>{client.name}</EntityLink> : 'Cliente general'}</span></div>
      <div className="meta-grid__cell"><span className="meta-grid__k">Moneda del documento</span><span className="meta-grid__v">{document.currency}</span></div>
      <div className="meta-grid__cell"><span className="meta-grid__k">Fecha</span><span className="meta-grid__v">{fmtDate(document.date)}</span></div>
      {advance && <div className="meta-grid__cell"><span className="meta-grid__k">Adelanto</span><span className="meta-grid__v"><Money cents={advance.amountCents} currency={advance.currency as Currency} /> · Aplicado</span></div>}
    </div>
    <SaleItems document={document} catalog={catalog} lots={lots} />
    <ExtrasBlock extras={document.extras ?? []} label="Precio extras" />
    <div className="sum-grid">
      <div>
        <SummaryRow label="Ingresos" value={<Money cents={total} currency={currency} original={summary?.originalTotalCents} documentCurrency={document.currency as Currency} tc={document.tc} />} strong />
        <SummaryRow label="Costo base de lotes" value={<Money cents={costing?.costBaseCents ?? 0} />} />
        <SummaryRow label="Costos extras proporcional" value={<Money cents={costing?.costExtraCents ?? 0} />} />
        <SummaryRow label="Utilidad" value={<Money cents={costing?.profitCents ?? 0} />} tone="ok" strong />
      </div>
      <div>
        <SummaryRow label="Pagado" value={<Money cents={summary?.paidCents ?? 0} />} tone="ok" />
        <SummaryRow label="Saldo" value={<Money cents={balance} />} tone={balance > 0 ? 'warn' : undefined} strong={balance > 0} />
        {charges.length > 0 && <PaymentNotes payments={charges} />}
      </div>
    </div>
    <div className="rec__foot">
      <div className="hstack hstack--wrap">{advance && <span className="tag">Adelanto {advance.code} · Aplicado</span>}</div>
      <div className="hstack">
        {balance > 0 && <PaymentAction sale={document} />}
        <button type="button" className="btn btn--xs" disabled={busy || row.status === 'voided'} onClick={() => onEdit(document, true)}>Editar extras</button>
        {row.status !== 'voided' && <button type="button" className="btn btn--xs" disabled={busy} onClick={() => onEdit(document)}>Editar</button>}
        {row.status === 'voided'
          ? <RowMenu label="Más acciones" items={[{ label: 'Restaurar venta', icon: <Undo2 size={13} />, disabled: busy, onSelect: () => void act(() => api.Sales.Restore(Number(row.id)), 'Venta restaurada') }]} />
          : <RowMenu label="Más acciones" items={[{ label: 'Anular venta', icon: <XCircle size={13} />, danger: true, disabled: busy, onSelect: () => void act(() => api.Sales.Void(Number(row.id)), 'Venta anulada') }]} />}
      </div>
    </div>
  </div></div>
}

function ShipmentDetail({ document, row, catalog, lots, summary, costing, busy, act, onEdit }: SaleDetailProps) {
  const currency = useStore((state) => state.currency)
  const payments = (document.payments ?? []).filter((payment) => payment.kind === 'payment')
  const client = document.clientId == null ? null : catalog.clients.find((entry) => Number(entry.id) === Number(document.clientId))
  const balance = Number(summary?.balanceCents ?? 0)
  const total = Number(summary?.totalCents ?? row.totalCents ?? 0)

  return <div className="rec__body"><div className="rec__bodyin">
    <div className="meta-grid">
      <div className="meta-grid__cell"><span className="meta-grid__k">Cliente</span><span className="meta-grid__v">{client ? <EntityLink kind="client" id={client.id}>{client.name}</EntityLink> : 'Cliente general'}</span></div>
      <div className="meta-grid__cell"><span className="meta-grid__k">Dirección</span><span className="meta-grid__v">{document.shipAddress} / {document.shipRegion}</span></div>
      <div className="meta-grid__cell"><span className="meta-grid__k">Fecha</span><span className="meta-grid__v">{fmtDate(document.date)}</span></div>
      <div className="meta-grid__cell"><span className="meta-grid__k">Código de seguridad</span><span className="meta-grid__v"><span className="lotchip lotchip--static">{document.securityCode}</span></span></div>
    </div>
    <SaleItems document={document} catalog={catalog} lots={lots} />
    <ExtrasBlock extras={document.extras ?? []} label="Precio extras" />
    <div className="sum-grid">
      <div>
        <SummaryRow label="Ingresos" value={<Money cents={total} currency={currency} original={summary?.originalTotalCents} documentCurrency={document.currency as Currency} tc={document.tc} />} strong />
        <SummaryRow label="Utilidad" value={<Money cents={costing?.profitCents ?? 0} />} tone="ok" />
      </div>
      <div>
        <SummaryRow label="Pagado" value={<Money cents={summary?.paidCents ?? 0} />} tone="ok" />
        {balance > 0 && <SummaryRow label={<span className="saldo-amber">Saldo {formatMoney(balance, currency)}</span>} value={<PaymentAction sale={document} />} />}
        {payments.length > 0 && <PaymentNotes payments={payments} />}
      </div>
    </div>
    <div className="rec__foot">
      <div className="hstack">
        <button type="button" className="btn btn--xs" onClick={() => printShipment(document, catalog.products, client?.name ?? 'Cliente general', Number(summary?.originalTotalCents ?? 0))}><Printer size={13} /> Comprobante</button>
        {row.status === 'prepared' && <button type="button" className="btn btn--primary btn--xs" disabled={busy} onClick={() => void act(() => api.Sales.AdvanceShipment(Number(row.id)), 'Envío marcado como enviado')}><Send size={13} /> Marcar enviado</button>}
        {row.status === 'sent' && <button type="button" className="btn btn--primary btn--xs" disabled={busy} onClick={() => void act(() => api.Sales.AdvanceShipment(Number(row.id)), 'Envío marcado como entregado')}><CircleCheck size={13} /> Marcar entregado</button>}
        <button type="button" className="btn btn--xs" disabled={busy || row.status === 'voided'} onClick={() => onEdit(document, true)}>Editar extras</button>
        {row.status !== 'voided' && <button type="button" className="btn btn--xs" disabled={busy} onClick={() => onEdit(document)}>Editar</button>}
        {row.status === 'voided'
          ? <RowMenu label="Más acciones" items={[{ label: 'Restaurar envío', icon: <Undo2 size={13} />, disabled: busy, onSelect: () => void act(() => api.Sales.Restore(Number(row.id)), 'Envío restaurado') }]} />
          : <RowMenu label="Más acciones" items={[{ label: 'Anular envío', icon: <XCircle size={13} />, danger: true, disabled: busy, onSelect: () => void act(() => api.Sales.Void(Number(row.id)), 'Envío anulado') }]} />}
      </div>
    </div>
  </div></div>
}

function SaleItems({ document, catalog, lots }: { document: service.Sale; catalog: Catalog; lots: Record<number, Row> }) {
  return <div className="table-scroll"><table className="tbl docitems-table" aria-label={`Productos de ${document.kind === 'shipment' ? 'envío' : 'venta'} ${document.code}`}>
    <thead><tr><th>Producto</th><th>Detalle</th><th className="num">Cant.</th><th className="num">Precio unit.</th><th className="num">Subtotal</th></tr></thead>
    <tbody>{(document.items ?? []).map((item, index) => {
      const product = catalog.products.find((entry) => Number(entry.id) === Number(item.productId))
      const lot = lots[Number(item.lotId)]
      return <tr key={`${item.productId}-${item.lotId}-${index}`}>
        <td><EntityLink kind="product" id={item.productId}>{product?.name ?? `Producto ${item.productId}`}</EntityLink></td>
        <td>{lot ? <EntityLink kind="lot" id={item.lotId} chip>{lot.code}</EntityLink> : <span className="muted">-</span>}</td>
        <td className="num">{item.qty}</td>
        <td className="num"><Money cents={item.unitPriceCents} currency={document.currency as Currency} /></td>
        <td className="num"><Money cents={item.qty * item.unitPriceCents} currency={document.currency as Currency} /></td>
      </tr>
    })}</tbody>
  </table></div>
}

function ExtrasBlock({ extras, label }: { extras: service.Extra[]; label: string }) {
  if (!extras.length) return null
  return <div className="extras"><span className="extras__label">{label}</span><div className="extras__list">{extras.map((extra, index) => <span className="extras__item" key={extra.id ?? index}>{extra.concept} <Money cents={extra.amountCents} currency={extra.currency as Currency} /></span>)}</div></div>
}

function PaymentNotes({ payments }: { payments: service.Payment[] }) {
  const method = (value: string) => value === 'card' ? 'Tarjeta' : value === 'wallet' ? 'Billetera digital' : 'Efectivo'
  return <div className="sumnote">{payments.map((payment) => <span key={payment.id}>{fmtDateShort(payment.date)} · {formatMoney(payment.amountCents, payment.currency as Currency)} ({method(payment.method)})</span>)}</div>
}

function SummaryRow({ label, value, strong, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; tone?: 'ok' | 'warn' }) {
  return <div className={cx('sumrow', strong && 'sumrow--strong', tone && `sumrow--${tone}`)}><span>{label}</span><span className="sumrow__v">{value}</span></div>
}

function PurchaseDetail({ document, row, counterparty, catalog, lots, advances, totals, busy, act, onEdit }: {
  document: service.Purchase
  row: Row
  counterparty: string
  catalog: Catalog
  lots: Record<number, Row>
  advances: Row[]
  totals: service.DocumentTotals | null
  busy: boolean
  act: (action: () => Promise<unknown>, label: string) => Promise<void>
  onEdit: (record: service.Purchase | service.Sale, extrasOnly?: boolean) => void
}) {
  const displayCurrency = useStore((state) => state.currency)
  const card = catalog.cards.find((entry) => Number(entry.id) === Number(document.cardId))
  const received = Boolean(document.receivedAt)
  const purchaseLots = Object.values(lots).filter((lot) => !lot.voided_at && (document.items ?? []).some((item) => Number(item.id) === Number(lot.purchase_item_id)))
  const method = document.paymentMethod === 'card' ? 'Tarjeta' : document.paymentMethod === 'wallet' ? 'Billetera digital' : 'Efectivo'

  return <div className="rec__body"><div className="rec__bodyin">
    <div className="meta-grid">
      <div className="meta-grid__cell"><span className="meta-grid__k">Proveedor</span><span className="meta-grid__v"><EntityLink kind="supplier" id={document.supplierId}>{counterparty}</EntityLink></span></div>
      <div className="meta-grid__cell"><span className="meta-grid__k">Método de pago</span><span className="meta-grid__v">{method}</span></div>
      <div className="meta-grid__cell"><span className="meta-grid__k">Fecha</span><span className="meta-grid__v">{fmtDate(document.date)}</span></div>
      {received && <div className="meta-grid__cell"><span className="meta-grid__k">Recepción</span><span className="meta-grid__v">{fmtDate(document.receivedAt)}</span></div>}
    </div>
    <div className="table-scroll"><table className="tbl docitems-table" aria-label={`Productos de la compra ${document.code}`}>
      <thead><tr><th>Producto</th><th>Detalle</th><th className="num">Cant.</th><th className="num">Costo unit.</th><th className="num">Subtotal</th></tr></thead>
      <tbody>{(document.items ?? []).map((item, index) => {
        const product = catalog.products.find((entry) => Number(entry.id) === Number(item.productId))
        const itemLots = purchaseLots.filter((lot) => Number(lot.purchase_item_id) === Number(item.id))
        return <tr key={item.id || index}>
          <td><EntityLink kind="product" id={item.productId}>{product?.name ?? `Producto ${item.productId}`}</EntityLink></td>
          <td><div className="docitems-table__detail">{item.description && <span>{item.description}</span>}{itemLots.map((lot) => <EntityLink key={lot.id} kind="lot" id={lot.id} chip>{lot.code}</EntityLink>)}</div></td>
          <td className="num">{item.qty}</td>
          <td className="num"><Money cents={item.unitCostCents} currency={document.currency as Currency} /></td>
          <td className="num"><Money cents={item.qty * item.unitCostCents} currency={document.currency as Currency} /></td>
        </tr>
      })}</tbody>
    </table></div>
    {!!document.extras?.length && <div className="extras"><span className="extras__label">Costos extras</span><div className="extras__list">{document.extras.map((extra) => <span className="extras__item" key={extra.id}>{extra.concept} <Money cents={extra.amountCents} currency={extra.currency as Currency} /></span>)}</div></div>}
    <div className="sum-grid"><div>
      <div className="sumrow"><span>Base</span><Money cents={totals?.subtotalCents ?? 0} currency={displayCurrency} original={totals?.originalSubtotalCents} documentCurrency={document.currency as Currency} tc={document.tc} /></div>
      <div className="sumrow"><span>Costos extras</span><Money cents={totals?.extrasCents ?? 0} currency={displayCurrency} original={totals?.originalExtrasCents} documentCurrency={document.currency as Currency} tc={document.tc} /></div>
      <div className="sumrow sumrow--strong"><span>Total</span><Money cents={totals?.totalCents ?? row.totalCents ?? 0} currency={displayCurrency} original={totals?.originalTotalCents ?? row.originalTotalCents} documentCurrency={document.currency as Currency} tc={document.tc} /></div>
    </div><div>
      {document.forClientId && <div className="sumrow"><span>Encargo para</span><EntityLink kind="client" id={document.forClientId}>{catalog.clients.find((entry) => Number(entry.id) === Number(document.forClientId))?.name ?? 'Cliente'}</EntityLink></div>}
      {advances.map((advance) => <div className="sumrow" key={advance.id}><span>Adelanto · {advance.status === 'active' ? 'Vigente' : advance.status === 'applied' ? 'Aplicado' : advance.status === 'refunded' ? 'Devuelto' : 'Anulado'}</span><Money cents={advance.amount_cents} currency={advance.currency as Currency} /></div>)}
    </div></div>
    <div className="rec__foot">
      <div className="hstack hstack--wrap">{purchaseLots.length > 0 && <EntityLink kind="lot" id={purchaseLots[0].id} chip>{purchaseLots.length} lote{purchaseLots.length === 1 ? '' : 's'}</EntityLink>}{card && <EntityLink kind="card" id={card.id} chip>{card.name}</EntityLink>}{document.forClientId && <span className="tag">Para cliente</span>}</div>
      <div className="hstack">
        <button type="button" className="btn btn--xs" disabled={busy} onClick={() => onEdit(document, true)}>Editar extras</button>
        {row.status === 'pending' && <button type="button" className="btn btn--xs" disabled={busy} onClick={() => onEdit(document)}>Editar</button>}
        {row.status === 'pending' && <button type="button" className="btn btn--primary btn--xs" disabled={busy} onClick={() => void act(() => api.Purchases.ReceivePurchase(Number(row.id)), 'Compra recibida')}><CircleCheck size={13} /> Marcar recibida</button>}
        {document.forClientId && row.status === 'pending' && <AdvanceAction purchase={document} />}
        {row.status === 'reserved' && <SellReservedAction purchase={document} catalog={catalog} />}
        {row.status === 'reserved' && <button type="button" className="btn btn--xs" disabled={busy} onClick={() => window.confirm('¿Cancelar el encargo? Los lotes se liberarán y los adelantos activos pasarán a Devuelto.') && void act(() => api.Purchases.CancelOrder(Number(row.id)), 'Encargo cancelado')}>Cancelar encargo</button>}
        {row.status === 'voided'
          ? <RowMenu label="Más acciones" items={[{ label: 'Restaurar compra', icon: <Undo2 size={13} />, disabled: busy, onSelect: () => void act(() => api.Purchases.Restore(Number(row.id)), 'Compra restaurada') }]} />
          : <RowMenu label="Más acciones" items={[{ label: 'Anular compra', icon: <XCircle size={13} />, danger: true, disabled: busy, onSelect: () => void act(() => api.Purchases.Void(Number(row.id)), 'Compra anulada') }]} />}
      </div>
    </div>
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
