import type { ReactNode } from 'react';
import { source } from '../assessment/source.ts';
import { NornMark } from '../ui/Bits.tsx';
import { Link, usePath } from '../router.tsx';

export function Shell({ children }: { children: ReactNode }) {
  const path = usePath();
  return (
    <div className="nx">
      <div className="nx-bar">
        <Link to="/" className="nx-brand"><NornMark /> Norn</Link>
        <nav className="nx-nav" aria-label="Main">
          <Link to="/" className={path === '/' ? 'on' : ''}>ECRs</Link>
        </nav>
        <span className="nx-sp" />
        {source.isMock && (
          <span className="nx-mock" title="Numbers are simulated for the demo and shaped like live results">
            <i /> Mock data
          </span>
        )}
        {/* A plain link, not in-app: the spike page opens its own database connection. */}
        <a href="/spike" className="nx-spike">Spike</a>
      </div>
      {children}
    </div>
  );
}
