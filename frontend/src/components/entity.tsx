import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '../lib/format'

export type EntityKind = 'purchase' | 'sale' | 'shipment' | 'lot' | 'client' | 'supplier' | 'product' | 'card'
const hrefFor = (kind: EntityKind, id: string) => {
  const code = encodeURIComponent(id)
  if (kind === 'product') return `/inventario/producto/${code}`
  if (kind === 'client') return `/clientes/${code}`
  if (kind === 'supplier') return `/proveedores/${code}`
  if (kind === 'lot') return `/inventario?tab=lots&lote=${code}`
  if (kind === 'card') return `/tarjetas?cardId=${code}`
  const route = kind === 'purchase' ? 'compras' : kind === 'sale' ? 'ventas' : 'envios'
  return `/${route}?abrir=${code}`
}

export function EntityLink({ kind, id, children, chip = false, className }: { kind: EntityKind; id: string | number; children: ReactNode; chip?: boolean; className?: string }) {
  return <Link className={cx(chip ? 'entity-link entity-link--chip refchip' : 'entity-link entity-link--inline plink', className)} to={hrefFor(kind, String(id))}>{children}</Link>
}
