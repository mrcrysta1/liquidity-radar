// Pure helpers for how the terminal presents itself on this device: whether it
// is embedded in the Liquidity Radar host (the Pro tab iframe), the search
// shortcut hint for the platform, and friendly connection / loading labels.

/** Running inside another page's iframe. A cross-origin parent throws on access: also embedded. */
export function isEmbedded(win: { self: unknown; top: unknown } | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!win) return false;
  try { return win.self !== win.top; } catch { return true; }
}

/** Apple platforms use ⌘, everything else Ctrl. */
export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The symbol-search shortcut hint, or '' on touch devices where there is no keyboard to press it on. */
export function searchShortcutLabel(platform: string, touch: boolean): string {
  if (touch) return '';
  return isMacPlatform(platform) ? '⌘K' : 'Ctrl K';
}

export type WsTone = 'ok' | 'pending' | 'bad';

/**
 * The stream status chip. Before the first successful open the socket is just
 * connecting (the store starts at 'closed' before subscribe runs) — say so
 * rather than show "ws closed". After it has been open, a drop is a reconnect.
 */
export function wsStatusLabel(status: string, everOpen: boolean): { text: string; tone: WsTone } {
  if (status === 'open') return { text: 'streaming', tone: 'ok' };
  if (!everOpen) return { text: 'connecting…', tone: 'pending' };
  return { text: 'reconnecting…', tone: 'bad' };
}

/** Header bar-count text: no "0 / 40,000 bars" while the first page is still on its way. */
export function barsLabel(bars: number, maxBars: number, loaded: boolean, loadingMore: boolean, exhausted: boolean): string {
  if (!loaded) return 'loading history…';
  return `${bars.toLocaleString()} / ${maxBars.toLocaleString()} bars${loadingMore ? ' …' : exhausted ? ' (end)' : ''}`;
}
