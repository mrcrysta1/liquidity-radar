import type { ReactNode } from 'react';
export function Panel({ title, right, children, tight, foot, flat }: { title: string; right?: ReactNode; children: ReactNode; tight?: boolean; foot?: ReactNode; flat?: boolean }) {
  return (
    <section className={`panel${flat ? ' flat' : ''}`} aria-label={title}>
      {!flat && <header>{title}<span className="spacer" />{right}</header>}
      {flat && right && <div className="panel-tools">{right}</div>}
      <div className={`body${tight ? ' tight' : ''}`}>{children}</div>
      {foot && <div className="disclaimer">{foot}</div>}
    </section>
  );
}
