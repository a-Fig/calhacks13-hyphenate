import type { ReactNode } from 'react';
import { CounterLabel, Label } from '@primer/react';
import { source, useEcrList } from '../assessment/source.ts';
import { Link, usePath } from '../router.tsx';
import { isOpen, Person } from '../ui/Bits.tsx';
import { AircraftIcon, EcrIcon, NornMark } from '../ui/icons.tsx';

/** Norn's global header: Norn logo and wordmark, deployment context, ECR navigation, and user avatar. */
export function Shell({ children }: { children: ReactNode }) {
  const { data } = useEcrList();
  const open = (data ?? []).filter(e => isOpen(e.status)).length;
  const path = usePath();
  const onList = path === '/' || path === '';

  return (
    <div className="nx">
      <header className="nx-gh">
        <Link to="/" className="nx-gh-logo" aria-label="Norn home">
          <NornMark size={28} />
          <span className="nx-gh-wordmark">NORN</span>
        </Link>
        <span className="nx-gh-sep" aria-hidden="true" />
        <div className="nx-gh-org">
          <AircraftIcon size={15} className="nx-gh-org-icon" />
          <span className="nx-gh-org-name">Bowman Aviation</span>
          <span className="nx-gh-org-sub">Engineering Change Control</span>
        </div>
        <nav className="nx-gh-nav" aria-label="Primary">
          <Link to="/" className={`nx-gh-navlink ${onList ? 'active' : ''}`}>
            <EcrIcon size={15} />
            <span>ECRs</span>
            <CounterLabel>{open}</CounterLabel>
          </Link>
        </nav>
        <span className="nx-sp" />
        {source.isMock && (
          <Label variant="attention" size="small" className="nx-gh-mock" title="Reviewers, comments and flags are mock; costs are saved runs of the checks">
            Mock data
          </Label>
        )}
        <a href="/spike" className="nx-gh-link">Spike</a>
        <Person name="Helen Castellanos" size={26} />
      </header>
      {children}
    </div>
  );
}