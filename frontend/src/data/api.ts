import type { service } from '../../wailsjs/go/models'
import * as Catalog from '../../wailsjs/go/service/CatalogService'
import * as Purchases from '../../wailsjs/go/service/PurchaseService'
import * as Inventory from '../../wailsjs/go/service/InventoryService'
import * as Sales from '../../wailsjs/go/service/SalesService'
import * as Payments from '../../wailsjs/go/service/PaymentService'
import * as Cards from '../../wailsjs/go/service/CardService'
import * as Settings from '../../wailsjs/go/service/SettingsService'
import * as Dashboard from '../../wailsjs/go/service/DashboardService'
import * as System from '../../wailsjs/go/service/SystemService'

export type Query = service.ListQuery
export type Page = service.Page
export type Filter = service.Filter
export type Purchase = service.Purchase
export type Sale = service.Sale
export type Product = service.Product
export type Client = service.Client
export type Supplier = service.Supplier
export type Card = service.Card
export type Currency = 'PEN' | 'USD'

export const api = { Catalog, Purchases, Inventory, Sales, Payments, Cards, Settings, Dashboard, System }

export function query(displayCurrency: Currency, filters: Filter[] = [], cursorMonth = '', monthsLimit = 6): Query {
  return { filters, displayCurrency, cursorMonth, monthsLimit } as Query
}

export async function allPages(fetchPage: (q: Query) => Promise<Page>, currency: Currency, filters: Filter[] = []): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = []
  let cursor = ''
  for (let i = 0; i < 20; i++) {
    const page = await fetchPage(query(currency, filters, cursor, 120))
    for (const group of page.months ?? []) rows.push(...(group.rows as Record<string, any>[]))
    if (!page.nextCursor || page.nextCursor === cursor) break
    cursor = page.nextCursor
  }
  return rows
}
