import type { ReactNode } from 'react';
import { Link, usePath } from '../router.tsx';
import { Person } from '../ui/Bits.tsx';
import { EcrIcon } from '../ui/EngineeringIcons.tsx';

export function Shell({ children }: { children: ReactNode }) {
  const path = usePath();
  return (
    <div className="nx">
      <a href="#main-content" className="nx-skip">Skip to content</a>
      <header className="nx-masthead">
        <div className="nx-container nx-masthead-inner">
          <Link to="/" className="nx-brand" aria-label="Fern home">
            <span>Fern</span>
          </Link>
          <nav aria-label="Workspace" className="nx-workspace-nav">
            <Link to="/" aria-current={path === '/' ? 'page' : undefined}><EcrIcon size={18} /> Engineering changes</Link>
          </nav>
          <span className="nx-sp" />
          <span className="nx-tenant">Bowman Aviation</span>
          <Person name="Helen Castellanos" size={28} />
        </div>
      </header>
      <div id="main-content" tabIndex={-1}>{children}</div>
    </div>
  );
}
