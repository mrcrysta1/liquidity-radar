export async function getJSON<T>(url: string, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController(); const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return (await r.json()) as T;
  } finally { clearTimeout(id); }
}
export const n = (v: unknown) => Number(v);
