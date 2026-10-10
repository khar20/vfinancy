export type Tone = 'gray' | 'amber' | 'blue' | 'green' | 'red' | 'violet'
export interface StatusView { key: string; label: string; tone: Tone }

const states: Record<string, Record<string, StatusView | null>> = {
  purchases: {
    voided: { key: 'voided', label: 'Anulada', tone: 'gray' }, pending: { key: 'pending', label: 'Pendiente', tone: 'amber' },
    sold: { key: 'sold', label: 'Vendida', tone: 'green' }, reserved: { key: 'reserved', label: 'Reservada', tone: 'violet' },
    received: { key: 'received', label: 'Recibida', tone: 'blue' },
  },
  lots: {
    voided: { key: 'voided', label: 'Anulado', tone: 'gray' }, depleted: { key: 'depleted', label: 'Agotado', tone: 'gray' },
    reserved: { key: 'reserved', label: 'Reservado', tone: 'violet' }, auction: { key: 'auction', label: 'En remate', tone: 'red' }, active: null,
  },
  sales: {
    voided: { key: 'voided', label: 'Anulada', tone: 'gray' }, overdue: { key: 'overdue', label: 'Atrasada', tone: 'red' },
    balance: { key: 'balance', label: 'Saldo pendiente', tone: 'amber' }, paid: { key: 'paid', label: 'Pagada', tone: 'green' },
    prepared: { key: 'prepared', label: 'Preparado', tone: 'amber' }, sent: { key: 'sent', label: 'Enviado', tone: 'blue' }, delivered: { key: 'delivered', label: 'Entregado', tone: 'green' },
  },
  cycles: {
    paid: { key: 'paid', label: 'Pagado', tone: 'green' }, overdue: { key: 'overdue', label: 'Vencido', tone: 'red' },
    due: { key: 'due', label: 'Por pagar', tone: 'amber' }, open: { key: 'open', label: 'Abierto', tone: 'blue' },
  },
  payments: {
    voided: { key: 'voided', label: 'Anulado', tone: 'gray' }, refunded: { key: 'refunded', label: 'Devuelto', tone: 'gray' },
    applied: { key: 'applied', label: 'Aplicado', tone: 'green' }, active: { key: 'active', label: 'Vigente', tone: 'blue' },
  },
  clients: { voided: { key: 'voided', label: 'Anulado', tone: 'gray' }, balance: { key: 'balance', label: 'Con saldo', tone: 'amber' } },
}

export const statusView = (entity: keyof typeof states, value: unknown): StatusView | null => states[entity]?.[String(value)] ?? null

export const statusOptions: Record<string, Array<{ value: string; label: string }>> = {
  status: [
    ['voided', 'Anulada'], ['pending', 'Pendiente'], ['sold', 'Vendida'], ['reserved', 'Reservada'], ['received', 'Recibida'],
    ['depleted', 'Agotado'], ['auction', 'En remate'], ['active', 'Activo'], ['overdue', 'Atrasada'], ['balance', 'Saldo pendiente'],
    ['paid', 'Pagada'], ['prepared', 'Preparado'], ['sent', 'Enviado'], ['delivered', 'Entregado'], ['refunded', 'Devuelto'], ['applied', 'Aplicado'], ['due', 'Por pagar'], ['open', 'Abierto'],
  ].map(([value, label]) => ({ value, label })),
  paymentMethod: [{ value: 'card', label: 'Tarjeta' }, { value: 'cash', label: 'Efectivo' }, { value: 'wallet', label: 'Billetera digital' }],
  method: [{ value: 'card', label: 'Tarjeta' }, { value: 'cash', label: 'Efectivo' }, { value: 'wallet', label: 'Billetera digital' }],
  source: [{ value: 'purchase', label: 'Compra' }, { value: 'manual', label: 'Ingreso manual' }],
  movement: [{ value: 'in', label: 'Entrada' }, { value: 'out', label: 'Salida' }],
  kind: [{ value: 'sale', label: 'Venta' }, { value: 'shipment', label: 'Envío' }, { value: 'payment', label: 'Cobro' }, { value: 'advance', label: 'Adelanto' }],
}

const labels: Record<string, string> = {
  code: 'Código', name: 'Nombre', supplier: 'Proveedor', client: 'Cliente (para cliente)', date: 'Fecha', total: 'Total',
  paymentMethod: 'Método de pago', status: 'Estado', product: 'Producto', region: 'Región', balance: 'Saldo', entryDate: 'Fecha de ingreso',
  available: 'Disponible', unitCost: 'Costo unitario', source: 'Origen', sku: 'SKU', stock: 'Stock', cost: 'Costo', price: 'Precio',
  phone: 'Teléfono', card: 'Tarjeta', cycleEnd: 'Fecha de corte', movement: 'Movimiento', qty: 'Cantidad',
  method: 'Método', amount: 'Monto', concept: 'Concepto', last4: 'Últimos 4 dígitos',
}
export const fieldLabel = (field: string) => labels[field] ?? field
