import { useMemo, useState } from 'react';
import {
  AlertFillIcon, CheckCircleFillIcon, CommentIcon, DotFillIcon, SearchIcon,
} from '@primer/octicons-react';
import { ActionList, ActionMenu, AvatarStack, CounterLabel, Label, TextInput } from '@primer/react';
import { useEcrList } from '../assessment/source.ts';
import type { EcrSummary } from '../assessment/types.ts';
import { DrawingStamp, isOpen, LevelLabel, Person, StateIcon } from '../ui/Bits.tsx';
import { AircraftIcon, EcoStampIcon, EcrIcon } from '../ui/icons.tsx';
import { ago, usdK } from '../ui/fmt.ts';
import { Link, navigate } from '../router.tsx';

type Pick1 = string | null;

function reviewText(e: EcrSummary): string {
  if (e.status === 'ECO released') return 'ECO released';
  if (e.status === 'Approved') return 'Approved';
  const r = e.reviewers ?? [];
  if (!r.length) return 'Review required';
  const done = r.filter(x => x.state === 'approved').length;
  return done ? `Review required \u00b7 ${done} of ${r.length} approved` : 'Review required';
}

function Filter({ label, options, value, onChange }: { label: string; options: string[]; value: Pick1; onChange: (v: Pick1) => void }) {
  return (
    <ActionMenu>
      <ActionMenu.Button variant="invisible" size="small" className={value ? 'nx-filter on' : 'nx-filter'}>
        {value ? `${label}: ${value}` : label}
      </ActionMenu.Button>
      <ActionMenu.Overlay width="small">
        <ActionList selectionVariant="single">
          <ActionList.Item selected={value === null} onSelect={() => onChange(null)}>Any</ActionList.Item>
          <ActionList.Divider />
          {options.map(o => (
            <ActionList.Item key={o} selected={value === o} onSelect={() => onChange(o)}>{o}</ActionList.Item>
          ))}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  );
}

const SORTS = ['Newest', 'Oldest', 'Largest cost', 'Recently updated'] as const;
const PROGRAMS = ['Vesper', 'Meridian'];
const CLASSES = ['Class I', 'Class II'];
const LEVELS = ['Level 1', 'Level 2', 'Level 3'];
const APPROVALS = ['Review required', 'Approved'];

export function EcrList() {
  const { data: loaded, error } = useEcrList();
  const all = useMemo(() => loaded ?? [], [loaded]);
  const [query, setQuery] = useState('is:open');
  const [who, setWho] = useState<Pick1>(null);
  const [program, setProgram] = useState<Pick1>(null);
  const [cls, setCls] = useState<Pick1>(null);
  const [level, setLevel] = useState<Pick1>(null);
  const [approvals, setApprovals] = useState<Pick1>(null);
  const [sort, setSort] = useState<(typeof SORTS)[number]>('Newest');

  const state = /\bis:closed\b/.test(query) ? 'closed' : /\bis:open\b/.test(query) ? 'open' : 'any';
  const text = query.replace(/\bis:(open|closed)\b/g, '').trim().toLowerCase();
  const setState = (s: 'open' | 'closed') => setQuery(`is:${s}${text ? ' ' + text : ''}`);

  const nOpen = all.filter(e => isOpen(e.status)).length;
  const nClosed = all.length - nOpen;

  const rows = useMemo(() => {
    const matches = all.filter(e => {
      if (state === 'open' && !isOpen(e.status)) return false;
      if (state === 'closed' && isOpen(e.status)) return false;
      if (who && e.originator !== who) return false;
      if (program && e.program !== program) return false;
      if (cls && `Class ${e.companyClass}` !== cls) return false;
      if (level && `Level ${e.level}` !== level) return false;
      if (approvals) {
        const r = e.reviewers ?? [];
        const done = r.length > 0 && r.every(x => x.state === 'approved');
        if (approvals === 'Approved' && !done) return false;
        if (approvals === 'Review required' && done) return false;
      }
      if (text && !`${e.id} ${e.title} ${e.originator}`.toLowerCase().includes(text)) return false;
      return true;
    });
    return matches.sort((a, b) => {
      if (sort === 'Oldest') return a.id.localeCompare(b.id);
      if (sort === 'Largest cost') return Math.abs(b.cost?.p50 ?? 0) - Math.abs(a.cost?.p50 ?? 0);
      if (sort === 'Recently updated') return b.lastActivity.localeCompare(a.lastActivity);
      return b.id.localeCompare(a.id);
    });
  }, [all, state, who, program, cls, level, approvals, text, sort]);

  const people = [...new Set(all.map(e => e.originator))].sort();

  return (
    <main className="nx-container nx-list">
      <div className="nx-list-head">
        <div>
          <h2 className="nx-list-title">Engineering Change Requests</h2>
          <p className="nx-fg-muted nx-small">Production baseline impact assessments across Vesper and Meridian programs</p>
        </div>
        <div className="nx-program-pills" role="group" aria-label="Filter by aircraft program">
          {PROGRAMS.map(p => (
            <button
              key={p}
              type="button"
              className={`nx-prog-pill ${program === p ? 'on' : ''}`}
              onClick={() => setProgram(program === p ? null : p)}
            >
              <AircraftIcon size={13} />
              <span>{p}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="nx-searchbar">
        <TextInput
          block
          leadingVisual={SearchIcon}
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Search ECRs"
          placeholder="Search all ECRs"
        />
      </div>

      <div className="nx-box" data-testid="ecr-table">
        <div className="nx-box-head">
          <div className="nx-states">
            <button type="button" className={`nx-state ${state === 'open' ? 'on' : ''}`} onClick={() => setState('open')}>
              <EcrIcon size={16} className="nx-fg-open" /> Open <CounterLabel>{nOpen}</CounterLabel>
            </button>
            <button type="button" className={`nx-state ${state === 'closed' ? 'on' : ''}`} onClick={() => setState('closed')}>
              <EcoStampIcon size={16} className="nx-fg-done" /> Closed <CounterLabel>{nClosed}</CounterLabel>
            </button>
          </div>
          <span className="nx-sp" />
          <div className="nx-filters">
            <Filter label="Originator" options={people} value={who} onChange={setWho} />
            <Filter label="Label" options={LEVELS} value={level} onChange={setLevel} />
            <Filter label="Program" options={PROGRAMS} value={program} onChange={setProgram} />
            <Filter label="Class" options={CLASSES} value={cls} onChange={setCls} />
            <Filter label="Approvals" options={APPROVALS} value={approvals} onChange={setApprovals} />
            <ActionMenu>
              <ActionMenu.Button variant="invisible" size="small" className="nx-filter">Sort</ActionMenu.Button>
              <ActionMenu.Overlay width="small">
                <ActionList selectionVariant="single">
                  {SORTS.map(s => (
                    <ActionList.Item key={s} selected={sort === s} onSelect={() => setSort(s)}>{s}</ActionList.Item>
                  ))}
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          </div>
        </div>

        <ul className="nx-rows">
          {rows.map(e => (
            <li key={e.id} className="nx-row" data-testid={`row-${e.id}`} onClick={() => navigate(`/ecr/${e.id}`)}>
              <span className="nx-row-state"><StateIcon status={e.status} /></span>
              <div className="nx-row-main">
                <div className="nx-row-title">
                  <DrawingStamp id={e.id} compact />
                  <Link to={`/ecr/${e.id}`} className="nx-row-link" onClick={ev => ev.stopPropagation()}>{e.title}</Link>
                  <span className="nx-row-labels">
                    <span className="nx-prog-tag"><AircraftIcon size={12} /> {e.program}</span>
                    <Label variant="secondary">Class {e.companyClass}</Label>
                    {e.priority !== 'Routine' && <Label variant="severe">{e.priority}</Label>}
                    {e.level && <LevelLabel level={e.level} />}
                  </span>
                </div>
                <div className="nx-row-sub">
                  {e.partNumber && <><code className="nx-part-inline">{e.partNumber}</code> &middot; </>}
                  filed {ago(e.filedOn + 'T12:00:00-07:00')} by {e.originator} &middot; {reviewText(e)}
                  {e.flag && isOpen(e.status) && (
                    <span className="nx-flag"> &middot; <AlertFillIcon size={12} className="nx-fg-attention" /> {e.flag}</span>
                  )}
                </div>
              </div>
              <div className="nx-row-right">
                <span className="nx-row-check">
                  {e.checks === 'passed' && <CheckCircleFillIcon size={16} className="nx-fg-success" aria-label="Checks passed" />}
                  {e.checks === 'attention' && <DotFillIcon size={16} className="nx-fg-attention" aria-label="A check needs attention" />}
                  {e.checks === 'running' && <DotFillIcon size={16} className="nx-fg-attention" aria-label="Checks running" />}
                </span>
                <span className="nx-row-av">
                  {e.reviewers && e.reviewers.length > 0 && (
                    <AvatarStack alignRight>
                      {e.reviewers.slice(0, 3).map(r => (
                        <Person key={r.name} name={r.name} kind={r.name === 'Norn' ? 'norn' : 'person'} size={20} />
                      ))}
                    </AvatarStack>
                  )}
                </span>
                <span className="nx-row-comments">
                  {(e.comments ?? 0) > 0 && (<><CommentIcon size={16} /> {e.comments}</>)}
                </span>
                <span className="nx-row-cost num" title="Net cost of the first 12 months, point estimate">
                  {e.cost ? usdK(e.cost.point ?? e.cost.p50, { plus: true }) : ''}
                </span>
              </div>
            </li>
          ))}
          {rows.length === 0 && <li className="nx-empty">{error ?? (loaded ? 'No ECRs match this search.' : 'Loading')}</li>}
        </ul>
      </div>
    </main>
  );
}