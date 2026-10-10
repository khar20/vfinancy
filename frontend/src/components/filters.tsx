import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { service } from '../../wailsjs/go/models'
import { api } from '../data/api'
import { fieldLabel } from '../data/status'
import { textToCents } from '../lib/money'
import { cx } from '../lib/format'

export type FilterField = { field: string; type: 'text' | 'number' | 'date' | 'option'; operators: string[] }
type Draft = { id: number; field: string; op: string; value: string | string[]; end: string }

const optionSets: Record<string, Array<{ value: string; label: string }>> = {
  status: [['voided','Anulada'],['pending','Pendiente'],['sold','Vendida'],['reserved','Reservada'],['received','Recibida'],['depleted','Agotado'],['auction','En remate'],['active','Activo'],['overdue','Atrasada'],['balance','Saldo pendiente'],['paid','Pagada'],['prepared','Preparado'],['sent','Enviado'],['delivered','Entregado'],['refunded','Devuelto'],['applied','Aplicado'],['due','Por pagar'],['open','Abierto']].map(([value,label]) => ({ value, label })),
  paymentMethod: [{ value: 'card', label: 'Tarjeta' }, { value: 'cash', label: 'Efectivo' }, { value: 'wallet', label: 'Billetera digital' }],
  method: [{ value: 'card', label: 'Tarjeta' }, { value: 'cash', label: 'Efectivo' }, { value: 'wallet', label: 'Billetera digital' }],
  source: [{ value: 'purchase', label: 'Compra' }, { value: 'manual', label: 'Ingreso manual' }],
  movement: [{ value: 'in', label: 'Entrada' }, { value: 'out', label: 'Salida' }],
  kind: [{ value: 'sale', label: 'Venta' }, { value: 'shipment', label: 'Envío' }, { value: 'payment', label: 'Cobro' }, { value: 'advance', label: 'Adelanto' }],
  shipmentStatus: [{ value: 'prepared', label: 'Preparado' }, { value: 'sent', label: 'Enviado' }, { value: 'delivered', label: 'Entregado' }],
}
const statesByEntity: Record<string, Array<{ value: string; label: string }>> = {
  purchases: [['voided','Anulada'],['pending','Pendiente'],['sold','Vendida'],['reserved','Reservada'],['received','Recibida']].map(([value,label]) => ({ value, label })),
  sales: [['voided','Anulada'],['overdue','Atrasada'],['balance','Saldo pendiente'],['paid','Pagada'],['prepared','Preparado'],['sent','Enviado'],['delivered','Entregado']].map(([value,label]) => ({ value, label })),
  lots: [['voided','Anulado'],['depleted','Agotado'],['reserved','Reservado'],['auction','En remate'],['active','Activo']].map(([value,label]) => ({ value, label })),
  clients: [['voided','Anulado'],['balance','Con saldo']].map(([value,label]) => ({ value, label })),
  cycles: [['paid','Pagado'],['overdue','Vencido'],['due','Por pagar'],['open','Abierto']].map(([value,label]) => ({ value, label })),
}
const moneyFields = new Set(['total', 'balance', 'cost', 'price', 'unitCost', 'amount'])
let sequence = 1
const createDraft = (schema: FilterField[]): Draft => {
  const first = schema.find((field) => field.field === 'code') ?? schema.find((field) => field.field === 'name') ?? schema[0]
  return { id: sequence++, field: first?.field ?? '', op: first?.operators[0] ?? 'contains', value: '', end: '' }
}

export function useServerFilters(entity: string) {
  const [schema, setSchema] = useState<FilterField[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [filters, setFilters] = useState<service.Filter[]>([])
  useEffect(() => {
    let active = true
    const request = entity === 'cycles' ? api.Cards.GetFilterSchema() : entity === 'kardex' ? api.Inventory.GetFilterSchema() : api.Catalog.GetFilterSchema(entity)
    request.then((rows) => {
      if (!active) return
      const fields = rows as FilterField[]
      setSchema(fields)
      setDrafts([createDraft(fields)])
    }).catch(() => { if (active) { setSchema([]); setDrafts([]) } })
    return () => { active = false }
  }, [entity])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = drafts.flatMap((draft) => {
        if (!draft.field) return []
        const field = schema.find((item) => item.field === draft.field)
        const blank = Array.isArray(draft.value) ? draft.value.length === 0 : draft.value.trim() === ''
        if (blank || (draft.op === 'between' && !draft.end)) return []
        const convert = (value: string): unknown => field?.type === 'number'
          ? moneyFields.has(draft.field) ? textToCents(value) ?? Number(value) : Number(value)
          : value
        const value = draft.op === 'isAny' && !Array.isArray(draft.value)
          ? String(draft.value).split(',').filter(Boolean)
          : Array.isArray(draft.value) ? draft.value : convert(draft.value)
        return [new service.Filter({ field: draft.field, op: draft.op, value, end: draft.op === 'between' ? convert(draft.end) : undefined })]
      })
      setFilters(next)
    }, 280)
    return () => window.clearTimeout(timer)
  }, [drafts, schema])

  const update = (id: number, patch: Partial<Draft>) => setDrafts((current) => current.map((draft) => {
    if (draft.id !== id) return draft
    const next = { ...draft, ...patch }
    const field = schema.find((item) => item.field === next.field)
    if (patch.field) { next.op = field?.operators[0] ?? 'contains'; next.value = ''; next.end = '' }
    if (patch.op) { next.value = patch.op === 'isAny' ? [] : ''; next.end = '' }
    return next
  }))
  const add = () => setDrafts((current) => [...current, createDraft(schema)])
  const remove = (id: number) => setDrafts((current) => current.length > 1 ? current.filter((draft) => draft.id !== id) : [createDraft(schema)])
  const clear = () => setDrafts([createDraft(schema)])
  return { schema, drafts, filters, update, add, remove, clear, entity }
}

const operatorLabels: Record<string, string> = { contains: 'contiene', equals: 'es igual', '=': '=', '>': '>', '<': '<', between: 'entre', inMonth: 'en el mes', before: 'antes', after: 'después', is: 'es', isAny: 'es alguno de' }

export function FilterBar({ state }: { state: ReturnType<typeof useServerFilters> }) {
  const [open, setOpen] = useState(false)
  const activeCount = state.drafts.filter((draft) => Array.isArray(draft.value) ? draft.value.length > 0 : draft.value.trim() !== '' || draft.end !== '').length
  return <section className="filtercontrol"><button type="button" className="btn filtercontrol__toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? 'Ocultar filtros' : 'Filtros'}{activeCount > 0 && <span className="filtercontrol__count">{activeCount}</span>}</button>{open && <div className="filterbar" role="group" aria-label="Filtros de la página">
    {state.drafts.map((draft) => {
      const field = state.schema.find((item) => item.field === draft.field)
      const options = draft.field === 'status' ? statesByEntity[state.entity] ?? optionSets.status : optionSets[draft.field] ?? []
      const inputType = field?.type === 'date' ? (draft.op === 'inMonth' ? 'month' : 'date') : field?.type === 'number' ? 'number' : 'text'
      const value = Array.isArray(draft.value) ? draft.value : draft.value
      return <div className={cx('fchip', draft.op === 'between' && 'fchip--range')} key={draft.id}>
        <select className="fchip__field" aria-label="Campo del filtro" value={draft.field} onChange={(event) => state.update(draft.id, { field: event.target.value })}>{state.schema.map((item) => <option key={item.field} value={item.field}>{fieldLabel(item.field)}</option>)}</select>
        <select className="fchip__op" aria-label="Operador del filtro" value={draft.op} onChange={(event) => state.update(draft.id, { op: event.target.value })}>{(field?.operators ?? []).map((op) => <option key={op} value={op}>{operatorLabels[op] ?? op}</option>)}</select>
        {field?.type === 'option' ? <select className="fchip__val" aria-label="Valor del filtro" multiple={draft.op === 'isAny'} value={Array.isArray(value) ? value : String(value).split(',').filter(Boolean)} onChange={(event) => state.update(draft.id, { value: draft.op === 'isAny' ? Array.from(event.target.selectedOptions, (item) => item.value) : event.target.value })}><option value="">Seleccionar</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <><input className="input input--xs fchip__val" aria-label="Valor del filtro" type={inputType} value={String(value)} onChange={(event) => state.update(draft.id, { value: event.target.value })} />{draft.op === 'between' && <input className="input input--xs fchip__val" aria-label="Valor final del filtro" type={inputType} value={draft.end} onChange={(event) => state.update(draft.id, { end: event.target.value })} />}</>}
        <button className="fchip__x" type="button" aria-label="Quitar filtro" onClick={() => state.remove(draft.id)}><X size={12} /></button>
      </div>
    })}
    <div className="filterbar__actions"><button className="btn btn--xs" type="button" onClick={state.add}><Plus size={12} /> Filtro</button><button className="btn btn--xs" type="button" onClick={state.clear}>Limpiar</button></div>
  </div>}</section>
}
