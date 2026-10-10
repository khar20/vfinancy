import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { service } from '../../wailsjs/go/models'
import { api } from '../data/api'
import type { Currency } from '../data/api'
import { useStore } from '../data/store'
import { parseError } from '../lib/errors'
import { todayISO } from '../lib/format'
import { centsText, textToCents, tcFromText, tcText } from '../lib/money'
import { Field, Modal, ModalActions, Money, MoneyInput, Seg, TcField, TextInput } from '../components/ui'
import { Autocomplete } from '../components/Autocomplete'

type Catalog = { clients: Array<Record<string, any>>; suppliers: Array<Record<string, any>>; products: Array<Record<string, any>>; cards: Array<Record<string, any>> }
type Line = { productId: string; lotId: string; qty: string; amount: string; description: string }
type ExtraLine = { concept: string; amount: string; currency: Currency }

const blankLine = (): Line => ({ productId: '', lotId: '', qty: '1', amount: '', description: '' })

export function DocumentFormModal({ kind, catalog, onClose, existing, extrasOnly = false }: { kind: 'purchase' | 'sale' | 'shipment'; catalog: Catalog; onClose: () => void; existing?: service.Purchase | service.Sale; extrasOnly?: boolean }) {
  const displayCurrency = useStore((state) => state.currency)
  const refresh = useStore((state) => state.refresh)
  const toast = useStore((state) => state.toast)
  const settings = useStore((state) => state.settings)
  const formId = useId()
  const record = existing as any
  const [code, setCode] = useState(record?.code ?? '')
  const [date, setDate] = useState(record?.date ?? todayISO())
  const [currency, setCurrency] = useState<Currency>((record?.currency ?? (kind === 'purchase' ? 'USD' : 'PEN')) as Currency)
  const [tc, setTc] = useState(record?.tc ? tcText(record.tc) : '3.7500')
  const [supplierId, setSupplierId] = useState(String(record?.supplierId ?? ''))
  const [clientId, setClientId] = useState(String(record?.clientId ?? ''))
  const [forClient, setForClient] = useState(record?.forClientId != null)
  const [method, setMethod] = useState(record?.paymentMethod ?? settings.last_payment_method ?? 'cash')
  const [cardId, setCardId] = useState(String(record?.cardId ?? ''))
  const [items, setItems] = useState<Line[]>(record?.items?.length ? record.items.map((item: any) => ({ productId: String(item.productId), lotId: String(item.lotId ?? ''), qty: String(item.qty), amount: centsText(item.unitCostCents ?? item.unitPriceCents), description: item.description ?? '' })) : [blankLine()])
  const [lotOptions, setLotOptions] = useState<Record<string, Array<Record<string, any>>>>({})
  const [extras, setExtras] = useState<ExtraLine[]>(record?.extras?.map((extra: any) => ({ concept: extra.concept, amount: centsText(extra.amountCents), currency: extra.currency as Currency })) ?? [])
  const [paidNow, setPaidNow] = useState('')
  const [region, setRegion] = useState(record?.shipRegion ?? '')
  const [address, setAddress] = useState(record?.shipAddress ?? '')
  const [addressId, setAddressId] = useState('')
  const [addingAddress, setAddingAddress] = useState(false)
  const [securityCode, setSecurityCode] = useState(record?.securityCode || String(Math.floor(Math.random() * 10000)).padStart(4, '0'))
  const [preview, setPreview] = useState<service.DocumentTotals | null>(null)
  const [busy, setBusy] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [quickKind, setQuickKind] = useState<'client' | 'supplier' | 'product' | 'card' | null>(null)
  const [quickName, setQuickName] = useState('')
  const [quickProductIndex, setQuickProductIndex] = useState(0)
  const [addresses, setAddresses] = useState<Array<Record<string, any>>>([])
  const tcScaled = tcFromText(tc) ?? 37500
  const editingPurchase = kind === 'purchase'
  const title = existing ? extrasOnly ? `Editar extras · ${record.code}` : `Editar · ${record.code}` : editingPurchase ? 'Nueva compra' : kind === 'shipment' ? 'Nuevo envío' : 'Nueva venta'

  useEffect(() => {
    if (!existing) {
      const next = editingPurchase ? api.Purchases.NextCode() : api.Sales.NextCode(kind)
      void next.then(setCode).catch((error) => toast(parseError(error).message ?? 'No se pudo generar el código', 'bad'))
      void api.Settings.DefaultTC().then((rate) => setTc(tcText(rate)))
    }
  }, [kind, existing])

  useEffect(() => { if (clientId && kind === 'shipment') void api.Catalog.ListAddresses(Number(clientId)).then((rows) => setAddresses(rows as Array<Record<string, any>>)).catch(() => setAddresses([])); else setAddresses([]) }, [clientId, kind])

  useEffect(() => {
    const ids = [...new Set(items.map((line) => line.productId).filter(Boolean))]
    for (const productId of ids) {
      if (lotOptions[productId]) continue
      void api.Inventory.LotsForProduct(Number(productId)).then((rows) => setLotOptions((old) => ({ ...old, [productId]: rows as Array<Record<string, any>> }))).catch(() => {})
    }
  }, [items.map((item) => item.productId).join(','), kind])

  const updateLine = (index: number, patch: Partial<Line>) => setItems((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line))
  const setDefaultPrice = (index: number, productId: string) => {
    const product = catalog.products.find((candidate) => String(candidate.id) === productId)
    if (!product) return updateLine(index, { productId, lotId: '', amount: '' })
    const sourceCurrency = editingPurchase ? product.default_cost_currency : product.default_price_currency
    const value = editingPurchase
      ? (product.original_default_cost_cents ?? product.default_cost_cents)
      : (product.original_default_price_cents ?? product.default_price_cents)
    if (sourceCurrency !== currency) return updateLine(index, { productId, lotId: '', amount: '' })
    return updateLine(index, { productId, lotId: '', amount: value == null ? '' : `${Math.floor(Number(value) / 100)}.${String(Number(value) % 100).padStart(2, '0')}` })
  }

  useEffect(() => {
    if (extrasOnly) return
    const timer = window.setTimeout(async () => {
      try {
        const lineItems = items.filter((line) => line.productId && Number(line.qty) > 0).map((line) => editingPurchase
          ? new service.PurchaseItem({ productId: Number(line.productId), qty: Number(line.qty), description: line.description, unitCostCents: textToCents(line.amount) ?? 0 })
          : new service.SaleItem({ productId: Number(line.productId), lotId: Number(line.lotId) || 0, qty: Number(line.qty), description: line.description, unitPriceCents: textToCents(line.amount) ?? 0 }))
        const extraItems = extras.filter((extra) => extra.concept.trim()).map((extra) => new service.Extra({ concept: extra.concept, amountCents: textToCents(extra.amount) ?? 0, currency: extra.currency }))
        const body = editingPurchase
          ? new service.Purchase({ currency, tc: tcScaled, items: lineItems as service.PurchaseItem[], extras: extraItems })
          : new service.Sale({ kind, currency, tc: tcScaled, items: lineItems as service.SaleItem[], extras: extraItems })
        const total = editingPurchase ? await api.Purchases.PreviewTotal(body as service.Purchase, displayCurrency) : await api.Sales.PreviewTotal(body as service.Sale, displayCurrency)
        setPreview(total)
      } catch { setPreview(null) }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [items, extras, currency, tcScaled, displayCurrency, kind, extrasOnly])

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setFieldErrors({})
    try {
      const rate = tcFromText(tc)
      if (!rate) throw new Error('TC debe estar entre 0.5000 y 20.0000')
      const extraItems = extras.filter((extra) => extra.concept.trim() && textToCents(extra.amount) !== null).map((extra) => new service.Extra({ concept: extra.concept.trim(), amountCents: textToCents(extra.amount) ?? 0, currency: extra.currency }))
      if (editingPurchase) {
        const purchaseItems = items.filter((line) => line.productId).map((line) => new service.PurchaseItem({ productId: Number(line.productId), description: line.description, qty: Number(line.qty), unitCostCents: textToCents(line.amount) ?? 0 }))
        await api.Purchases.Save(new service.Purchase({ id: Number(existing?.id ?? 0), code, supplierId: Number(supplierId), date, paymentMethod: method, cardId: method === 'card' ? Number(cardId) : undefined, currency, tc: rate, forClientId: forClient && clientId ? Number(clientId) : undefined, items: purchaseItems, extras: extraItems }))
      } else {
        const saleItems: service.SaleItem[] = []
        for (const line of items.filter((item) => item.productId)) {
          const qty = Number(line.qty)
          if (line.lotId) {
            const choices = (lotOptions[line.productId] ?? []).filter((lot) => Number(lot.available) > 0 && (lot.reserved_client_id == null || Number(lot.reserved_client_id) === Number(clientId)))
            const selectedIndex = choices.findIndex((lot) => Number(lot.id) === Number(line.lotId))
            if (selectedIndex < 0) throw new Error(`Lote ${line.lotId} no tiene stock disponible para este cliente`)
            let remaining = qty
            for (const lot of choices.slice(selectedIndex)) {
              if (remaining <= 0) break
              const take = Math.min(remaining, Number(lot.available))
              saleItems.push(new service.SaleItem({ productId: Number(line.productId), lotId: Number(lot.id), qty: take, description: line.description, unitPriceCents: textToCents(line.amount) ?? 0 }))
              remaining -= take
            }
            if (remaining > 0) throw new Error(`Stock insuficiente: faltan ${remaining} unidades`)
          } else {
            const suggested = await api.Inventory.SuggestLots(Number(line.productId), qty)
            for (const lot of suggested) saleItems.push(new service.SaleItem({ productId: Number(line.productId), lotId: lot.lotId, qty: lot.suggestedQty, description: line.description, unitPriceCents: textToCents(line.amount) ?? 0 }))
          }
        }
        await api.Sales.Save(new service.Sale({ id: Number(existing?.id ?? 0), code, kind, clientId: clientId ? Number(clientId) : undefined, date, currency, tc: rate, items: saleItems, extras: extraItems, paidNowCents: existing ? 0 : textToCents(paidNow) ?? 0, paymentMethod: method, shipRegion: region || record?.shipRegion, shipAddress: address || record?.shipAddress, securityCode }))
      }
      refresh(); toast(`${code} registrado`); onClose()
    } catch (error) {
      const parsed = parseError(error); setFieldErrors(parsed.fields); toast(parsed.message ?? Object.values(parsed.fields)[0] ?? 'No se pudo guardar el documento', 'bad')
    } finally { setBusy(false) }
  }

  return <Modal title={title} onClose={onClose} wide><form id={formId} className="stack" onSubmit={submit}>
    {extrasOnly && <div className="formwarn">Esta compra ya fue recibida: editar sus extras afecta el costo proporcional de las ventas.</div>}
    {!extrasOnly && <>
    <div className="formgrid formgrid--3"><Field label="Código" required error={fieldErrors.code}><TextInput className="input--mono" value={code} onChange={(event) => setCode(event.target.value)} /></Field><Field label="Fecha" required><TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label={editingPurchase ? 'Proveedor' : 'Cliente'} required={editingPurchase} error={fieldErrors.supplierId ?? fieldErrors.clientId}><Autocomplete options={(editingPurchase ? catalog.suppliers : catalog.clients).map((row) => ({ value: String(row.id), label: row.name, sub: row.phone || undefined }))} value={editingPurchase ? supplierId : clientId} onChange={(value) => editingPurchase ? setSupplierId(value) : setClientId(value)} placeholder={editingPurchase ? 'Proveedor…' : 'Cliente general'} onCreate={(name) => { setQuickName(name); setQuickKind(editingPurchase ? 'supplier' : 'client') }} /></Field></div>
    {editingPurchase && <div className="formgrid"><Field label="Método de pago"><Seg options={[{ value: 'card', label: 'Tarjeta' }, { value: 'cash', label: 'Efectivo' }, { value: 'wallet', label: 'Billetera digital' }]} value={method} onChange={(value) => { setMethod(value); void api.Settings.SetSetting('last_payment_method', value).then(() => useStore.setState((current) => ({ settings: { ...current.settings, last_payment_method: value } }))) }} /></Field>{method === 'card' && <Field label="Tarjeta" required><Autocomplete options={catalog.cards.map((row) => ({ value: String(row.id), label: `${row.name} · ••${row.last4}` }))} value={cardId} onChange={setCardId} placeholder="Tarjeta…" onCreate={(name) => { setQuickName(name); setQuickKind('card') }} /></Field>}</div>}
    {editingPurchase && <fieldset className="formsection"><legend className="formsection__title">Encargo</legend><label className="checkline"><input type="checkbox" checked={forClient} onChange={(event) => setForClient(event.target.checked)} /> Para cliente: reservar los lotes al recibir</label>{forClient && <Field label="Cliente" required error={fieldErrors.forClientId}><Autocomplete options={catalog.clients.map((row) => ({ value: String(row.id), label: row.name, sub: row.phone || undefined }))} value={clientId} onChange={setClientId} placeholder="Cliente…" onCreate={() => setQuickKind('client')} /></Field>}</fieldset>}
    <div className="formgrid"><Field label="Moneda"><Seg options={[{ value: 'PEN', label: 'S/' }, { value: 'USD', label: '$' }]} value={currency} onChange={setCurrency} /></Field><Field label="TC (S/ por $)" required><TcField value={tc} onChange={setTc} /></Field></div>
    <fieldset className="formsection"><legend className="formsection__title">Ítems</legend><div className="formsection__body stack">{items.map((line, index) => { const availableLots = (lotOptions[line.productId] ?? []).filter((lot) => Number(lot.available) > 0 && (lot.reserved_client_id == null || Number(lot.reserved_client_id) === Number(clientId))); const selectedLotId = line.lotId || String(availableLots[0]?.id ?? ''); const selectedLot = availableLots.find((lot) => String(lot.id) === selectedLotId); return <div className="lineditor__row lineditor__row--item" key={index}><Field label="Producto" required><Autocomplete options={catalog.products.map((product) => ({ value: String(product.id), label: product.name, sub: product.sku }))} value={line.productId} onChange={(value) => setDefaultPrice(index, value)} placeholder="Producto…" onCreate={(name) => { setQuickName(name); setQuickProductIndex(index); setQuickKind('product') }} /></Field>{!editingPurchase && <Field label="Lote · disponible" required><select className="select" value={selectedLotId} disabled={!availableLots.length} onChange={(event) => updateLine(index, { lotId: event.target.value })}><option value="">{availableLots.length ? 'Elegir lote' : 'Sin stock disponible'}</option>{availableLots.map((lot) => <option key={lot.id} value={lot.id}>{lot.code} · {lot.available} uds</option>)}</select>{selectedLot && Number(line.qty) > Number(selectedLot.available) && <small className="muted">Se dividirá en los siguientes lotes FIFO.</small>}</Field>}<Field label="Descripción"><TextInput value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} /></Field><Field label="Cantidad" required><TextInput className="input--quantity" type="number" min="1" step="1" value={line.qty} onChange={(event) => updateLine(index, { qty: event.target.value })} /></Field><Field label={editingPurchase ? 'Costo unitario' : 'Precio unitario'} required><MoneyInput currency={currency} value={line.amount} onChange={(amount) => updateLine(index, { amount })} /></Field><button className="iconbtn lineditor__remove" type="button" aria-label="Quitar ítem" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div>})}<button className="btn btn--xs" type="button" onClick={() => setItems((current) => [...current, blankLine()])}><Plus size={13} /> Añadir ítem</button>{fieldErrors.items && <small className="field__error">{fieldErrors.items}</small>}</div></fieldset>
    <fieldset className="formsection"><legend className="formsection__title">{editingPurchase ? 'Costos extras' : 'Extras'}</legend><div className="formsection__body stack">{extras.map((extra, index) => <div className="lineditor__row lineditor__row--extra" key={index}><Field label="Concepto" required><ConceptInput value={extra.concept} onChange={(concept) => setExtras((current) => current.map((item, i) => i === index ? { ...item, concept } : item))} /></Field><Field label="Monto" required><MoneyInput currency={extra.currency} value={extra.amount} onChange={(amount) => setExtras((current) => current.map((item, i) => i === index ? { ...item, amount } : item))} /></Field>{editingPurchase && <Field label="Moneda"><Seg options={[{ value: 'PEN', label: 'S/' }, { value: 'USD', label: '$' }]} value={extra.currency} onChange={(value) => setExtras((current) => current.map((item, i) => i === index ? { ...item, currency: value } : item))} /></Field>}<button className="iconbtn lineditor__remove" type="button" aria-label="Quitar extra" onClick={() => setExtras((current) => current.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div>)}<button className="btn btn--xs" type="button" onClick={() => setExtras((current) => [...current, { concept: '', amount: '', currency }])}><Plus size={13} /> Añadir extra</button></div></fieldset>
    {kind === 'shipment' && <div className="formgrid formgrid--3"><Field label="Dirección de envío" required error={fieldErrors.shipAddress}><Autocomplete options={addresses.map((item) => ({ value: String(item.id), label: `${item.region} · ${item.address}` }))} value={addressId} onChange={(value) => { setAddressId(value); const match = addresses.find((item) => String(item.id) === value); if (match) { setRegion(match.region); setAddress(match.address) } }} placeholder="Busca una dirección" onCreate={() => { if (!clientId) { toast('Elige primero al cliente', 'warn'); return }; setAddingAddress(true) }} /></Field><Field label="Región" required error={fieldErrors.shipRegion}><TextInput value={region} onChange={(event) => setRegion(event.target.value)} /></Field><Field label="Código de seguridad" required><TextInput className="input--mono" inputMode="numeric" maxLength={4} value={securityCode} onChange={(event) => setSecurityCode(event.target.value.replace(/\D/g, '').slice(0, 4))} /></Field></div>}
    {!editingPurchase && <div className="formgrid"><Field label="Pagado ahora"><MoneyInput currency={currency} value={paidNow} onChange={setPaidNow} /></Field><Field label="Método de pago"><Seg options={[{ value: 'cash', label: 'Efectivo' }, { value: 'card', label: 'Tarjeta' }, { value: 'wallet', label: 'Billetera digital' }]} value={method} onChange={(value) => { setMethod(value); void api.Settings.SetSetting('last_payment_method', value).then(() => useStore.setState((current) => ({ settings: { ...current.settings, last_payment_method: value } }))) }} /></Field></div>}
    <div className="formtotals" aria-live="polite">{preview ? <><div className="sumrow"><span>Base</span><Money cents={preview.subtotalCents} currency={displayCurrency} /></div><div className="sumrow"><span>Extras</span><Money cents={preview.extrasCents} currency={displayCurrency} /></div><div className="sumrow sumrow--strong"><span>Total · moneda del switch</span><Money cents={preview.totalCents} currency={displayCurrency} /></div></> : <span className="muted">Ingresa los ítems para calcular el total.</span>}</div>
    </>}
    {extrasOnly && <fieldset className="formsection"><legend className="formsection__title">Costos extras</legend><div className="formsection__body stack">{extras.map((extra, index) => <div className="lineditor__row lineditor__row--extra" key={index}><Field label="Concepto" required><ConceptInput value={extra.concept} onChange={(concept) => setExtras((current) => current.map((item, i) => i === index ? { ...item, concept } : item))} /></Field><Field label="Monto" required><MoneyInput currency={extra.currency} value={extra.amount} onChange={(amount) => setExtras((current) => current.map((item, i) => i === index ? { ...item, amount } : item))} /></Field><Field label="Moneda"><Seg options={[{ value: 'PEN', label: 'S/' }, { value: 'USD', label: '$' }]} value={extra.currency} onChange={(value) => setExtras((current) => current.map((item, i) => i === index ? { ...item, currency: value } : item))} /></Field><button className="iconbtn lineditor__remove" type="button" aria-label="Quitar extra" onClick={() => setExtras((current) => current.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div>)}<button className="btn btn--xs" type="button" onClick={() => setExtras((current) => [...current, { concept: '', amount: '', currency }])}><Plus size={13} /> Añadir extra</button></div></fieldset>}
    {fieldErrors.tc && <small className="field__error">{fieldErrors.tc}</small>}
    <div className="hstack hstack--end"><ModalActions onClose={onClose} busy={busy} label={existing ? extrasOnly ? 'Guardar extras' : 'Guardar cambios' : editingPurchase ? 'Registrar compra' : kind === 'shipment' ? 'Registrar envío' : 'Registrar venta'} /></div>
  </form>{quickKind && <QuickEntityModal kind={quickKind} presetName={quickName} onClose={() => setQuickKind(null)} onSaved={(id) => { if (quickKind === 'client') { setClientId(String(id)); setAddressId(''); setAddresses([]) }; if (quickKind === 'supplier') setSupplierId(String(id)); if (quickKind === 'card') setCardId(String(id)); if (quickKind === 'product') setItems((current) => current.map((line, index) => index === quickProductIndex ? { ...line, productId: String(id) } : line)); setQuickKind(null); setQuickName('') }} />}{addingAddress && <QuickAddressModal clientId={Number(clientId)} onClose={() => setAddingAddress(false)} onSaved={(saved) => { setAddresses((old) => [...old, saved]); setAddressId(String(saved.id)); setRegion(saved.region); setAddress(saved.address); setAddingAddress(false) }} />}</Modal>
}

function QuickEntityModal({ kind, presetName, onClose, onSaved }: { kind: 'client' | 'supplier' | 'product' | 'card'; presetName: string; onClose: () => void; onSaved: (id: number) => void }) {
  const [name, setName] = useState(presetName)
  const [busy, setBusy] = useState(false)
  const toast = useStore((state) => state.toast)
  const title = kind === 'client' ? 'Nuevo cliente' : kind === 'supplier' ? 'Nuevo proveedor' : kind === 'product' ? 'Nuevo producto' : 'Nueva tarjeta'
  return <Modal title={title} onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const result = kind === 'client' ? await api.Catalog.QuickCreateClient(name) : kind === 'supplier' ? await api.Catalog.QuickCreateSupplier(name) : kind === 'product' ? await api.Catalog.QuickCreateProduct(name) : await api.Catalog.QuickCreateCard(name); useStore.getState().refresh(); onSaved(Number(result.id)) } catch (error) { toast(parseError(error).message ?? 'No se pudo crear la entidad', 'bad') } finally { setBusy(false) } }}><Field label="Nombre" required><TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Field><div className="hstack"><ModalActions onClose={onClose} busy={busy} label="Guardar" /></div></form></Modal>
}

function ConceptInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId()
  const [suggestions, setSuggestions] = useState<string[]>([])
  useEffect(() => {
    const timer = window.setTimeout(() => { void api.Catalog.Suggest('concept', value).then((rows) => setSuggestions(rows.map((row) => String(row.label ?? '')))).catch(() => setSuggestions([])) }, 180)
    return () => window.clearTimeout(timer)
  }, [value])
  return <><TextInput list={id} value={value} onChange={(event) => onChange(event.target.value)} /><datalist id={id}>{suggestions.map((suggestion) => <option value={suggestion} key={suggestion} />)}</datalist></>
}

function QuickAddressModal({ clientId, onClose, onSaved }: { clientId: number; onClose: () => void; onSaved: (address: { id: number; region: string; address: string }) => void }) {
  const [region, setRegion] = useState(''); const [address, setAddress] = useState(''); const [busy, setBusy] = useState(false); const toast = useStore((state) => state.toast)
  return <Modal title="Nueva dirección de envío" onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const saved = await api.Catalog.QuickCreateAddress(clientId, region, address); useStore.getState().refresh(); onSaved(saved) } catch (error) { toast(parseError(error).message ?? 'No se pudo guardar la dirección', 'bad') } finally { setBusy(false) } }}><Field label="Región" required><TextInput value={region} onChange={(event) => setRegion(event.target.value)} /></Field><Field label="Dirección" required><TextInput value={address} onChange={(event) => setAddress(event.target.value)} /></Field><div className="hstack"><ModalActions onClose={onClose} busy={busy} label="Guardar dirección" /></div></form></Modal>
}
