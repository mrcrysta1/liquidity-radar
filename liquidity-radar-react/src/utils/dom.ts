export const $ = (id: string): HTMLElement | null => document.getElementById(id)

export function showToast(msg: string): void {
  const t = $('toast')
  if (!t) return
  const el = t as HTMLElement & { _h?: ReturnType<typeof setTimeout> }
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(el._h)
  el._h = setTimeout(() => el.classList.remove('show'), 3200)
}

export function openModal(id: string): void {
  const m = $(id)
  if (m) m.classList.add('open')
}

export function closeModal(id: string): void {
  const m = $(id)
  if (m) m.classList.remove('open')
}
