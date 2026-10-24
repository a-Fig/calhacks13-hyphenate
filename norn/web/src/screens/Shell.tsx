import type { ReactNode } from 'react';
import { GitPullRequestIcon, RepoIcon } from '@primer/octicons-react';
import { Label, UnderlineNav } from '@primer/react';
import { useEcrList } from '../assessment/source.ts';
import { Link, navigate } from '../router.tsx';
import { isOpen, Person } from '../ui/Bits.tsx';

/** GitHub's global header: the mark, where you are, and your avatar. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="nx">
      <header className="nx-gh">
        <Link to="/" className="nx-gh-logo" aria-label="Norn home">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <rect width="28" height="28" rx="7" fill="currentColor" />
            <path d="M9 20V8l10 12V8" fill="none" stroke="var(--bgColor-emphasis)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
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

/** The band GitHub shows under its header: where you are, and the one tab of this repository. */
export function RepoHeader({ mock = false }: { mock?: boolean }) {
  const { data } = useEcrList();
  const open = (data ?? []).filter(e => isOpen(e.status)).length;
  return (
    <div className="nx-repoband">
      <div className="nx-container">
        <div className="nx-repo">
          <RepoIcon size={16} className="nx-fg-muted" />
          <Link to="/" className="nx-repo-owner">Bowman Aviation</Link>
          <span className="nx-fg-muted">/</span>
          <Link to="/" className="nx-repo-name">Engineering changes</Link>
          <Label variant="secondary">Internal</Label>
          {mock && <Label variant="attention" title="Reviewers, comments and flags are mock; costs are saved runs of the checks">Mock data</Label>}
        </div>
        <UnderlineNav aria-label="Repository" variant="flush">
          <UnderlineNav.Item href="/" icon={GitPullRequestIcon} counter={open} aria-current="page" onSelect={e => { e.preventDefault(); navigate('/'); }}>
            ECRs
          </UnderlineNav.Item>
        </UnderlineNav>
      </div>
    </div>
  );
}
