import type { Envelope } from '@/core/providers/types';
export function Badge({ env, now = Date.now() }: { env?: Envelope<unknown>; now?: number }) {
  if (!env) return <span className="badge">loading</span>;
  const age = Math.round((now - env.ts) / 1000);
  const f = env.freshness === 'LIVE' && age > 30 ? 'DELAYED' : env.freshness;
  return <><span className={`badge ${f}`} title={env.error ?? ''}>{f}{age > 5 ? ` ${age}s` : ''}</span><span className="provider">{env.provider}</span></>;
}
