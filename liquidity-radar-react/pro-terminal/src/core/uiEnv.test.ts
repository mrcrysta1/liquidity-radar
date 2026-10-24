import { describe, it, expect } from 'vitest';
import { isEmbedded, isMacPlatform, searchShortcutLabel, wsStatusLabel, barsLabel } from './uiEnv';

describe('ui environment helpers', () => {
  it('detects being framed by the host app', () => {
    const top = {};
    expect(isEmbedded({ self: top, top })).toBe(false);
    expect(isEmbedded({ self: {}, top })).toBe(true);
    const crossOrigin = { self: {}, get top(): unknown { throw new Error('blocked'); } };
    expect(isEmbedded(crossOrigin)).toBe(true);
    expect(isEmbedded(undefined)).toBe(false);
  });

  it('labels the search shortcut by platform and hides it on touch', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('iPhone')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
    expect(searchShortcutLabel('MacIntel', false)).toBe('⌘K');
    expect(searchShortcutLabel('Win32', false)).toBe('Ctrl K');
    expect(searchShortcutLabel('Linux x86_64', false)).toBe('Ctrl K');
    expect(searchShortcutLabel('Win32', true)).toBe('');
    expect(searchShortcutLabel('iPhone', true)).toBe('');
  });

  it('says connecting before the first open, reconnecting after a drop', () => {
    expect(wsStatusLabel('closed', false)).toEqual({ text: 'connecting…', tone: 'pending' });
    expect(wsStatusLabel('connecting', false)).toEqual({ text: 'connecting…', tone: 'pending' });
    expect(wsStatusLabel('open', false).text).toBe('streaming');
    expect(wsStatusLabel('open', true)).toEqual({ text: 'streaming', tone: 'ok' });
    expect(wsStatusLabel('closed', true)).toEqual({ text: 'reconnecting…', tone: 'bad' });
    expect(wsStatusLabel('connecting', true).text).toBe('reconnecting…');
  });

  it('shows a loading state instead of "0 / max bars" before the first page', () => {
    expect(barsLabel(0, 40000, false, false, false)).toBe('loading history…');
    expect(barsLabel(500, 900, true, false, false)).toBe('500 / 900 bars');
    expect(barsLabel(500, 900, true, true, false)).toBe('500 / 900 bars …');
    expect(barsLabel(500, 900, true, false, true)).toBe('500 / 900 bars (end)');
  });
});
