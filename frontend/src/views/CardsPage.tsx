import { useEffect, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { service } from '../../wailsjs/go/models'
import { api, query } from '../data/api'
import type { Currency, Page } from '../data/api'
import { useStore } from '../data/store'
import { statusView } from '../data/status'
import { parseError } from '../lib/errors'
import { fmtDate, fmtMoney, monthLabel, todayISO } from '../lib/format'
import { centsText, tcFromText, textToCents, tcText } from '../lib/money'
import { Badge, Empty, Field, Loading, Modal, ModalActions, Money, MoneyInput, Seg, TcField, TextInput, ViewHead } from '../components/ui'
import { FilterBar, useServerFilters } from '../components/filters'
import { EntityLink } from '../components/entity'

type Row = Record<string, any>

export function CardsPage() {
  const currency = useStore((state) => state.currency)
  const revision = useStore((state) => state.revision)
  const toast = useStore((state) => state.toast)
  const filters = useServerFilters('cycles')
  const [searchParams, setSearchParams] = useSearchParams()
  const filterKey = JSON.stringify(filters.filters.map((filter) => [filter.field, filter.op, filter.value, filter.end]))
  const [cards, setCards] = useState<Row[]>([])
  const [cycles, setCycles] = useState<Page | null>(null)
  const [expenses, setExpenses] = useState<Page | null>(null)
  const [cycleCursor, setCycleCursor] = useState('')
  const [expenseCursor, setExpenseCursor] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [addingCard, setAddingCard] = useState(false)
  const [editingCard, setEditingCard] = useState<Row | null>(null)
  const [expenseCard, setExpenseCard] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([api.Cards.Summaries(currency), api.Cards.ListCycles(query(currency, filters.filters)), api.Cards.ListExpenses(query(currency)), api.Catalog.ListCards(query(currency, [], '', 120))])
      .then(([summaries, cyclePage, expensePage, catalogPage]) => { if (active) { const records = catalogPage.months.flatMap((month) => month.rows as Row[]); setCards((summaries as Row[]).map((card) => ({ ...card, cutDay: records.find((row) => Number(row.id) === Number(card.id))?.cut_day, dueDay: records.find((row) => Number(row.id) === Number(card.id))?.due_day }))); setCycles(cyclePage); setExpenses(expensePage); setCycleCursor(cyclePage.nextCursor ?? ''); setExpenseCursor(expensePage.nextCursor ?? ''); setLoading(false) } })
      .catch((error) => { if (active) { toast(parseError(error).message ?? 'No se pudieron cargar las tarjetas', 'bad'); setLoading(false) } })
    return () => { active = false }
  }, [currency, revision, filterKey])
  useEffect(() => { useStore.getState().registerNew(() => setAddingCard(true)); return () => useStore.getState().registerNew(null) }, [])
  useEffect(() => { const id = Number(searchParams.get('cardId')); if (id > 0 && cards.some((card) => Number(card.id) === id)) setSelected(id) }, [cards, searchParams])
  const totalDebt = cards.reduce((sum, card) => sum + Number(card.debtCents ?? 0), 0)
  const cycleRows = cycles?.months.flatMap((month) => month.rows as Row[]).filter((row) => selected == null || Number(row.cardId) === selected) ?? []
  const expenseRows = expenses?.months.flatMap((month) => month.rows as Row[]).filter((row) => selected != null && Number(row.card_id) === selected) ?? []
  const selectCard = (id: number) => {
    const next = new URLSearchParams(searchParams)
    if (selected === id) { next.delete('cardId'); next.delete('cycleEnd'); setSelected(null) }
    else { next.set('cardId', String(id)); setSelected(id) }
    setSearchParams(next, { replace: true })
  }
  const loadOlder = async (entity: 'cycles' | 'expenses') => {
    const cursor = entity === 'cycles' ? cycleCursor : expenseCursor
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const next = entity === 'cycles' ? await api.Cards.ListCycles(query(currency, filters.filters, cursor, 6)) : await api.Cards.ListExpenses(query(currency, [], cursor, 6))
      if (entity === 'cycles') { setCycles((old) => ({ months: [...(old?.months ?? []), ...(next.months ?? [])], nextCursor: next.nextCursor } as Page)); setCycleCursor(next.nextCursor ?? '') }
      else { setExpenses((old) => ({ months: [...(old?.months ?? []), ...(next.months ?? [])], nextCursor: next.nextCursor } as Page)); setExpenseCursor(next.nextCursor ?? '') }
    } catch (error) { toast(parseError(error).message ?? 'No se pudieron cargar más meses', 'bad') }
    finally { setLoadingMore(false) }
  }
  useEffect(() => {
    const target = searchParams.get('cycleEnd')
    if (target && selected != null && cycles && !cycleRows.some((row) => row.cycleEnd === target) && cycleCursor && !loadingMore) void loadOlder('cycles')
  }, [searchParams, selected, cycles, cycleRows, cycleCursor, loadingMore])
  return <>
    <ViewHead title="Tarjetas" subtitle="Consulta la deuda y los ciclos por tarjeta" actions={<button className="btn btn--primary btn--sm" type="button" onClick={() => setAddingCard(true)}><Plus size={14} /> Nueva tarjeta</button>} />
    <div className="card-debt-summary"><div className="kpi kpi--accent"><span className="kpi__label">Deuda actual</span><span className="kpi__value">{fmtMoney(totalDebt, currency)}</span><span className="kpi__sub">suma de ciclos no pagados</span></div></div>
    {loading ? <Loading /> : cards.length === 0 ? <Empty>Agrega una tarjeta para comenzar</Empty> : <div className="cardselect-grid">{cards.map((card) => <article className="cardselect-item" key={card.id}><button type="button" className={`cardselect ${selected === Number(card.id) ? 'is-selected' : ''}`} aria-pressed={selected === Number(card.id)} onClick={() => selectCard(Number(card.id))}><span className="cardselect__name">{card.name} · ••{card.last4}</span><span className="cardselect__debt-label">Deuda actual</span><span className="cardselect__debt">{fmtMoney(card.debtCents ?? 0, currency)}</span><span className="cardselect__meta">Límite {card.limitCents == null ? 'sin límite' : <Money cents={card.limitCents} currency={currency} original={card.originalLimitCents} documentCurrency={card.limitCurrency} tc={card.limitTc} />}</span></button><div className="hstack"><button type="button" className="btn btn--xs" onClick={() => setExpenseCard(Number(card.id))}>Agregar gasto</button><button type="button" className="btn btn--xs" onClick={() => setEditingCard(card)}><Pencil size={12} /> Editar</button></div></article>)}</div>}
    {selected != null && <><FilterBar state={filters} /><h2 className="sectitle">Ciclos de facturación</h2>{cycleRows.length ? <div className="journal">{groupMonths(cycleRows).map(([month, rows]) => <section className="jmonth" key={month}><header className="jmonth__head"><h2>{monthLabel(month)}</h2><span className="jmonth__stats">{rows.length} ciclos</span></header>{rows.map((row) => <CycleAccordion key={`${row.cardId}-${row.cycleEnd}`} row={row} currency={currency} autoOpen={searchParams.get('cycleEnd') === row.cycleEnd} onPaid={async () => { try { await api.Cards.MarkCyclePaid(Number(row.cardId), row.cycleEnd, todayISO()); useStore.getState().refresh(); toast('Ciclo marcado como pagado') } catch (error) { toast(parseError(error).message ?? 'No se pudo actualizar el ciclo', 'bad') } }} />)}</section>)}</div> : <Empty>Sin ciclos de facturación</Empty>}{cycleCursor && <button type="button" className="btn" disabled={loadingMore} onClick={() => void loadOlder('cycles')}>Cargar ciclos anteriores</button>}<h2 className="sectitle">Gastos manuales</h2>{groupDateMonths(expenseRows).map(([month, monthExpenses]) => <section className="jmonth" key={month}><header className="jmonth__head"><h2>{monthLabel(month)}</h2><span className="jmonth__stats">{monthExpenses.length} gastos</span></header>{monthExpenses.map((row) => <div className="listrow" key={row.id}><span className="listrow__main">{row.concept}<span className="listrow__meta">{fmtDate(row.date)}</span></span><Money cents={row.amount_cents} currency={row.currency} original={row.original_amount_cents} documentCurrency={row.currency} tc={row.tc} />{row.voided_at ? <button className="btn btn--xs" type="button" onClick={async () => { await api.Cards.RestoreExpense(Number(row.id)); useStore.getState().refresh() }}>Restaurar</button> : <button className="btn btn--xs" type="button" onClick={async () => { await api.Cards.VoidExpense(Number(row.id)); useStore.getState().refresh() }}>Anular</button>}</div>)}</section>)}{expenseCursor && <button type="button" className="btn" disabled={loadingMore} onClick={() => void loadOlder('expenses')}>Cargar gastos anteriores</button>}</>}
    {addingCard && <CardModal onClose={() => setAddingCard(false)} />}
    {editingCard && <CardModal card={editingCard} onClose={() => setEditingCard(null)} />}
    {expenseCard != null && <ExpenseModal cardId={expenseCard} cards={cards} onClose={() => setExpenseCard(null)} />}
  </>
}

function groupMonths(rows: Row[]): Array<[string, Row[]]> {
  const groups = new Map<string, Row[]>()
  for (const row of rows) { const month = String(row.cycleEnd).slice(0, 7); groups.set(month, [...(groups.get(month) ?? []), row]) }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))
}

function groupDateMonths(rows: Row[]): Array<[string, Row[]]> {
  const groups = new Map<string, Row[]>()
  for (const row of rows) { const month = String(row.date).slice(0, 7); groups.set(month, [...(groups.get(month) ?? []), row]) }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))
}

function CycleAccordion({ row, currency, onPaid, autoOpen = false }: { row: Row; currency: Currency; onPaid: () => void; autoOpen?: boolean }) {
  const [open, setOpen] = useState(autoOpen)
  const [chargeResult, setChargeResult] = useState<{ currency: Currency; rows: Row[] } | null>(null)
  const charges = chargeResult?.currency === currency ? chargeResult.rows : null
  const [loading, setLoading] = useState(false)
  const state = statusView('cycles', row.status)
  const loadCharges = async () => {
    if (charges == null) {
      setLoading(true)
      try { setChargeResult({ currency, rows: await api.Cards.Charges(Number(row.cardId), row.cycleEnd, currency) as Row[] }) }
      catch { setChargeResult({ currency, rows: [] }) }
      finally { setLoading(false) }
    }
  }
  useEffect(() => { if (open) void loadCharges() }, [open, row.cardId, row.cycleEnd, currency])
  const toggle = () => setOpen((value) => !value)
  return <article className={`cyc tint--${state?.tone ?? 'blue'}`}><header className="cyc__head"><button className="cyc__toggle" type="button" aria-expanded={open} onClick={() => void toggle()}><strong>Cierre {fmtDate(row.cycleEnd)}</strong><span>Vence {fmtDate(row.dueDate)}</span></button><b>{fmtMoney(row.totalCents, currency)}</b><Badge state={state} />{row.status !== 'paid' && <button className="btn btn--xs btn--primary" type="button" onClick={onPaid}>Marcar como pagado</button>}</header>{open && <div className="table-scroll"><table className="tbl"><thead><tr><th>Fecha</th><th>Concepto</th><th>Referencia</th><th className="num">Monto</th></tr></thead><tbody>{loading ? <tr><td colSpan={4}>Cargando cargos…</td></tr> : charges?.length ? charges.map((charge) => <tr key={`${charge.source}-${charge.id}`}><td>{fmtDate(charge.date)}</td><td>{charge.concept}</td><td>{charge.source === 'purchase' ? <EntityLink kind="purchase" id={charge.refCode}>{charge.refCode}</EntityLink> : <span className="muted">Gasto manual</span>}</td><td className="num"><Money cents={charge.amountCents} currency={currency} original={charge.originalAmountCents} documentCurrency={charge.currency} tc={charge.tc} /></td></tr>) : <tr><td colSpan={4}>Sin cargos en este ciclo</td></tr>}</tbody></table></div>}</article>
}

function CardModal({ card, onClose }: { card?: Row; onClose: () => void }) {
  const [name, setName] = useState(String(card?.name ?? '')); const [last4, setLast4] = useState(String(card?.last4 ?? '')); const [cutDay, setCutDay] = useState(String(card?.cutDay ?? 20)); const [dueDay, setDueDay] = useState(String(card?.dueDay ?? 5)); const [limit, setLimit] = useState(card?.limitCents == null ? '' : centsText(Number(card.originalLimitCents ?? card.limitCents))); const [currency, setCurrency] = useState<Currency>((card?.limitCurrency ?? 'PEN') as Currency); const [busy, setBusy] = useState(false); const toast = useStore((state) => state.toast)
  return <Modal title={card ? 'Editar tarjeta' : 'Nueva tarjeta'} onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const rate = await api.Settings.DefaultTC(); await api.Catalog.SaveCard(new service.Card({ id: Number(card?.id ?? 0), name, last4, cutDay: Number(cutDay), dueDay: Number(dueDay), limitCents: limit ? textToCents(limit) : undefined, limitCurrency: currency, limitTc: rate })); useStore.getState().refresh(); toast(card ? 'Tarjeta actualizada' : 'Tarjeta creada'); onClose() } catch (error) { toast(parseError(error).message ?? 'No se pudo guardar la tarjeta', 'bad') } finally { setBusy(false) } }}><Field label="Nombre" required><TextInput value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Últimos 4 dígitos" required><TextInput maxLength={4} inputMode="numeric" value={last4} onChange={(event) => setLast4(event.target.value.replace(/\D/g, '').slice(0, 4))} /></Field><div className="formgrid"><Field label="Día de corte" required><TextInput type="number" min="1" max="31" value={cutDay} onChange={(event) => setCutDay(event.target.value)} /></Field><Field label="Día de pago" required><TextInput type="number" min="1" max="31" value={dueDay} onChange={(event) => setDueDay(event.target.value)} /></Field></div><Field label="Límite (opcional)"><MoneyInput currency={currency} value={limit} onChange={setLimit} /></Field><Seg options={[{ value: 'PEN', label: 'S/' }, { value: 'USD', label: '$' }]} value={currency} onChange={setCurrency} /><div className="hstack"><ModalActions onClose={onClose} busy={busy} label={card ? 'Guardar cambios' : 'Guardar tarjeta'} /></div></form></Modal>
}

function ExpenseModal({ cardId, cards, onClose }: { cardId: number; cards: Row[]; onClose: () => void }) {
  const [concept, setConcept] = useState(''); const [amount, setAmount] = useState(''); const [date, setDate] = useState(todayISO()); const [currency, setCurrency] = useState<Currency>('PEN'); const [rate, setRate] = useState('3.7500'); const [busy, setBusy] = useState(false); const toast = useStore((state) => state.toast)
  useEffect(() => { void api.Settings.DefaultTC().then((value) => setRate(tcText(value))) }, [])
  const card = cards.find((item) => Number(item.id) === cardId)
  return <Modal title={`Agregar gasto${card ? ` · ${card.name}` : ''}`} onClose={onClose}><form className="stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const scaled = tcFromText(rate); if (!scaled) throw new Error('TC no válido'); await api.Cards.SaveExpense(new service.CardExpense({ cardId, date, concept, amountCents: textToCents(amount) ?? 0, currency, tc: scaled })); useStore.getState().refresh(); toast('Gasto registrado'); onClose() } catch (error) { toast(parseError(error).message ?? 'No se pudo registrar el gasto', 'bad') } finally { setBusy(false) } }}><Field label="Concepto" required><TextInput value={concept} onChange={(event) => setConcept(event.target.value)} /></Field><Field label="Monto" required><MoneyInput currency={currency} value={amount} onChange={setAmount} /></Field><Field label="Fecha"><TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><Seg options={[{ value: 'PEN', label: 'S/' }, { value: 'USD', label: '$' }]} value={currency} onChange={setCurrency} /><Field label="TC (S/ por $)" required><TcField value={rate} onChange={setRate} /></Field><div className="hstack"><ModalActions onClose={onClose} busy={busy} label="Registrar gasto" /></div></form></Modal>
}
