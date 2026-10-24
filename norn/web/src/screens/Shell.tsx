import type { ReactNode } from 'react';
import { RepoIcon } from '@primer/octicons-react';
import { Label } from '@primer/react';
import { Link } from '../router.tsx';
import { Person } from '../ui/Bits.tsx';

/** GitHub's global header: the mark, where you are, and your avatar. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="nx">
      <header className="nx-gh">
        <Link to="/" className="nx-gh-logo" aria-label="Norn home">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <rect width="28" height="28" rx="7" fill="currentColor" />
            <path d="M9 20V8l10 12V8" fill="none" stroke="var(--bgColor-default)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <nav className="nx-gh-crumbs" aria-label="Breadcrumb">
          <Link to="/">bowman-aviation</Link>
          <span>/</span>
          <Link to="/"><b>vesper</b></Link>
        </nav>
        <span className="nx-sp" />
        {/* A plain link, not in-app: the spike page opens its own database connection. */}
        <a href="/spike" className="nx-gh-link">Spike</a>
        <Person name="Helen Castellanos" size={24} />
      </header>
      {children}
    </div>
  );
}

/** The repository-style title row GitHub shows above its lists and pull requests. */
export function RepoHeader({ mock = false }: { mock?: boolean }) {
  return (
    <div className="nx-repo">
      <RepoIcon size={16} className="nx-fg-muted" />
      <Link to="/" className="nx-repo-owner">Bowman Aviation</Link>
      <span className="nx-fg-muted">/</span>
      <Link to="/" className="nx-repo-name">Engineering changes</Link>
      <Label variant="secondary">Internal</Label>
      {mock && <Label variant="attention">Mock data</Label>}
    </div>
  );
}
