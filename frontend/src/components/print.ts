import type { Currency } from '../data/api'
import { fmtDate } from '../lib/format'
import { formatMoney } from '../lib/money'

type PrintSale = { code: string; date: string; currency: string; shipAddress: string; shipRegion: string; securityCode: string; items: Array<{ productId: number; qty: number; unitPriceCents: number }>; extras: Array<{ concept: string; amountCents: number; currency: string }> }
export function printShipment(sale: PrintSale, products: Array<Record<string, any>>, clientName: string, totalCents: number) {
  document.querySelector('.printroot')?.remove()
  const root = document.createElement('main'); root.className = 'printroot'
  const title = document.createElement('h1'); title.className = 'code'; title.textContent = `${sale.code} · Envío`; root.append(title)
  const recipient = document.createElement('section'); recipient.textContent = `Destinatario: ${clientName} · Dirección: ${sale.shipAddress} / ${sale.shipRegion} · Fecha: ${fmtDate(sale.date)}`; root.append(recipient)
  const security = document.createElement('section'); const code = document.createElement('span'); code.className = 'sec'; code.textContent = `Código de seguridad: ${sale.securityCode}`; security.append(code); root.append(security)
  const table = document.createElement('table'); const head = document.createElement('thead'); const heading = document.createElement('tr')
  for (const label of ['Producto', 'Cant.', 'P. unit.', 'Subtotal']) { const cell = document.createElement('th'); cell.textContent = label; heading.append(cell) }
  head.append(heading); table.append(head)
  const body = document.createElement('tbody')
  for (const item of sale.items) { const row = document.createElement('tr'); const product = products.find((entry) => Number(entry.id) === item.productId); for (const value of [product?.name ?? `Producto ${item.productId}`, String(item.qty), formatMoney(item.unitPriceCents, sale.currency as Currency), formatMoney(item.qty * item.unitPriceCents, sale.currency as Currency)]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell) }; body.append(row) }
  for (const extra of sale.extras) { const row = document.createElement('tr'); const label = document.createElement('td'); label.colSpan = 3; label.textContent = extra.concept; const value = document.createElement('td'); value.textContent = formatMoney(extra.amountCents, extra.currency as Currency); row.append(label, value); body.append(row) }
  table.append(body); const foot = document.createElement('tfoot'); const row = document.createElement('tr'); const spacer = document.createElement('td'); spacer.colSpan = 3; const total = document.createElement('td'); total.textContent = `Total ${formatMoney(totalCents, sale.currency as Currency)}`; row.append(spacer, total); foot.append(row); table.append(foot); root.append(table)
  document.body.append(root); document.body.classList.add('printing-receipt'); window.print(); document.body.classList.remove('printing-receipt'); root.remove()
}
