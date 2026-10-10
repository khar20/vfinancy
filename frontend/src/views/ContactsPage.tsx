import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Phone, Plus, Undo2, UserX } from 'lucide-react'
import { service } from '../../wailsjs/go/models'
import { api, query } from '../data/api'
import type { Currency, Page, Query } from '../data/api'
import { useStore } from '../data/store'
import { statusView } from '../data/status'
import { parseError } from '../lib/errors'
import { fmtDateShort, monthLabel } from '../lib/format'
import { Badge, Empty, Field, Loading, Modal, ModalActions, Money, TextInput, ViewHead } from '../components/ui'
import { FilterBar, useServerFilters } from '../components/filters'
import { MonthJournal } from '../components/journal'

type Row = Record<string, any>
type Kind = 'client' | 'supplier'

async function fetchAll(fetchPage: (query: Query) => Promise<Page>, currency: Currency, filters: service.Filter[] = []) {
  const out: Row[] = []
  let cursor = ''
  for (let i = 0; i < 120; i++) {
    const page = await fetchPage(query(currency, filters, cursor, 120))
    for (const month of page.months ?? []) out.push(...month.rows as Row[])
    if (!page.nextCursor || page.nextCursor === cursor) break
    cursor = page.nextCursor
  }
  return out
}

export function ContactsPage({ kind }: { kind: Kind }) {
  const currency = useStore((state) => state.currency)
  const revision = useStore((state) => state.revision)
  const toast = useStore((state) => state.toast)
  const navigate = useNavigate()
  const params = useParams()
  const id = Number(params['*']?.split('/')[0] ?? 0)
  const entity = kind === 'client' ? 'clients' : 'suppliers'
  const filters = useServerFilters(entity)
  const [page, setPage] = useState<Page | null>(null)
  const [cursor, setCursor] = useState('')
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<Row[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [history, setHistory] = useState<Row[]>([])
  const [addresses, setAddresses] = useState<Row[]>([])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [addressModal, setAddressModal] = useState(false)
  const [addressToEdit, setAddressToEdit] = useState<Row | undefined>()
  const [moreLoading, setMoreLoading] = useState(false)
  const filterKey = JSON.stringify(filters.filters.map((f) => [f.field, f.op, f.value, f.end]))
  const list = kind === 'client' ? api.Catalog.ListClients : api.Catalog.ListSuppliers

  useEffect(() => {
    let active = true
    setLoading(true); setCursor('')
    list(query(currency, filters.filters, '', 6)).then((result) => { if (active) { setPage(result); setCursor(result.nextCursor ?? ''); setLoading(false) } }).catch((error) => { if (active) { setPage({ months: [] } as unknown as Page); setLoading(false); toast(parseError(error).message ?? 'No se pudo cargar la lista', 'bad') } })
    return () => { active = false }
  }, [kind, currency, filterKey, revision])

  useEffect(() => {
    useStore.getState().registerNew(() => setCreating(true))
    return () => useStore.getState().registerNew(null)
  }, [])

  useEffect(() => {
    if (!id) { setRecords([]); setHistory([]); setAddresses([]); setDetailLoading(false); return }
    let active = true
    const loadEntity = kind === 'client' ? api.Catalog.ListClients : api.Catalog.ListSuppliers
    setDetailLoading(true)
    const resolve = async () => {
      const all = await fetchAll(loadEntity, currency)
      if (active) setRecords(all)
      if (kind === 'client') {
        const savedAddresses = await api.Catalog.ListAddresses(id)
        if (active) setAddresses(savedAddresses as Row[])
      }
      const selected = all.find((row) => Number(row.id) === id)
      if (!selected) return []
      const field = kind === 'client' ? 'client' : 'supplier'
      const q = [new service.Filter({ field, op: 'contains', value: selected.name })]
      const purchaseRows = await fetchAll(api.Purchases.List, currency, kind === 'supplier' ? q : [new service.Filter({ field: 'client', op: 'contains', value: selected.name })])
      if (kind === 'supplier') return purchaseRows.map((row) => ({ ...row, historyKind: 'purchase' }))
      const sales = await fetchAll(api.Sales.List, currency, q)
      return [...purchaseRows.filter((row) => Number(row.for_client_id) === id).map((row) => ({ ...row, historyKind: 'purchase' })), ...sales.filter((row) => Number(row.client_id) === id).map((row) => ({ ...row, historyKind: row.kind }))]
    }
    void resolve().then((rows) => { if (active) { setHistory(rows); setDetailLoading(false) } }).catch(() => { if (active) setDetailLoading(false) })
    return () => { active = false }
  }, [id, kind, currency, revision])

  const loadMore = async () => {
    if (!cursor || moreLoading) return
    setMoreLoading(true)
    try { const next = await list(query(currency, filters.filters, cursor, 6)); setPage((old) => ({ months: [...(old?.months ?? []), ...(next.months ?? [])], nextCursor: next.nextCursor } as unknown as Page)); setCursor(next.nextCursor ?? '') }
    catch (error) { toast(parseError(error).message ?? 'No se pudieron cargar más meses', 'bad') }
    finally { setMoreLoading(false) }
  }

  const record = records.find((row) => Number(row.id) === id) ?? (page?.months.flatMap((month) => month.rows as Row[]).find((row) => Number(row.id) === id))
  const title = kind === 'client' ? 'Clientes' : 'Proveedores'
  if (id && (detailLoading || loading)) return <Loading />
  if (id && !record) return <Empty>{kind === 'client' ? 'Cliente' : 'Proveedor'} no encontrado</Empty>
  if (id && record) return <><ViewHead title={record.name} subtitle={[record.phone || 'sin teléfono', record.note].filter(Boolean).join(' · ')} actions={<div className="hstack"><button type="button" className="iconbtn" aria-label={`Volver a ${title.toLowerCase()}`} onClick={() => navigate(`/${entity}`)}><ArrowLeft size={16} /></button><button type="button" className="btn btn--sm" onClick={() => setEditing(true)}><Pencil size={13} /> Editar</button>{record.status === 'voided' ? <button type="button" className="btn btn--sm" onClick={() => void setVoid(false)}><Undo2 size={13} /> Restaurar</button> : <button type="button" className="btn btn--sm" onClick={() => void setVoid(true)}><UserX size={13} /> Anular</button>}</div>} />{kind === 'client' && <><div className="kpis"><div className="kpi"><span className="kpi__label">Saldo por cobrar</span><span className="kpi__value"><Money cents={record.balanceCents ?? 0} /></span></div><div className="kpi"><span className="kpi__label">Estado</span><span className="kpi__value"><Badge state={statusView('clients', record.status)}>{record.status === 'balance' ? 'Con saldo' : 'Sin saldo'}</Badge></span></div></div><h3 className="sectitle">Direcciones de envío</h3><div className="addrlist">{addresses.map((address) => <div className="listrow" key={address.id}><span className="listrow__main"><b>{address.region}</b>{address.address}</span><button className="btn btn--xs" type="button" onClick={() => { setAddressToEdit(address); setAddressModal(true) }}>Editar</button></div>)}{!addresses.length && <span className="muted">Sin direcciones guardadas</span>}<button className="btn btn--xs" type="button" onClick={() => { setAddressToEdit(undefined); setAddressModal(true) }}><Plus size={13} /> Agregar dirección</button></div></>}<h3 className="sectitle">{kind === 'client' ? 'Historial por mes' : 'Compras por mes'}</h3><HistoryJournal rows={history} />{editing && <ContactModal kind={kind} row={record} onClose={() => setEditing(false)} />}{addressModal && kind === 'client' && <AddressModal clientId={id} address={addressToEdit} onClose={() => setAddressModal(false)} />}</>

  async function setVoid(voided: boolean) {
    try {
      if (kind === 'client') await (voided ? api.Catalog.VoidClient(id) : api.Catalog.RestoreClient(id))
      else await (voided ? api.Catalog.VoidSupplier(id) : api.Catalog.RestoreSupplier(id))
      useStore.getState().refresh(); toast(voided ? 'Registro anulado' : 'Registro restaurado')
    } catch (error) { toast(parseError(error).message ?? 'No se pudo actualizar el registro', 'bad') }
  }

  return <><ViewHead title={title} subtitle="Contactos con ficha e historial mensual" actions={<button className="btn btn--primary btn--sm" type="button" onClick={() => setCreating(true)}><Plus size={14} /> Nuevo {kind === 'client' ? 'cliente' : 'proveedor'}</button>} /><FilterBar state={filters} /><MonthJournal page={page} loading={loading} onMore={() => void loadMore()} emptyText={`Sin ${title.toLowerCase()}`} renderRow={(row) => <button className={`listrow listrow--click ${kind === 'client' && row.status === 'voided' ? 'tint--gray' : ''}`} type="button" onClick={() => navigate(`/${entity}/${row.id}`)}><span className="listrow__main"><b>{row.name}</b><span className="listrow__meta"><Phone size={11} /> {row.phone || 'sin teléfono'}</span></span>{kind === 'client' && <Money cents={row.balanceCents ?? 0} />}{kind === 'client' && <Badge state={statusView('clients', row.status)} />}</button>} />{creating && <ContactModal kind={kind} onClose={() => setCreating(false)} />}</>
}

function HistoryJournal({ rows }: { rows: Row[] }) {
  const groups = new Map<string, Row[]>()
  for (const row of rows) { const month = String(row.date).slice(0, 7); groups.set(month, [...(groups.get(month) ?? []), row]) }
  if (!groups.size) return <Empty>No hay historial registrado</Empty>
  return <div className="journal">{[...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, monthRows]) => <section className="jmonth" key={month}><header className="jmonth__head"><h2>{monthLabel(month)}</h2><span className="jmonth__stats">{monthRows.length} registros · total <Money cents={monthRows.reduce((sum, row) => sum + Number(row.totalCents ?? 0), 0)} /></span></header>{monthRows.map((row) => { const entity = row.historyKind === 'purchase' ? 'purchases' : 'sales'; const status = statusView(entity, row.status); const route = row.historyKind === 'purchase' ? 'compras' : row.kind === 'shipment' ? 'envios' : 'ventas'; return <button type="button" className={`listrow listrow--click ${status ? `tint--${status.tone}` : ''}`} key={`${row.historyKind}-${row.id}`} onClick={() => { window.location.hash = `#/${route}?abrir=${encodeURIComponent(row.code)}` }}><span className="listrow__main"><b>{row.code} · {row.historyKind === 'purchase' ? 'Compra (encargo)' : row.kind === 'shipment' ? 'Envío' : 'Venta'}</b><span className="listrow__meta">{fmtDateShort(row.date)}</span></span><Money cents={row.totalCents ?? 0} /><Badge state={status} /></button>})}</section>)}</div>
}

function ContactModal({ kind, row, onClose }: { kind: Kind; row?: Row; onClose: () => void }) {
  const [name, setName] = useState(row?.name ?? ''); const [phone, setPhone] = useState(row?.phone ?? ''); const [note, setNote] = useState(row?.note ?? ''); const [busy, setBusy] = useState(false); const toast = useStore((state) => state.toast)
  return <Modal title={`${row ? 'Editar' : 'Nuevo'} ${kind === 'client' ? 'cliente' : 'proveedor'}`} onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { if (kind === 'client') await api.Catalog.SaveClient(new service.Client({ id: Number(row?.id ?? 0), name, phone, note })); else await api.Catalog.SaveSupplier(new service.Supplier({ id: Number(row?.id ?? 0), name, phone, note })); useStore.getState().refresh(); toast('Contacto guardado'); onClose() } catch (error) { toast(parseError(error).message ?? 'No se pudo guardar el contacto', 'bad') } finally { setBusy(false) } }}><Field label="Nombre" required><TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Teléfono"><TextInput type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></Field><Field label="Nota"><textarea className="input" rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></Field><div className="hstack"><ModalActions onClose={onClose} busy={busy} label="Guardar" /></div></form></Modal>
}

function AddressModal({ clientId, address, onClose }: { clientId: number; address?: Row; onClose: () => void }) {
  const [region, setRegion] = useState(address?.region ?? ''); const [street, setStreet] = useState(address?.address ?? ''); const [busy, setBusy] = useState(false); const toast = useStore((state) => state.toast)
  return <Modal title={address ? 'Editar dirección' : 'Nueva dirección'} onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await api.Catalog.SaveAddress(new service.Address({ id: Number(address?.id ?? 0), clientId, region, address: street })); useStore.getState().refresh(); toast('Dirección guardada'); onClose() } catch (error) { toast(parseError(error).message ?? 'No se pudo guardar la dirección', 'bad') } finally { setBusy(false) } }}><Field label="Región" required><TextInput value={region} onChange={(event) => setRegion(event.target.value)} /></Field><Field label="Dirección" required><TextInput value={street} onChange={(event) => setStreet(event.target.value)} /></Field><div className="hstack"><ModalActions onClose={onClose} busy={busy} label="Guardar dirección" /></div></form></Modal>
}
