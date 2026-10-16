import { registerSW } from 'virtual:pwa-register'

let snapshot = { offlineReady: false, updateAvailable: false, error: false }
const listeners = new Set<() => void>()
let editing = false
let reloadRequested = false
let started = false
let activateUpdate: ReturnType<typeof registerSW> | undefined

function publish(values: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...values }
  listeners.forEach((listener) => listener())
}

export const pwa = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  getSnapshot: () => snapshot,
  setEditing(value: boolean) { editing = value },
  start() {
    if (started || !import.meta.env.PROD) return
    started = true
    activateUpdate = registerSW({
      immediate: true,
      onOfflineReady: () => publish({ offlineReady: true }),
      onNeedRefresh: () => publish({ updateAvailable: true }),
      // Another tab may activate a worker. Reload only with consent in THIS tab.
      onNeedReload: () => {
        if (reloadRequested && !editing) window.location.reload()
        else publish({ updateAvailable: true })
      },
      onRegisterError: () => publish({ error: true }),
    })
  },
  async update() {
    if (editing || !activateUpdate) return
    reloadRequested = true
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      if (editing) { reloadRequested = false; return }
      if (!registration?.waiting) window.location.reload()
      else await activateUpdate()
    } catch {
      reloadRequested = false
      publish({ error: true })
    }
  },
}
