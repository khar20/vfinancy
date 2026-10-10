import { create } from 'zustand'
import { api } from './api'
import type { Currency } from './api'
import { parseError } from '../lib/errors'

export interface Toast { id: number; msg: string; tone: 'ok' | 'info' | 'warn' | 'bad' }
interface AppState {
  settings: Record<string, string>
  currency: Currency
  locked: boolean
  ready: boolean
  busy: boolean
  toasts: Toast[]
  revision: number
  newAction: (() => void) | null
  initialize: () => Promise<void>
  refresh: () => void
  toast: (msg: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void
  setCurrency: (currency: Currency) => void
  setSetting: (key: string, value: string) => Promise<void>
  unlock: (password: string) => Promise<void>
  lock: () => Promise<void>
  configurePassword: (password: string, remember: boolean) => Promise<void>
  registerNew: (action: (() => void) | null) => void
}

export const applyTheme = (theme: string) => {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.classList.toggle('dark', !!dark)
}

let toastId = 0
export const useStore = create<AppState>((set, get) => {
  const loadSettings = async () => {
    const settings = await api.Settings.GetSettings()
    const currency: Currency = settings.display_currency === 'USD' ? 'USD' : 'PEN'
    applyTheme(settings.theme ?? 'system')
    set({ settings, currency, ready: true, locked: false, busy: false })
  }
  return {
    settings: {}, currency: 'PEN', locked: true, ready: false, busy: false, toasts: [], revision: 0, newAction: null,
    initialize: async () => {
      try {
        const locked = await api.Settings.IsLocked()
        if (locked) set({ locked: true, ready: true })
        else await loadSettings()
      } catch (error) {
        set({ ready: true, busy: false })
        get().toast(parseError(error).message ?? 'No se pudo iniciar la aplicación', 'bad')
      }
    },
    refresh: () => set((state) => ({ revision: state.revision + 1 })),
    toast: (msg, tone = 'ok') => {
      const id = ++toastId
      set((state) => ({ toasts: [...state.toasts, { id, msg, tone }] }))
      window.setTimeout(() => get().dismissToast(id), 3600)
    },
    dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
    setCurrency: (currency) => {
      set({ currency })
      void api.Settings.SetSetting('display_currency', currency).then(() => set((state) => ({ settings: { ...state.settings, display_currency: currency } }))).catch((error) => get().toast(parseError(error).message ?? 'No se pudo guardar la moneda', 'bad'))
    },
    setSetting: async (key, value) => {
      await api.Settings.SetSetting(key, value)
      set((state) => ({ settings: { ...state.settings, [key]: value }, ...(key === 'display_currency' ? { currency: value === 'USD' ? 'USD' as const : 'PEN' as const } : {}) }))
      if (key === 'theme') applyTheme(value)
      get().refresh()
    },
    unlock: async (password) => {
      set({ busy: true })
      try { await api.Settings.Unlock(password); await loadSettings() }
      catch (error) { set({ busy: false }); throw error }
    },
    lock: async () => { await api.Settings.Lock(); set({ locked: true }) },
    configurePassword: async (password, remember) => {
      await api.Settings.ConfigurePassword(password, remember)
      await loadSettings()
      get().toast(password ? 'Contraseña guardada. La base y los backups no se cifran.' : 'Contraseña eliminada', 'info')
    },
    registerNew: (newAction) => set({ newAction }),
  }
})
