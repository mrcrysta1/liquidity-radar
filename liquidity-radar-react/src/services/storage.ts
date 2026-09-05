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
  } catch (e) {
    /* ignore quota / private mode */
  }
}
