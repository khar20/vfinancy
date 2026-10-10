import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cx } from '../lib/format'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
}

export function RowMenu({ items, label = 'Acciones' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return <div className={cx('menu', open && 'menu--open')} ref={ref}>
    <button type="button" className={cx('iconbtn', open && 'is-active')} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={15} /></button>
    {open && <div className="menu__pop" role="menu">{items.map((item) => <button key={item.label} type="button" role="menuitem" disabled={item.disabled} className={cx('menu__item', item.danger && 'menu__item--danger')} onClick={() => { setOpen(false); item.onSelect?.() }}>{item.icon}{item.label}</button>)}</div>}
  </div>
}
