/** Migra uma key de localStorage legada → namespaced (uma vez). */
export function migrateLocalStorageKey(from: string, to: string) {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(from)
    if (!raw) return
    if (!localStorage.getItem(to)) {
      localStorage.setItem(to, raw)
    }
    localStorage.removeItem(from)
  } catch {
    /* ignore */
  }
}
