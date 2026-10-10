import { useEffect, useState } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { CreditCard, LayoutDashboard, Lock, Menu, Package, ReceiptText, Truck, Users, Wallet, Wrench, Shirt } from 'lucide-react'
import { useStore } from './data/store'
import { parseError } from './lib/errors'
import { cx } from './lib/format'
import { Toasts, Seg } from './components/ui'
import { InventoryPage } from './views/InventoryPage'
import { ClientsPage } from './views/ClientsPage'
import { SuppliersPage } from './views/SuppliersPage'
import { CardsPage } from './views/CardsPage'
import { DocsPage } from './views/DocsPage'
import { DashboardPage } from './views/DashboardPage'
import { SettingsPage } from './views/SettingsPage'
import { ProductDetailPage } from './views/ProductDetailPage'

const nav = [
  { to: '/', label: 'Inicio', icon: LayoutDashboard }, { to: '/compras', label: 'Compras', icon: ReceiptText },
  { to: '/inventario', label: 'Inventario', icon: Package }, { to: '/ventas', label: 'Ventas', icon: Wallet },
  { to: '/envios', label: 'Envíos', icon: Truck }, { to: '/tarjetas', label: 'Tarjetas', icon: CreditCard },
  { to: '/clientes', label: 'Clientes', icon: Users }, { to: '/proveedores', label: 'Proveedores', icon: Shirt }, { to: '/ajustes', label: 'Ajustes', icon: Wrench },
]
const titles: Record<string, string> = Object.fromEntries(nav.map((item) => [item.to, item.label]))

function LockScreen() {
  const unlock = useStore((state) => state.unlock)
  const toast = useStore((state) => state.toast)
  const busy = useStore((state) => state.busy)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  return <main className="lockscreen"><form className="lockscreen__card stack" onSubmit={async (event) => { event.preventDefault(); setError(''); try { await unlock(password); setPassword('') } catch (reason) { const parsed = parseError(reason); setError(parsed.fields.password ?? parsed.message ?? 'Contraseña incorrecta'); toast('No se pudo desbloquear', 'bad') } }}><Lock size={20} /><h1>vfinancy bloqueado</h1><label className="field"><span className="field__label">Contraseña</span><input autoFocus autoComplete="current-password" type="password" className="input" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <small className="field__error">{error}</small>}<button className="btn btn--primary" disabled={busy || !password}>{busy ? 'Desbloqueando…' : 'Desbloquear'}</button></form></main>
}

function Sidebar() {
  const location = useLocation()
  const lock = useStore((state) => state.lock)
  const toast = useStore((state) => state.toast)
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => { document.body.classList.toggle('side-open', mobileOpen); return () => document.body.classList.remove('side-open') }, [mobileOpen])
  return <aside className="side side-sidebar"><NavLink to="/" className="side__brand"><span className="side__brandtxt"><b>vfinancy</b><i>ERP importaciones</i></span></NavLink><nav className="side__nav" aria-label="Navegación principal">{nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('side__item', (isActive || (to !== '/' && location.pathname.startsWith(`${to}/`))) && 'is-active')} title={label} onClick={() => setMobileOpen(false)}><Icon size={16} /><span className="side__label">{label}</span></NavLink>)}</nav><div className="side__foot"><button className="side__item" type="button" title="Bloquear" onClick={async () => { try { await lock() } catch (error) { toast(parseError(error).message ?? 'Configura una contraseña antes de bloquear', 'warn') } }}><Lock size={16} /><span className="side__label">Bloquear</span></button></div></aside>
}

function Shell() {
  const location = useLocation()
  const currency = useStore((state) => state.currency)
  const setCurrency = useStore((state) => state.setCurrency)
  const newAction = useStore((state) => state.newAction)
  const title = Object.entries(titles).find(([path]) => location.pathname === path)?.[1] ?? (location.pathname.startsWith('/clientes/') ? 'Cliente · ficha' : location.pathname.startsWith('/proveedores/') ? 'Proveedor · ficha' : 'Inventario')
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 'm') { event.preventDefault(); setCurrency(currency === 'PEN' ? 'USD' : 'PEN') }
      if (mod && event.key.toLowerCase() === 'n') { event.preventDefault(); newAction?.() }
      if (event.key === 'Escape') { document.body.classList.remove('side-open'); setMobileOpen(false) }
      if (mod && event.key === 'Enter') { const form = (event.target as HTMLElement).closest('form'); if (form instanceof HTMLFormElement) { event.preventDefault(); form.requestSubmit() } }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [currency, setCurrency, newAction])
  useEffect(() => { setMobileOpen(false) }, [location.pathname])
  return <div className="shell shell--grid"><div className={mobileOpen ? 'mobile-shade is-visible' : 'mobile-shade'} onClick={() => setMobileOpen(false)} /><Sidebar /><div className="shell__main"><header className="topbar"><button type="button" className="topbar__burger" aria-label="Abrir menú" onClick={() => setMobileOpen((value) => !value)}><Menu size={18} /></button><div className="topbar__crumb"><span>vfinancy</span><span className="topbar__sep">/</span><b>{title}</b></div><div className="topbar__tools"><Seg label="Moneda de visualización" options={[{ value: 'PEN', label: 'S/' }, { value: 'USD', label: '$' }]} value={currency} onChange={setCurrency} /></div></header><main className="page"><Routes><Route path="/" element={<DashboardPage />} /><Route path="/compras" element={<DocsPage kind="purchase" />} /><Route path="/inventario" element={<InventoryPage />} /><Route path="/inventario/producto/:id" element={<ProductDetailPage />} /><Route path="/ventas" element={<DocsPage kind="sale" />} /><Route path="/envios" element={<DocsPage kind="shipment" />} /><Route path="/tarjetas" element={<CardsPage />} /><Route path="/clientes" element={<ClientsPage />} /><Route path="/clientes/:clientId" element={<ClientsPage />} /><Route path="/proveedores" element={<SuppliersPage />} /><Route path="/proveedores/:supplierId" element={<SuppliersPage />} /><Route path="/ajustes" element={<SettingsPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></main></div><Toasts /></div>
}

export default function App() {
  const initialize = useStore((state) => state.initialize)
  const ready = useStore((state) => state.ready)
  const locked = useStore((state) => state.locked)
  useEffect(() => { void initialize() }, [initialize])
  return <HashRouter>{!ready ? <main className="lockscreen"><div className="lockscreen__card">Iniciando vfinancy…</div></main> : locked ? <LockScreen /> : <Shell />}</HashRouter>
}
