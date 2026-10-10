import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cx } from '../lib/format'

export type RowMenuItem = { label: string; onSelect: () => void; danger?: boolean; icon?: ReactNode }
export function RowMenu({ items, label = 'Más acciones' }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  return <div className={cx('menu', open && 'menu--open')} ref={ref}><button type="button" className="iconbtn" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={15} /></button>{open && <div className="menu__pop" role="menu">{items.map((item) => <button key={item.label} type="button" className={cx('menu__item', item.danger && 'menu__item--danger')} role="menuitem" onClick={() => { setOpen(false); item.onSelect() }}>{item.icon}{item.label}</button>)}</div>}</div>
}
