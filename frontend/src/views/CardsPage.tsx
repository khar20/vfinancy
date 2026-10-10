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
  const [params, setParams] = useSearchParams()
  const filterKey = JSON.stringify(filters.filters.map((f) => [f.field, f.op, f.value, f.end]))
  const [cards, setCards] = useState<Row[]>([])
  const [cycles, setCycles] = useState<Page | null>(null)
  const [expenses, setExpenses] = useState<Page | null>(null)
  const [cycleCursor, setCycleCursor] = useState('')
  const [expenseCursor, setExpenseCursor] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [cardModal, setCardModal] = useState<Row | null | false>(false)
  const [expenseCard, setExpenseCard] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    void Promise.all([api.Cards.Summaries(currency), api.Cards.ListCycles(query(currency, filters.filters)), api.Cards.ListExpenses(query(currency)), api.Catalog.ListCards(query(currency, [], '', 120))])
      .then(([summaries, cyclePage, expensePage, cardPage]) => {
        if (!active) return
        const catalog = cardPage.months.flatMap((month) => month.rows as Row[])
        setCards((summaries as Row[]).map((card) => ({ ...card, cutDay: catalog.find((row) => Number(row.id) === Number(card.id))?.cut_day, dueDay: catalog.find((row) => Number(row.id) === Number(card.id))?.due_day })))
        setCycles(cyclePage); setExpenses(expensePage); setCycleCursor(cyclePage.nextCursor ?? ''); setExpenseCursor(expensePage.nextCursor ?? ''); setLoading(false)
      })
      .catch((error) => { if (active) { toast(parseError(error).message ?? 'No se pudieron cargar las tarjetas', 'bad'); setLoading(false) } })
    return () => { active = false }
  }, [currency, revision, filterKey])
  useEffect(() => { useStore.getState().registerNew(() => setCardModal(null)); return () => useStore.getState().registerNew(null) }, [])
  useEffect(() => { const id = Number(params.get('cardId')); if (id > 0 && cards.some((card) => Number(card.id) === id)) setSelected(id) }, [cards, params])

  const totalDebt = cards.reduce((sum, card) => sum + Number(card.debtCents ?? 0), 0)
  const cycleRows = (cycles?.months ?? []).flatMap((month) => month.rows as Row[]).filter((row) => selected == null || Number(row.cardId) === selected)
  const expenseRows = (expenses?.months ?? []).flatMap((month) => month.rows as Row[]).filter((row) => Number(row.card_id) === selected)
  const selectCard = (id: number) => {
    const next = new URLSearchParams(params)
    if (selected === id) { next.delete('cardId'); next.delete('cycleEnd'); setSelected(null) }
    else { next.set('cardId', String(id)); setSelected(id) }
    setParams(next, { replace: true })
  }
  const loadOlder = async (kind: 'cycles' | 'expenses') => {
    const cursor = kind === 'cycles' ? cycleCursor : expenseCursor
    if (!cursor || busy) return
    setBusy(true)
    try {
      const next = kind === 'cycles' ? await api.Cards.ListCycles(query(currency, filters.filters, cursor, 6)) : await api.Cards.ListExpenses(query(currency, [], cursor, 6))
      if (kind === 'cycles') { setCycles((old) => ({ months: [...(old?.months ?? []), ...next.months], nextCursor: next.nextCursor } as Page)); setCycleCursor(next.nextCursor ?? '') }
      else { setExpenses((old) => ({ months: [...(old?.months ?? []), ...next.months], nextCursor: next.nextCursor } as Page)); setExpenseCursor(next.nextCursor ?? '') }
    } catch (error) { toast(parseError(error).message ?? 'No se pudieron cargar más meses', 'bad') }
    finally { setBusy(false) }
  }

  return <>
    <ViewHead title="Tarjetas" subtitle="Consulta la deuda y los ciclos por tarjeta" actions={<button className="btn btn--primary btn--sm" type="button" onClick={() => setCardModal(null)}><Plus size={14}/> Nueva tarjeta</button>} />
    <div className="card-debt-summary"><div className="kpi kpi--accent"><span className="kpi__label">Deuda actual</span><span className="kpi__value"><Money cents={totalDebt}/></span><span className="kpi__sub">suma de ciclos no pagados</span></div></div>
    {loading ? <Loading/> : cards.length === 0 ? <Empty>Agrega una tarjeta para comenzar</Empty> : <div className="cardselect-grid">{cards.map((card) => <article className="cardselect-item" key={card.id}><button type="button" className={`cardselect ${selected === Number(card.id) ? 'is-selected' : ''}`} aria-pressed={selected === Number(card.id)} onClick={() => selectCard(Number(card.id))}><span className="cardselect__name">{card.name} · ••{card.last4}</span><span className="cardselect__debt-label">Deuda actual</span><span className="cardselect__debt">{fmtMoney(card.debtCents ?? 0, currency)}</span><span className="cardselect__meta">Límite {card.limitCents == null ? 'sin límite' : <Money cents={card.limitCents} currency={currency} original={card.originalLimitCents} documentCurrency={card.limitCurrency} tc={card.limitTc}/>}</span><span className="cardselect__meta">Corte día {card.cutDay ?? '—'} · pago día {card.dueDay ?? '—'}</span></button><div className="hstack"><button type="button" className="btn btn--xs cardselect-item__action" onClick={() => setExpenseCard(Number(card.id))}>Agregar gasto</button><button type="button" className="btn btn--xs" onClick={() => setCardModal(card)}><Pencil size={12}/> Editar</button></div></article>)}</div>}
    {selected != null && <><FilterBar state={filters}/><h2 className="sectitle">Ciclos de facturación</h2>{cycleRows.length ? <div className="journal">{groupMonths(cycleRows).map(([month, rows]) => <section className="jmonth" key={month}><header className="jmonth__head"><h2>{monthLabel(month)}</h2><span className="jmonth__stats">{rows.length} ciclos</span></header>{rows.map((row) => <CycleAccordion key={`${row.cardId}-${row.cycleEnd}`} row={row} currency={currency} autoOpen={params.get('cycleEnd') === row.cycleEnd} onPaid={async () => { try { await api.Cards.MarkCyclePaid(Number(row.cardId), row.cycleEnd, todayISO()); useStore.getState().refresh(); toast('Ciclo marcado como pagado') } catch (error) { toast(parseError(error).message ?? 'No se pudo actualizar el ciclo', 'bad') } }}/>)}</section>)}</div> : <Empty>Sin ciclos de facturación</Empty>}{cycleCursor && <button type="button" className="btn" disabled={busy} onClick={() => void loadOlder('cycles')}>Cargar ciclos anteriores</button>}<h2 className="sectitle">Gastos manuales</h2>{groupDateMonths(expenseRows).map(([month, rows]) => <section className="jmonth" key={month}><header className="jmonth__head"><h2>{monthLabel(month)}</h2><span className="jmonth__stats">{rows.length} gastos</span></header>{rows.map((row) => <div className={`listrow ${row.voided_at ? 'listrow--void' : ''}`} key={row.id}><span className="listrow__main"><span className="listrow__title">{row.concept}</span><span className="listrow__meta">{fmtDate(row.date)}</span></span><Money cents={row.amount_cents} currency={row.currency} original={row.original_amount_cents} documentCurrency={row.currency} tc={row.tc}/>{row.voided_at ? <button className="btn btn--xs" type="button" onClick={async () => { await api.Cards.RestoreExpense(Number(row.id)); useStore.getState().refresh() }}>Restaurar</button> : <button className="btn btn--xs" type="button" onClick={async () => { await api.Cards.VoidExpense(Number(row.id)); useStore.getState().refresh() }}>Anular</button>}</div>)}</section>)}{expenseCursor && <button className="btn" type="button" disabled={busy} onClick={() => void loadOlder('expenses')}>Cargar gastos anteriores</button>}</>}
    {cardModal !== false && <CardModal card={cardModal || undefined} onClose={() => setCardModal(false)}/>}
    {expenseCard != null && <ExpenseModal cardId={expenseCard} cards={cards} onClose={() => setExpenseCard(null)}/>}
  </>
}

function groupMonths(rows: Row[]): Array<[string, Row[]]> { const groups = new Map<string, Row[]>(); for (const row of rows) { const key = String(row.cycleEnd).slice(0,7); groups.set(key,[...(groups.get(key) ?? []),row]) } return [...groups.entries()].sort((a,b) => b[0].localeCompare(a[0])) }
function groupDateMonths(rows: Row[]): Array<[string, Row[]]> { const groups = new Map<string, Row[]>(); for (const row of rows) { const key = String(row.date).slice(0,7); groups.set(key,[...(groups.get(key) ?? []),row]) } return [...groups.entries()].sort((a,b) => b[0].localeCompare(a[0])) }

function CycleAccordion({ row, currency, onPaid, autoOpen = false }: { row: Row; currency: Currency; onPaid: () => void; autoOpen?: boolean }) {
  const [open, setOpen] = useState(autoOpen)
  const [chargeResult, setChargeResult] = useState<{currency: Currency; rows: Row[]} | null>(null)
  const charges = chargeResult?.currency === currency ? chargeResult.rows : null
  const [loading, setLoading] = useState(false)
  const state = statusView('cycles', row.status)
  useEffect(() => { if (!open || charges != null) return; let active = true; setLoading(true); void api.Cards.Charges(Number(row.cardId), row.cycleEnd, currency).then((items) => { if (active) setChargeResult({currency,rows:items as Row[]}) }).catch(() => { if (active) setChargeResult({currency,rows:[]}) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [open, row.cardId, row.cycleEnd, currency, charges])
  return <article className={`cyc stripe stripe--${state?.tone ?? 'blue'}`}><header className="cyc__head"><button className="cyc__toggle" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}><strong>Ciclo · cierre {fmtDate(row.cycleEnd)}</strong><span>Vence {fmtDate(row.dueDate)}</span></button><b className="cyc__total num">{fmtMoney(row.totalCents, currency)}</b><Badge state={state}/>{row.status !== 'paid' && <button className="btn btn--xs btn--primary" type="button" onClick={onPaid}>Marcar como pagado</button>}</header>{open && <div className="table-scroll"><table className="tbl"><thead><tr><th>Fecha</th><th>Concepto</th><th>Referencia</th><th className="num">Monto</th></tr></thead><tbody>{loading ? <tr><td colSpan={4}>Cargando cargos…</td></tr> : charges?.length ? charges.map((charge) => <tr key={`${charge.source}-${charge.id}`}><td>{fmtDate(charge.date)}</td><td>{charge.concept}</td><td>{charge.source === 'purchase' ? <EntityLink kind="purchase" id={charge.refCode}>{charge.refCode}</EntityLink> : <span className="muted">Gasto manual</span>}</td><td className="num"><Money cents={charge.amountCents} currency={currency} original={charge.originalAmountCents} documentCurrency={charge.currency} tc={charge.tc}/></td></tr>) : <tr><td colSpan={4}>Sin cargos en este ciclo</td></tr>}</tbody></table></div>}</article>
}

function CardModal({ card, onClose }: { card?: Row; onClose: () => void }) {
  const [name,setName]=useState(String(card?.name??'')),[last4,setLast4]=useState(String(card?.last4??'')),[cutDay,setCutDay]=useState(String(card?.cutDay??20)),[dueDay,setDueDay]=useState(String(card?.dueDay??5)),[limit,setLimit]=useState(card?.limitCents==null?'':centsText(Number(card.originalLimitCents??card.limitCents))),[currency,setCurrency]=useState<Currency>((card?.limitCurrency??'PEN') as Currency),[busy,setBusy]=useState(false)
  const toast=useStore((state)=>state.toast)
  return <Modal title={card?'Editar tarjeta':'Nueva tarjeta'} onClose={onClose}><form className="stack" onSubmit={async(event)=>{event.preventDefault();setBusy(true);try{const rate=await api.Settings.DefaultTC();await api.Catalog.SaveCard(new service.Card({id:Number(card?.id??0),name,last4,cutDay:Number(cutDay),dueDay:Number(dueDay),limitCents:limit?textToCents(limit):undefined,limitCurrency:currency,limitTc:rate}));useStore.getState().refresh();toast(card?'Tarjeta actualizada':'Tarjeta creada');onClose()}catch(error){toast(parseError(error).message??'No se pudo guardar la tarjeta','bad')}finally{setBusy(false)}}}><Field label="Nombre" required><TextInput value={name} onChange={(e)=>setName(e.target.value)}/></Field><Field label="Últimos 4 dígitos" required><TextInput maxLength={4} inputMode="numeric" value={last4} onChange={(e)=>setLast4(e.target.value.replace(/\D/g,'').slice(0,4))}/></Field><div className="formgrid"><Field label="Día de corte" required><TextInput type="number" min="1" max="31" value={cutDay} onChange={(e)=>setCutDay(e.target.value)}/></Field><Field label="Día de pago" required><TextInput type="number" min="1" max="31" value={dueDay} onChange={(e)=>setDueDay(e.target.value)}/></Field></div><Field label="Límite (opcional)"><MoneyInput currency={currency} value={limit} onChange={setLimit}/></Field><Seg options={[{value:'PEN',label:'S/'},{value:'USD',label:'$'}]} value={currency} onChange={setCurrency}/><div className="hstack"><ModalActions onClose={onClose} busy={busy} label={card?'Guardar cambios':'Guardar tarjeta'}/></div></form></Modal>
}

function ExpenseModal({ cardId, cards, onClose }: { cardId: number; cards: Row[]; onClose: () => void }) {
  const [concept,setConcept]=useState(''),[amount,setAmount]=useState(''),[date,setDate]=useState(todayISO()),[currency,setCurrency]=useState<Currency>('PEN'),[rate,setRate]=useState('3.7500'),[busy,setBusy]=useState(false)
  const toast=useStore((state)=>state.toast)
  useEffect(()=>{void api.Settings.DefaultTC().then((value)=>setRate(tcText(value)))},[])
  const card=cards.find((item)=>Number(item.id)===cardId)
  return <Modal title={`Agregar gasto${card?` · ${card.name}`:''}`} onClose={onClose}><form className="stack" onSubmit={async(event)=>{event.preventDefault();setBusy(true);try{const tc=tcFromText(rate);if(!tc)throw new Error('TC no válido');await api.Cards.SaveExpense(new service.CardExpense({cardId,date,concept,amountCents:textToCents(amount)??0,currency,tc}));useStore.getState().refresh();toast('Gasto registrado');onClose()}catch(error){toast(parseError(error).message??'No se pudo registrar el gasto','bad')}finally{setBusy(false)}}}><Field label="Concepto" required><TextInput value={concept} onChange={(e)=>setConcept(e.target.value)}/></Field><Field label="Monto" required><MoneyInput currency={currency} value={amount} onChange={setAmount}/></Field><Field label="Fecha"><TextInput type="date" value={date} onChange={(e)=>setDate(e.target.value)}/></Field><Seg options={[{value:'PEN',label:'S/'},{value:'USD',label:'$'}]} value={currency} onChange={setCurrency}/><Field label="TC (S/ por $)" required><TcField value={rate} onChange={setRate}/></Field><div className="hstack"><ModalActions onClose={onClose} busy={busy} label="Registrar gasto"/></div></form></Modal>
}
