import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { cx } from '../lib/format'

export type AutocompleteOption = { value: string; label: string; sub?: string }

export function Autocomplete({ options, value, onChange, onCreate, placeholder }: { options: AutocompleteOption[]; value: string; onChange: (value: string) => void; onCreate?: (text: string) => void; placeholder?: string }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)
  const matches = useMemo(() => {
    const search = text.trim().toLocaleLowerCase()
    return search ? options.filter((option) => `${option.label} ${option.sub ?? ''}`.toLocaleLowerCase().includes(search)) : options
  }, [options, text])
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return <div className="acwrap" ref={root}><input className="input" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={id} autoComplete="off" placeholder={placeholder} value={open ? text : selected?.label ?? ''} onFocus={() => { setOpen(true); setText('') }} onChange={(event) => { setText(event.target.value); setOpen(true); setActive(0) }} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, matches.length - 1)) }; if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)) }; if (event.key === 'Enter') { event.preventDefault(); if (matches[active]) { onChange(matches[active].value); setOpen(false) } else if (onCreate) { onCreate(text.trim()); setOpen(false) } } }} />{open && <div className="menu__pop ac__pop" id={id} role="listbox">{matches.map((option, index) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={cx('menu__item', index === active && 'is-active')} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option.value); setOpen(false) }}><span className="ac__label">{option.label}</span>{option.sub && <span className="ac__sub">{option.sub}</span>}</button>)}{onCreate && <button className="menu__item menu__item--create" type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => { onCreate(text.trim()); setOpen(false) }}><Plus size={12} /><span>{text.trim() ? `Agregar nuevo: «${text.trim()}»` : 'Agregar nuevo'}</span></button>}</div>}</div>
}
