// Theme / palette system. Faithful extraction of the engine's
// PALETTES / applyPalette / renderPalettePicker / selectPalette / initTheme
// blocks. Applies user-selectable CSS-variable color combos directly on
// <html> (overrides the :root + light block); palettes carry BOTH dark and
// light color sets and the right set is applied based on the current theme,
// re-applied on theme toggle. Charts read the live CSS variables via
// getComputedStyle so they follow too.
import { applyChartTheme, isLightTheme } from '../charts/chartRender'
import { mcApplyTheme } from '../charts/multiCharts'
import { applySigAnaTheme } from '../signals'
import { storageGetRaw, storageSetRaw } from '../../services/storage'
import { $, closeModal, openModal } from '../../utils/dom'

export interface Palette {
  id: string
  name: string
  desc: string
  sw: string[]
  rgb: Record<string, string>
  dark: Record<string, string>
  light: Record<string, string>
}

export const PALETTES: Palette[] = [
  {id:'classic',name:'Navy Classic',desc:'Current look — trusty deep blue on near-black',
   sw:['#2962FF','#00E5FF','#B388FF','#00E676','#FF1744'],
   rgb:{p:'41,98,255',c:'0,229,255',g:'0,230,118',r:'255,23,68',a:'255,179,0',u:'179,136,255',k:'255,64,129'},
   dark:{bg:'#060B18',card:'#0D1628',card2:'#101C33',border:'#1A2D4A',border2:'#22385E',primary:'#2962FF',green:'#00E676',red:'#FF1744',amber:'#FFB300',cyan:'#00E5FF',purple:'#B388FF',pink:'#FF4081',txt:'#E8EEF9',muted:'#8FA3BF',dim:'#5A6E8F'},
   light:{bg:'#F0F2F5',card:'#FFFFFF',card2:'#F8F9FA',border:'#D1D5DB',border2:'#9CA3AF',primary:'#2563EB',green:'#16A34A',red:'#DC2626',amber:'#D97706',cyan:'#0891B2',purple:'#7C3AED',pink:'#DB2777',txt:'#1F2937',muted:'#6B7280',dim:'#9CA3AF'}},
  {id:'cyber',name:'Cyber Gold',desc:'Premium black &amp; gold — wealth instinct, luxurious fintech',
   sw:['#F0B90B','#22D3EE','#A78BFA','#34D399','#F87171'],
   rgb:{p:'240,185,11',c:'34,211,238',g:'52,211,153',r:'248,113,113',a:'251,146,60',u:'167,139,250',k:'244,114,182'},
   dark:{bg:'#07090F',card:'#0D1017',card2:'#131722',border:'#1B2233',border2:'#262F45',primary:'#F0B90B',green:'#34D399',red:'#F87171',amber:'#FB923C',cyan:'#22D3EE',purple:'#A78BFA',pink:'#F472B6',txt:'#F1F5F9',muted:'#94A3B8',dim:'#556078'},
   light:{bg:'#F7F8FA',card:'#FFFFFF',card2:'#F9FAFB',border:'#D7DCE3',border2:'#A9B0BC',primary:'#C9930A',green:'#059669',red:'#DC2626',amber:'#D97706',cyan:'#0E7490',purple:'#7C3AED',pink:'#DB2777',txt:'#16181D',muted:'#5D6572',dim:'#9AA1AD'}},
  {id:'indigo',name:'Deep Indigo',desc:'Calm trust + electric violet — easy on the eyes, AI / analytics feel',
   sw:['#6366F1','#8B5CF6','#22D3EE','#10B981','#F43F5E'],
   rgb:{p:'99,102,241',c:'34,211,238',g:'16,185,129',r:'244,63,94',a:'245,158,11',u:'139,92,246',k:'236,72,153'},
   dark:{bg:'#0B0E1A',card:'#12162A',card2:'#171C33',border:'#232A4A',border2:'#2F3760',primary:'#6366F1',green:'#10B981',red:'#F43F5E',amber:'#F59E0B',cyan:'#22D3EE',purple:'#8B5CF6',pink:'#EC4899',txt:'#E7EAF6',muted:'#9AA3C0',dim:'#5C6585'},
   light:{bg:'#F4F5FB',card:'#FFFFFF',card2:'#F8F9FE',border:'#D8DBEE',border2:'#AEB3D9',primary:'#4F46E5',green:'#059669',red:'#E11D48',amber:'#D97706',cyan:'#0E7490',purple:'#7C3AED',pink:'#DB2777',txt:'#171A2E',muted:'#5B6180',dim:'#979DB8'}},
  {id:'emerald',name:'Emerald Sea',desc:'Growth + calm teal — soothing, subconscious “money growing”',
   sw:['#10B981','#2DD4BF','#A3E635','#34D399','#F87171'],
   rgb:{p:'16,185,129',c:'45,212,191',g:'52,211,153',r:'248,113,113',a:'251,191,36',u:'16,185,129',k:'244,114,182'},
   dark:{bg:'#041210',card:'#0A1F1D',card2:'#0E2825',border:'#123733',border2:'#1A4A45',primary:'#10B981',green:'#34D399',red:'#F87171',amber:'#FBBF24',cyan:'#2DD4BF',purple:'#34D399',pink:'#F472B6',txt:'#E6F3F0',muted:'#9FBDB8',dim:'#5E7A75'},
   light:{bg:'#F1F8F6',card:'#FFFFFF',card2:'#F7FBFA',border:'#CFE3DE',border2:'#9FC4BD',primary:'#0E9F6E',green:'#059669',red:'#DC2626',amber:'#D97706',cyan:'#0E7490',purple:'#0E9F6E',pink:'#DB2777',txt:'#0F2420',muted:'#4E736C',dim:'#8AA49F'}},
  {id:'aurora',name:'Midnight Aurora',desc:'Dusk blue with warm amber — energetic, action-ready',
   sw:['#F59E0B','#FB7185','#38BDF8','#34D399','#F87171'],
   rgb:{p:'245,158,11',c:'56,189,248',g:'52,211,153',r:'248,113,113',a:'251,191,36',u:'167,139,250',k:'251,113,133'},
   dark:{bg:'#0A0E1F',card:'#121830',card2:'#171E3A',border:'#242D4E',border2:'#303C66',primary:'#F59E0B',green:'#34D399',red:'#F87171',amber:'#FBBF24',cyan:'#38BDF8',purple:'#A78BFA',pink:'#FB7185',txt:'#EAF0F9',muted:'#9AA8C0',dim:'#5E6B85'},
   light:{bg:'#F7F8FC',card:'#FFFFFF',card2:'#FAFAFD',border:'#D9DEEB',border2:'#ACB7CC',primary:'#D97706',green:'#059669',red:'#DC2626',amber:'#B45309',cyan:'#0E7490',purple:'#7C3AED',pink:'#DB2777',txt:'#171B27',muted:'#5C6576',dim:'#98A0B0'}}
]

export function activePalette(): Palette {
  return PALETTES.find((p) => p.id === storageGetRaw('lr-palette')) || PALETTES[0]
}

export function applyPalette(id: string): void {
  const p = PALETTES.find((x) => x.id === id) || PALETTES[0]
  storageSetRaw('lr-palette', p.id)
  const s = isLightTheme() ? p.light : p.dark
  const root = document.documentElement
  ;['bg','card','card2','border','border2','primary','green','red','amber','cyan','purple','pink','txt','muted','dim'].forEach(function(k){
    root.style.setProperty('--'+k,s[k])
  })
  if (p.rgb) {
    const rgbmap: Record<string, string> = {pRGB:p.rgb.p,cRGB:p.rgb.c,gRGB:p.rgb.g,rRGB:p.rgb.r,aRGB:p.rgb.a,uRGB:p.rgb.u,kRGB:p.rgb.k}
    Object.keys(rgbmap).forEach(function(k){root.style.setProperty('--'+k,String(rgbmap[k]).replace(/,/g,' '))})
  }
  applyChartTheme()
  mcApplyTheme()
  applySigAnaTheme()
  renderPalettePicker()
  const meta = document.querySelector('meta[name=theme-color]')
  if (meta) meta.setAttribute('content', s.bg)
}

export function renderPalettePicker(): void {
  const box = $('palGrid'); if (!box) return
  const cur = activePalette().id
  box.innerHTML = PALETTES.map(function(p){
    return '<div class="pal-card'+(p.id===cur?' active':'')+'" onclick="selectPalette(\''+p.id+'\')">'
      +'<div class="pal-sw">'+p.sw.map(function(c){return'<i style="background:'+c+'"></i>'}).join('')
      +'</div><div class="pal-info"><div class="pal-name">'+p.name+'</div><div class="pal-desc">'+p.desc+'</div></div></div>'
  }).join('')
}

export function selectPalette(id: string): void {
  applyPalette(id)
  closeModal('thModal')
}

export function initTheme(): void {
  const savedPal = storageGetRaw('lr-palette') || 'classic'
  applyPalette(savedPal)
  const saved = storageGetRaw('lr-theme')
  if (saved === 'light') { document.documentElement.setAttribute('data-theme','light'); $('themeBtn')!.textContent = 'L' }
  $('paletteBtn')!.addEventListener('click', function () { renderPalettePicker(); openModal('thModal') })
  $('themeBtn')!.addEventListener('click', function () {
    const cur = document.documentElement.getAttribute('data-theme')
    if (cur === 'light') {
      document.documentElement.removeAttribute('data-theme')
      storageSetRaw('lr-theme','dark')
      $('themeBtn')!.textContent = 'D'
    } else {
      document.documentElement.setAttribute('data-theme','light')
      storageSetRaw('lr-theme','light')
      $('themeBtn')!.textContent = 'L'
    }
    applyPalette(activePalette().id)
  })
}