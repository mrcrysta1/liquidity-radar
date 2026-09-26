// Theme / palette system. Faithful extraction of the engine's
// PALETTES / applyPalette / renderPalettePicker / selectPalette / initTheme
// blocks. Applies user-selectable CSS-variable color combos directly on
// <html> (overrides the :root + light block); palettes carry BOTH dark and
// light color sets and the right set is applied based on the current theme,
// re-applied on theme toggle. Charts read the live CSS variables via
// getComputedStyle so they follow too.
import { applyChartTheme, isLightTheme } from '../charts/chartRender'
import { applyCompanionTheme } from '../charts/companionCharts'
import { mcApplyTheme } from '../charts/multiCharts'
import { applySigAnaTheme } from '../signals'
import { storageGetRaw, storageSetRaw } from '../../services/storage'
import { $, closeModal, openModal } from '../../utils/dom'

export interface Palette {
  id: string
  name: string
  desc: string
  sw: string[]
  /** Tint channels for rgb(var(--xRGB)/a). */
  rgb: Record<string, string>
  /**
   * Tints for light mode, where a palette's accents differ between the two.
   * Without this a warm accent on white picks up the dark mode's tint and the
   * soft backgrounds drift away from the colour they are meant to echo.
   */
  rgbLight?: Record<string, string>
  dark: Record<string, string>
  light: Record<string, string>
}

export const PALETTES: Palette[] = [
  {
    // The house style: warm charcoal surfaces, one orange brand accent, and
    // green / red kept for up / down only. Every text colour is checked
    // against WCAG AA on its card: txt 15.9, muted 7.0, primary 6.9, green
    // 8.2, red 4.8 (dark); txt 16.5, muted 6.6, primary 5.2, green 5.5,
    // red 4.8 (light).
    id: 'ember',
    name: 'Ember',
    desc: 'Warm charcoal, one orange accent — green and red kept for up and down',
    sw: ['#FF7A1A', '#FF4D2E', '#FFB020', '#16C784', '#F0414D'],
    rgb: {
      p: '255,122,26',
      c: '79,209,197',
      g: '22,199,132',
      r: '240,65,77',
      a: '255,176,32',
      u: '255,77,46',
      k: '255,176,32',
    },
    rgbLight: {
      p: '194,65,12',
      c: '15,118,110',
      g: '4,120,87',
      r: '217,45,58',
      a: '180,83,9',
      u: '217,72,15',
      k: '180,83,9',
    },
    dark: {
      bg: '#0B0C0F',
      card: '#14161B',
      card2: '#1A1D23',
      border: '#252932',
      border2: '#333A45',
      primary: '#FF7A1A',
      green: '#16C784',
      red: '#F0414D',
      amber: '#FFB020',
      cyan: '#4FD1C5',
      purple: '#FF4D2E',
      pink: '#FFB020',
      txt: '#EEF0F3',
      muted: '#9AA1AC',
      dim: '#6E7683',
    },
    light: {
      bg: '#F7F5F2',
      card: '#FFFFFF',
      card2: '#FBF9F6',
      border: '#E7E2DB',
      border2: '#D6CEC3',
      primary: '#C2410C',
      green: '#047857',
      red: '#D92D3A',
      amber: '#B45309',
      cyan: '#0F766E',
      purple: '#D9480F',
      pink: '#B45309',
      txt: '#1C1F24',
      muted: '#555E69',
      dim: '#7A828C',
    },
  },
  {
    id: 'galaxy',
    name: 'Galaxy',
    desc: 'Deep space with a sunset nebula — amber on indigo, starfield behind',
    sw: ['#FF8A3D', '#A855F7', '#22D3EE', '#34D399', '#FB7185'],
    rgb: {
      p: '255,138,61',
      c: '34,211,238',
      g: '52,211,153',
      r: '251,113,133',
      a: '251,191,36',
      u: '168,85,247',
      k: '244,114,182',
    },
    rgbLight: {
      p: '249,115,22',
      c: '8,145,178',
      g: '14,159,110',
      r: '225,29,72',
      a: '217,119,6',
      u: '124,58,237',
      k: '219,39,119',
    },
    dark: {
      bg: '#06040F',
      card: '#100B24',
      card2: '#171034',
      border: '#241A45',
      border2: '#3B2B68',
      primary: '#FF8A3D',
      green: '#34D399',
      red: '#FB7185',
      amber: '#FBBF24',
      cyan: '#22D3EE',
      purple: '#A855F7',
      pink: '#F472B6',
      txt: '#EFEAFB',
      muted: '#A99FC9',
      dim: '#6F6494',
    },
    light: {
      bg: '#FAF7FF',
      card: '#FFFFFF',
      card2: '#F7F3FF',
      border: '#E8E0F7',
      border2: '#CFC0EC',
      primary: '#F97316',
      green: '#0E9F6E',
      red: '#E11D48',
      amber: '#D97706',
      cyan: '#0891B2',
      purple: '#7C3AED',
      pink: '#DB2777',
      txt: '#241A38',
      muted: '#6B5E85',
      dim: '#9A8CB5',
    },
  },
  {
    id: 'solar',
    name: 'Solar Orange',
    desc: 'Warm amber on clean white — bright, calm, easy on long sessions',
    sw: ['#F97316', '#0D9488', '#7C3AED', '#0E9F6E', '#E02424'],
    rgb: {
      p: '255,138,61',
      c: '45,212,191',
      g: '34,197,94',
      r: '255,77,77',
      a: '255,176,32',
      u: '192,132,252',
      k: '251,113,133',
    },
    rgbLight: {
      p: '249,115,22',
      c: '13,148,136',
      g: '14,159,110',
      r: '224,36,36',
      a: '217,119,6',
      u: '124,58,237',
      k: '219,39,119',
    },
    dark: {
      bg: '#120D0A',
      card: '#1C1411',
      card2: '#241A15',
      border: '#34251D',
      border2: '#4A3327',
      primary: '#FF8A3D',
      green: '#22C55E',
      red: '#FF4D4D',
      amber: '#FFB020',
      cyan: '#2DD4BF',
      purple: '#C084FC',
      pink: '#FB7185',
      txt: '#F7EDE6',
      muted: '#BBA396',
      dim: '#8A7263',
    },
    light: {
      bg: '#FBF7F4',
      card: '#FFFFFF',
      card2: '#FFF7F1',
      border: '#EFE0D5',
      border2: '#DCC3B1',
      primary: '#F97316',
      green: '#0E9F6E',
      red: '#E02424',
      amber: '#D97706',
      cyan: '#0D9488',
      purple: '#7C3AED',
      pink: '#DB2777',
      txt: '#2A1C14',
      muted: '#79655A',
      dim: '#A89081',
    },
  },
  {
    id: 'classic',
    name: 'Navy Classic',
    desc: 'Current look — trusty deep blue on near-black',
    sw: ['#2962FF', '#00E5FF', '#B388FF', '#00E676', '#FF1744'],
    rgb: {
      p: '41,98,255',
      c: '0,229,255',
      g: '0,230,118',
      r: '255,23,68',
      a: '255,179,0',
      u: '179,136,255',
      k: '255,64,129',
    },
    dark: {
      bg: '#060B18',
      card: '#0D1628',
      card2: '#101C33',
      border: '#1A2D4A',
      border2: '#22385E',
      primary: '#2962FF',
      green: '#00E676',
      red: '#FF1744',
      amber: '#FFB300',
      cyan: '#00E5FF',
      purple: '#B388FF',
      pink: '#FF4081',
      txt: '#E8EEF9',
      muted: '#8FA3BF',
      dim: '#5A6E8F',
    },
    light: {
      bg: '#F0F2F5',
      card: '#FFFFFF',
      card2: '#F8F9FA',
      border: '#D1D5DB',
      border2: '#9CA3AF',
      primary: '#2563EB',
      green: '#16A34A',
      red: '#DC2626',
      amber: '#D97706',
      cyan: '#0891B2',
      purple: '#7C3AED',
      pink: '#DB2777',
      txt: '#1F2937',
      muted: '#6B7280',
      dim: '#9CA3AF',
    },
  },
  {
    id: 'cyber',
    name: 'Cyber Gold',
    desc: 'Premium black &amp; gold — wealth instinct, luxurious fintech',
    sw: ['#F0B90B', '#22D3EE', '#A78BFA', '#34D399', '#F87171'],
    rgb: {
      p: '240,185,11',
      c: '34,211,238',
      g: '52,211,153',
      r: '248,113,113',
      a: '251,146,60',
      u: '167,139,250',
      k: '244,114,182',
    },
    dark: {
      bg: '#07090F',
      card: '#0D1017',
      card2: '#131722',
      border: '#1B2233',
      border2: '#262F45',
      primary: '#F0B90B',
      green: '#34D399',
      red: '#F87171',
      amber: '#FB923C',
      cyan: '#22D3EE',
      purple: '#A78BFA',
      pink: '#F472B6',
      txt: '#F1F5F9',
      muted: '#94A3B8',
      dim: '#556078',
    },
    light: {
      bg: '#F7F8FA',
      card: '#FFFFFF',
      card2: '#F9FAFB',
      border: '#D7DCE3',
      border2: '#A9B0BC',
      primary: '#C9930A',
      green: '#059669',
      red: '#DC2626',
      amber: '#D97706',
      cyan: '#0E7490',
      purple: '#7C3AED',
      pink: '#DB2777',
      txt: '#16181D',
      muted: '#5D6572',
      dim: '#9AA1AD',
    },
  },
  {
    id: 'indigo',
    name: 'Deep Indigo',
    desc: 'Calm trust + electric violet — easy on the eyes, AI / analytics feel',
    sw: ['#6366F1', '#8B5CF6', '#22D3EE', '#10B981', '#F43F5E'],
    rgb: {
      p: '99,102,241',
      c: '34,211,238',
      g: '16,185,129',
      r: '244,63,94',
      a: '245,158,11',
      u: '139,92,246',
      k: '236,72,153',
    },
    dark: {
      bg: '#0B0E1A',
      card: '#12162A',
      card2: '#171C33',
      border: '#232A4A',
      border2: '#2F3760',
      primary: '#6366F1',
      green: '#10B981',
      red: '#F43F5E',
      amber: '#F59E0B',
      cyan: '#22D3EE',
      purple: '#8B5CF6',
      pink: '#EC4899',
      txt: '#E7EAF6',
      muted: '#9AA3C0',
      dim: '#5C6585',
    },
    light: {
      bg: '#F4F5FB',
      card: '#FFFFFF',
      card2: '#F8F9FE',
      border: '#D8DBEE',
      border2: '#AEB3D9',
      primary: '#4F46E5',
      green: '#059669',
      red: '#E11D48',
      amber: '#D97706',
      cyan: '#0E7490',
      purple: '#7C3AED',
      pink: '#DB2777',
      txt: '#171A2E',
      muted: '#5B6180',
      dim: '#979DB8',
    },
  },
  {
    id: 'emerald',
    name: 'Emerald Sea',
    desc: 'Growth + calm teal — soothing, subconscious “money growing”',
    sw: ['#10B981', '#2DD4BF', '#A3E635', '#34D399', '#F87171'],
    rgb: {
      p: '16,185,129',
      c: '45,212,191',
      g: '52,211,153',
      r: '248,113,113',
      a: '251,191,36',
      u: '16,185,129',
      k: '244,114,182',
    },
    dark: {
      bg: '#041210',
      card: '#0A1F1D',
      card2: '#0E2825',
      border: '#123733',
      border2: '#1A4A45',
      primary: '#10B981',
      green: '#34D399',
      red: '#F87171',
      amber: '#FBBF24',
      cyan: '#2DD4BF',
      purple: '#34D399',
      pink: '#F472B6',
      txt: '#E6F3F0',
      muted: '#9FBDB8',
      dim: '#5E7A75',
    },
    light: {
      bg: '#F1F8F6',
      card: '#FFFFFF',
      card2: '#F7FBFA',
      border: '#CFE3DE',
      border2: '#9FC4BD',
      primary: '#0E9F6E',
      green: '#059669',
      red: '#DC2626',
      amber: '#D97706',
      cyan: '#0E7490',
      purple: '#0E9F6E',
      pink: '#DB2777',
      txt: '#0F2420',
      muted: '#4E736C',
      dim: '#8AA49F',
    },
  },
  {
    id: 'aurora',
    name: 'Midnight Aurora',
    desc: 'Dusk blue with warm amber — energetic, action-ready',
    sw: ['#F59E0B', '#FB7185', '#38BDF8', '#34D399', '#F87171'],
    rgb: {
      p: '245,158,11',
      c: '56,189,248',
      g: '52,211,153',
      r: '248,113,113',
      a: '251,191,36',
      u: '167,139,250',
      k: '251,113,133',
    },
    dark: {
      bg: '#0A0E1F',
      card: '#121830',
      card2: '#171E3A',
      border: '#242D4E',
      border2: '#303C66',
      primary: '#F59E0B',
      green: '#34D399',
      red: '#F87171',
      amber: '#FBBF24',
      cyan: '#38BDF8',
      purple: '#A78BFA',
      pink: '#FB7185',
      txt: '#EAF0F9',
      muted: '#9AA8C0',
      dim: '#5E6B85',
    },
    light: {
      bg: '#F7F8FC',
      card: '#FFFFFF',
      card2: '#FAFAFD',
      border: '#D9DEEB',
      border2: '#ACB7CC',
      primary: '#D97706',
      green: '#059669',
      red: '#DC2626',
      amber: '#B45309',
      cyan: '#0E7490',
      purple: '#7C3AED',
      pink: '#DB2777',
      txt: '#171B27',
      muted: '#5C6576',
      dim: '#98A0B0',
    },
  },
]

export function activePalette(): Palette {
  return PALETTES.find((p) => p.id === storageGetRaw(PALETTE_KEY)) || PALETTES[0]
}

/** v2: the Ember redesign — moving the key shows it to everyone once. */
const PALETTE_KEY = 'lr-palette-v2'

export function applyPalette(id: string): void {
  const p = PALETTES.find((x) => x.id === id) || PALETTES[0]
  storageSetRaw(PALETTE_KEY, p.id)
  // Lets the stylesheet give a palette its own backdrop (see html[data-palette]).
  document.documentElement.dataset.palette = p.id
  const light = isLightTheme()
  const s = light ? p.light : p.dark
  const root = document.documentElement
  ;[
    'bg',
    'card',
    'card2',
    'border',
    'border2',
    'primary',
    'green',
    'red',
    'amber',
    'cyan',
    'purple',
    'pink',
    'txt',
    'muted',
    'dim',
  ].forEach(function (k) {
    root.style.setProperty('--' + k, s[k])
  })
  const tint = (light && p.rgbLight ? p.rgbLight : p.rgb) as Record<string, string>
  if (tint) {
    const rgbmap: Record<string, string> = {
      pRGB: tint.p,
      cRGB: tint.c,
      gRGB: tint.g,
      rRGB: tint.r,
      aRGB: tint.a,
      uRGB: tint.u,
      kRGB: tint.k,
    }
    Object.keys(rgbmap).forEach(function (k) {
      root.style.setProperty('--' + k, String(rgbmap[k]).replace(/,/g, ' '))
    })
  }
  applyChartTheme()
  applyCompanionTheme()
  mcApplyTheme()
  applySigAnaTheme()
  renderPalettePicker()
  const meta = document.querySelector('meta[name=theme-color]')
  if (meta) meta.setAttribute('content', s.bg)
}

export function renderPalettePicker(): void {
  const box = $('palGrid')
  if (!box) return
  const cur = activePalette().id
  box.innerHTML = PALETTES.map(function (p) {
    return (
      '<div class="pal-card' +
      (p.id === cur ? ' active' : '') +
      '" onclick="selectPalette(\'' +
      p.id +
      '\')">' +
      '<div class="pal-sw">' +
      p.sw
        .map(function (c) {
          return '<i style="background:' + c + '"></i>'
        })
        .join('') +
      '</div><div class="pal-info"><div class="pal-name">' +
      p.name +
      '</div><div class="pal-desc">' +
      p.desc +
      '</div></div></div>'
    )
  }).join('')
}

export function selectPalette(id: string): void {
  applyPalette(id)
  closeModal('thModal')
}

export function initTheme(): void {
  // The theme attribute has to land before the palette is applied: applyPalette
  // writes its variables inline on <html>, which outranks the [data-theme]
  // stylesheet, so choosing the wrong set here cannot be corrected afterwards.
  // Dark is the default; light is the opt-in.
  const saved = storageGetRaw('lr-theme')
  if (saved === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
  }
  applyPalette(storageGetRaw(PALETTE_KEY) || 'ember')
  $('paletteBtn')!.addEventListener('click', function () {
    renderPalettePicker()
    openModal('thModal')
  })
  $('themeBtn')!.addEventListener('click', function () {
    const cur = document.documentElement.getAttribute('data-theme')
    if (cur === 'light') {
      document.documentElement.removeAttribute('data-theme')
      storageSetRaw('lr-theme', 'dark')
    } else {
      document.documentElement.setAttribute('data-theme', 'light')
      storageSetRaw('lr-theme', 'light')
    }
    applyPalette(activePalette().id)
  })
}
