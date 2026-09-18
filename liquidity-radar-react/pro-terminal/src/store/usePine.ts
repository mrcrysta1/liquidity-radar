import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export interface UserScript { id: string; name: string; script: string; updatedAt: number }
interface PineState { scripts: UserScript[]; save: (name: string, script: string, id?: string) => UserScript; remove: (id: string) => void }
export const usePine = create<PineState>()(persist((set, get) => ({
  scripts: [],
  save: (name, script, id) => { const existing = id ? get().scripts.find(s => s.id === id) : undefined; const item: UserScript = { id: existing?.id ?? `us-${Date.now()}`, name, script, updatedAt: Date.now() };
    set(s => ({ scripts: existing ? s.scripts.map(x => (x.id === item.id ? item : x)) : [item, ...s.scripts] })); return item; },
  remove: id => set(s => ({ scripts: s.scripts.filter(x => x.id !== id) })),
}), { name: 'liquidity-radar-pine-v1' }));
