import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { DatabaseBackup, HardDriveDownload, Lock } from 'lucide-react'
import { api } from '../data/api'
import { useStore } from '../data/store'
import { parseError } from '../lib/errors'
import { fmtDate, fmtTc } from '../lib/format'
import { tcFromText, tcText } from '../lib/money'
import { Badge, Field, TextInput, Seg, ViewHead } from '../components/ui'

export function SettingsPage() {
  const settings = useStore((state) => state.settings)
  const currency = useStore((state) => state.currency)
  const setSetting = useStore((state) => state.setSetting)
  const toast = useStore((state) => state.toast)
  const [password, setPassword] = useState('')
  const [fallback, setFallback] = useState(tcText(Number(settings.tc_fallback ?? 37500)))
  const [countdown, setCountdown] = useState(settings.lot_countdown_days ?? '0')
  const [overdue, setOverdue] = useState(settings.overdue_days ?? '30')
  const [backupDir, setBackupDir] = useState(settings.backup_dir ?? '')
  const [backupKeep, setBackupKeep] = useState(settings.backup_keep ?? '14')
  const [backups, setBackups] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [tcMessage, setTcMessage] = useState('')
  useEffect(() => { setFallback(tcText(Number(settings.tc_fallback ?? 37500))); setCountdown(settings.lot_countdown_days ?? '0'); setOverdue(settings.overdue_days ?? '30'); setBackupDir(settings.backup_dir ?? ''); setBackupKeep(settings.backup_keep ?? '14') }, [settings])
  useEffect(() => { void api.System.ListBackups().then(setBackups).catch(() => {}) }, [])

  const saveSetting = async (key: string, value: string) => {
    try { await setSetting(key, value); toast('Configuración guardada') }
    catch (error) { toast(parseError(error).message ?? 'No se pudo guardar la configuración', 'bad') }
  }

  const savePassword = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true)
    try { await useStore.getState().configurePassword(password, settings.remember_me === 'true'); setPassword('') }
    catch (error) { toast(parseError(error).message ?? 'No se pudo guardar la contraseña', 'bad') }
    finally { setBusy(false) }
  }

  const configureRemember = async (checked: boolean) => {
    try { await api.Settings.SetRememberMe(checked); useStore.setState((state) => ({ settings: { ...state.settings, remember_me: String(checked) } })); toast('Preferencia guardada') }
    catch (error) { toast(parseError(error).message ?? 'No se pudo guardar esta preferencia', 'bad') }
  }

  return <><ViewHead title="Ajustes" subtitle="Tema, acceso, TC, cuenta regresiva y respaldos" /><div className="settings__stack">
    <section className="settings__section card"><h2 className="settings__title">Preferencias</h2><div className="settings__formgrid"><Field label="Tema"><Seg options={[{ value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }, { value: 'system', label: 'Automático' }]} value={(settings.theme ?? 'system') as 'light' | 'dark' | 'system'} onChange={(value) => void saveSetting('theme', value)} /></Field><Field label="Moneda por defecto del switch"><Seg options={[{ value: 'PEN', label: 'S/' }, { value: 'USD', label: '$' }]} value={currency} onChange={(value) => void saveSetting('display_currency', value)} /></Field></div></section>
    <section className="settings__section card"><h2 className="settings__title">Acceso</h2>{settings.has_password === 'true' && <div className="hstack"><Lock size={14} /><span>Contraseña activa</span><button className="btn" type="button" onClick={async () => { try { await useStore.getState().configurePassword('', false) } catch (error) { toast(parseError(error).message ?? 'No se pudo quitar la contraseña', 'bad') } }}>Quitar contraseña</button></div>}<form className="settings__saveform" onSubmit={(event) => void savePassword(event)}><Field label={settings.has_password === 'true' ? 'Cambiar contraseña' : 'Nueva contraseña'}><TextInput type="password" minLength={4} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field><button className="btn btn--primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button></form><label className="checkline"><input type="checkbox" checked={settings.remember_me === 'true'} onChange={(event) => void configureRemember(event.target.checked)} /> Recuérdame: abrir desbloqueada cuando hay contraseña</label>{settings.has_password === 'true' && <Badge>La base de datos y los respaldos no se cifran</Badge>}</section>
    <section className="settings__section card"><h2 className="settings__title">Tipo de cambio</h2><div className="settings__formgrid"><Field label="Frecuencia de actualización"><Seg small options={[{value:'manual',label:'Manual'},{value:'1h',label:'1 h'},{value:'6h',label:'6 h'},{value:'12h',label:'12 h'},{value:'24h',label:'24 h'}]} value={settings.tc_refresh ?? '6h'} onChange={(value) => void saveSetting('tc_refresh', value)} /></Field><Field label="TC de respaldo"><TextInput className="input--mono num" inputMode="decimal" value={fallback} onChange={(event) => setFallback(event.target.value)} /></Field><button className="btn" type="button" onClick={() => { const scaled = tcFromText(fallback); if (scaled == null) { toast('Ingresa un TC entre 0.5000 y 20.0000', 'warn'); return } void saveSetting('tc_fallback', String(scaled)) }}>Guardar TC</button></div><div className="settings__facts"><div className="sumrow"><span>Último valor consultado</span><span className="sumrow__v num">{settings.tc_last ? fmtTc(Number(settings.tc_last)) : `— · respaldo ${fallback}`}</span></div><div className="sumrow"><span>Consultado</span><span className="sumrow__v">{settings.tc_last_at ? fmtDate(settings.tc_last_at.slice(0, 10)) : '—'}</span></div></div><div className="hstack"><button className="btn btn--primary" type="button" disabled={busy} onClick={async () => { setBusy(true); try { const rate = await api.Settings.FetchTC(); setTcMessage(`TC consultado: ${tcText(rate)}`); useStore.getState().refresh() } catch (error) { setTcMessage(parseError(error).message ?? 'No se pudo consultar el TC') } finally { setBusy(false) } }}>{busy ? 'Consultando…' : 'Consultar ahora'}</button><span className="muted">TC por defecto vigente: {fmtTc(Number(settings.tc_last ?? settings.tc_fallback ?? 37500))}</span>{tcMessage && <span className="muted">{tcMessage}</span>}</div></section>
    <section className="settings__section card"><h2 className="settings__title">Cálculos</h2><form className="settings__formgrid" onSubmit={(event) => { event.preventDefault(); void saveSetting('lot_countdown_days', countdown); void saveSetting('overdue_days', overdue) }}><Field label="Días de cuenta regresiva global (0 desactiva)"><TextInput type="number" min="0" step="1" value={countdown} onChange={(event) => setCountdown(event.target.value)} /></Field><Field label="Días de atraso" required><TextInput type="number" min="1" step="1" value={overdue} onChange={(event) => setOverdue(event.target.value)} /></Field><button className="btn btn--primary">Guardar cálculos</button></form></section>
    <section className="settings__section card"><h2 className="settings__title">Respaldos</h2><p className="muted">Copia automática al cerrar la aplicación; se conservan los últimos N archivos.</p><form className="settings__backup-form" onSubmit={(event) => { event.preventDefault(); void saveSetting('backup_dir', backupDir); void saveSetting('backup_keep', backupKeep) }}><Field label="Carpeta de respaldo" required><TextInput value={backupDir} onChange={(event) => setBackupDir(event.target.value)} /></Field><Field label="Cantidad de copias" required><TextInput type="number" min="1" max="99" value={backupKeep} onChange={(event) => setBackupKeep(event.target.value)} /></Field><button className="btn">Guardar configuración</button></form><div className="settings__actions"><button className="btn btn--primary" type="button" onClick={async () => { try { await api.System.BackupNow(); setBackups(await api.System.ListBackups()); toast('Respaldo creado') } catch (error) { toast(parseError(error).message ?? 'No se pudo crear el respaldo', 'bad') } }}><HardDriveDownload size={14} /> Respaldar ahora</button></div><div className="backup-list">{backups.length ? backups.map((path) => <div className="listrow backup-list__row" key={path}><span className="listrow__main"><span className="listrow__title"><DatabaseBackup size={13} /> {path.split(/[\\/]/).pop()}</span></span><button className="btn btn--xs" type="button" onClick={async () => { if (!window.confirm(`¿Restaurar ${path.split(/[\\/]/).pop()}?`)) return; try { await api.System.RestoreBackup(path); useStore.getState().refresh(); toast('Respaldo restaurado') } catch (error) { toast(parseError(error).message ?? 'No se pudo restaurar', 'bad') } }}>Restaurar</button></div>) : <div className="empty">Sin respaldos</div>}</div></section>
  </div></>
}
