// Told about every settings write, so a signed-in user's settings can be
// saved to their account (see features/auth/sync.ts).
let writeHook: ((key: string) => void) | null = null
export function setStorageWriteHook(fn: ((key: string) => void) | null): void {
  writeHook = fn
}

export function storageGetRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch (e) {
    return null
  }
}

export function storageSetRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
    writeHook?.(key)
  } catch (e) {
    /* ignore quota / private mode */
  }
}

export function storageGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch (e) {
    return fallback
  }
}

export function storageSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    writeHook?.(key)
  } catch (e) {
    /* ignore quota / private mode */
  }
}
