// The company gate and the ERP change package on the Conversation tab, drawn from live rows
// (assessment/live/gate.ts). Own file, so the screens it mounts into only gain a few lines:
//   ApprovalRows      the approval box's approval row (who approved, fast track, pending a re-check, withdrawn)
//   RecommendationRow the approval box's row for Norn's recommendation, with its reasons and recipients
//   ReleaseFoot       the disabled release button and why
//   ApproverItems     the sidebar's approvers
//   ErpPackageCard    the ERP change package, replacing the saved-mode mock card in live mode
// Norn never writes to the ERP: every line says who enters it, and the ERP read says whether it was.
import { useState, type ReactNode } from 'react';
import {
  AlertFillIcon, CheckCircleFillIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon, DotFillIcon, GitMergeIcon, PackageIcon,
  ShieldCheckIcon, XCircleFillIcon,
} from '@primer/octicons-react';
import { Button, Flash, Label } from '@primer/react';
import type { ApprovalView, GateView, PackageBuilt, PackageLineView, RecommendationView } from '../assessment/live/gate.ts';
import { MockTag, Person } from '../ui/Bits.tsx';
import { dateTime, usd } from '../ui/fmt.ts';
import './gate.css';

const kindOf = (k: 'person' | 'norn' | 'agent') => k;

function Row({ icon, title, sub, open, onToggle, children }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; open?: boolean; onToggle?: () => void; children?: ReactNode }) {
  const head = (
    <>
      <span className="nx-merge-icon">{icon}</span>
      <span className="nx-merge-text">
        <b>{title}</b>
        {sub && <span className="nx-fg-muted">{sub}</span>}
      </span>
      {onToggle && (open ? <ChevronDownIcon className="nx-fg-muted" /> : <ChevronRightIcon className="nx-fg-muted" />)}
    </>
  );
  return (
    <div className="nx-merge-row">
      {onToggle ? <button type="button" className="nx-merge-head" onClick={onToggle} aria-expanded={open}>{head}</button> : <div className="nx-merge-head">{head}</div>}
      {open && children}
    </div>
  );
}

const forWho = (a: { onBehalfOf?: string }) => (a.onBehalfOf ? ` for ${a.onBehalfOf}` : '');
const reasonList = (reasons: { text: string }[]) =>
  reasons.length > 0 && (
    <ul className="nx-gate-reasons">
      {reasons.map((r, i) => <li key={i}><DotFillIcon size={12} className="nx-fg-muted" /> <span>{r.text}</span></li>)}
    </ul>
  );

// ---------------------------------------------------------------- approvals

const STATE_WORD = { approved: 'Approved', pending_recheck: 'Approved, pending a re-check', withdrawn: 'Withdrawn' } as const;
const STATE_VARIANT = { approved: 'success', pending_recheck: 'attention', withdrawn: 'secondary' } as const;

function ApprovalLine({ a }: { a: ApprovalView }) {
  return (
    <li className="nx-gate-approval">
      <div className="nx-gate-line">
        <Person name={a.who} kind={kindOf(a.whoKind)} size={20} />
        <b>{a.who}</b>
        <span className="nx-fg-muted">{a.role}{a.tier && !a.fastTrack ? `, ${a.tier} tier` : ''}{forWho(a)}</span>
        <span className="nx-sp" />
        <Label variant={STATE_VARIANT[a.state]} size="small">{a.released ? 'Approved, released' : STATE_WORD[a.state]}</Label>
        <span className="nx-fg-muted nx-small">{dateTime(a.at)}</span>
      </div>
      {a.state === 'withdrawn' && a.endedReason && <div className="nx-gate-note">Withdrawn {a.endedAt ? dateTime(a.endedAt) : ''}: {a.endedReason}</div>}
      {a.state === 'pending_recheck' && <div className="nx-gate-note">The ECR&rsquo;s inputs changed under this approval. It stands, but the checks are being repeated, and the ECR cannot be released until they have finished.</div>}
      {a.fastTrack && a.state !== 'withdrawn' && reasonList(a.reasons)}
    </li>
  );
}

/** The approval box's approval row. Replaces the mock "Review required" row when real approvals exist. */
export function ApprovalRows({ gate, released }: { gate: GateView; released: boolean }) {
  const head = gate.approvals[0];
  const live = gate.approvals.find(a => a.state !== 'withdrawn');
  const [open, setOpen] = useState(!!gate.fastTrack || live?.state === 'pending_recheck');
  const names = live ? `${live.who}${forWho(live)}` : '';
  let icon: ReactNode, title: ReactNode, sub: ReactNode;
  if (released && live) {
    icon = <GitMergeIcon size={24} className="nx-fg-done" />;
    title = 'ECO released';
    sub = live.fastTrack ? `Approved on the fast track by ${names}, ${dateTime(live.at)}` : `Approved by ${names} (${live.role}), ${dateTime(live.at)}`;
  } else if (live?.state === 'pending_recheck') {
    icon = <ClockIcon size={24} className="nx-fg-attention" />;
    title = 'Approval pending a re-check';
    sub = `${names}${live.fastTrack ? ' approved on the fast track' : ` approved as ${live.role}`}; the checks are running again on changed inputs`;
  } else if (live) {
    icon = <CheckCircleFillIcon size={24} className="nx-fg-success" />;
    title = live.fastTrack ? 'Approved on the fast track' : `Approved by ${names}`;
    sub = live.fastTrack ? `${names}, within Norn’s limits · ${dateTime(live.at)}` : `${live.role}${live.tier ? `, ${live.tier} tier` : ''} · ${dateTime(live.at)}`;
  } else {
    icon = <DotFillIcon size={24} className="nx-fg-attention" />;
    title = 'Review required';
    sub = head?.endedReason ? `The last approval was withdrawn: ${head.endedReason}` : 'No approval stands';
  }
  return (
    <Row icon={icon} title={title} sub={sub} open={open} onToggle={() => setOpen(o => !o)}>
      <ul className="nx-gate-list">{gate.approvals.map(a => <ApprovalLine key={a.id} a={a} />)}</ul>
    </Row>
  );
}

// ---------------------------------------------------------------- recommendation

export function RecommendationRow({ rec }: { rec: RecommendationView }) {
  return (
    <Row
      icon={rec.waitingForSecondCheck ? <ClockIcon size={24} className="nx-fg-attention" /> : <ShieldCheckIcon size={24} className="nx-fg-success" />}
      title={rec.headline}
      sub={<>{rec.recipients.length ? `Sent to ${rec.recipients.join(', ')}` : 'No recipient named'} &middot; <span>{dateTime(rec.at)}</span>{forWho(rec) && <>, {forWho(rec).trim()}</>}</>}
      open
      onToggle={undefined}
    >
      {rec.reasons.length > 0 && <div className="nx-gate-body">{reasonList(rec.reasons)}</div>}
    </Row>
  );
}

// ---------------------------------------------------------------- the release button

/** A disabled Release button on an approved ECR, with why. The page does not release: the CM analyst records it. */
export function ReleaseFoot({ gate }: { gate: GateView }) {
  return (
    <div className="nx-merge-foot">
      <Button variant="primary" disabled leadingVisual={PackageIcon}>Release ECO</Button>
      <span className={gate.releaseBlock ? 'nx-fg-attention' : 'nx-fg-muted'}>{gate.releaseBlock ?? 'Waiting for the release'}</span>
    </div>
  );
}

// ---------------------------------------------------------------- the sidebar

/** One list item per approver: the newest approval of each person or agent. */
export function ApproverItems({ gate }: { gate: GateView }) {
  const seen = new Set<string>();
  const latest = gate.approvals.filter(a => (seen.has(a.who) ? false : (seen.add(a.who), true)));
  return (
    <>
      {latest.map(a => (
        <li key={a.id}>
          <Person name={a.who} kind={kindOf(a.whoKind)} size={20} />
          <span className="nx-side-name" title={`${a.role}${forWho(a)}`}>{a.who}<span className="nx-fg-muted nx-side-role"> {a.fastTrack ? 'Fast track' : a.role}</span></span>
          <span className="nx-side-trail">
            {a.state === 'approved' && <CheckIcon size={16} className="nx-fg-success" aria-label="Approved" />}
            {a.state === 'pending_recheck' && <ClockIcon size={16} className="nx-fg-attention" aria-label="Approved, pending a re-check" />}
            {a.state === 'withdrawn' && <XCircleFillIcon size={16} className="nx-fg-muted" aria-label="Withdrawn" />}
          </span>
        </li>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- the ERP change package

const LINE_VARIANT = { entered: 'success', to_enter: 'attention', conflict: 'danger' } as const;

function PackageLine({ l }: { l: PackageLineView }) {
  const [open, setOpen] = useState(l.status === 'conflict');
  const hasMore = l.fields.length > 0 || l.tables.length > 0;
  return (
    <div className="nx-erp-line nx-pkg-line">
      <div className="nx-erp-line-head">
        <b>{l.title}</b>
        {l.seat && <span className="nx-fg-muted nx-small">entered by the {l.seat}</span>}
        <span className="nx-sp" />
        <Label variant={LINE_VARIANT[l.status]}>{l.statusText}</Label>
      </div>
      <div className="nx-pkg-body">
        {l.instruction && <p>{l.instruction}</p>}
        {l.note && <p className="nx-fg-muted nx-small">{l.note}</p>}
        {hasMore && (
          <>
            <button type="button" className="nx-pkg-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
              {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />} {open ? 'Hide the values' : 'Show the values'}
            </button>
            {open && (
              <div className="nx-pkg-values">
                {l.fields.length > 0 && (
                  <dl>
                    {l.fields.map((f, i) => <div key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
                  </dl>
                )}
                {l.tables.map((t, i) => (
                  <div key={i}>
                    <div className="nx-small nx-fg-muted">{t.label}</div>
                    <ul>{t.rows.map((r, j) => <li key={j}>{r}</li>)}</ul>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const HEALTH: Record<PackageBuilt['health'], { variant: 'danger' | 'warning' | 'success' | 'default'; icon: ReactNode }> = {
  problems: { variant: 'danger', icon: <AlertFillIcon size={16} /> },
  conflict: { variant: 'danger', icon: <AlertFillIcon size={16} /> },
  to_enter: { variant: 'warning', icon: <ClockIcon size={16} /> },
  entered: { variant: 'success', icon: <CheckCircleFillIcon size={16} /> },
  nothing: { variant: 'default', icon: <CheckIcon size={16} /> },
};

/** What Norn hands over when an ECO is released, from the module's own erp_package row. Norn writes nothing to the ERP. */
export function ErpPackageCard({ gate }: { gate: GateView }) {
  const p = gate.package;
  if (p.state === 'missing') {
    return (
      <section className="nx-erp" aria-label="ERP change package">
        <header className="nx-erp-head">
          <PackageIcon size={16} />
          <b>ERP change package</b>
          <span className="nx-fg-muted">None yet</span>
        </header>
        <p className="nx-pkg-none" data-package-state={p.code}>{p.why}</p>
      </section>
    );
  }
  if (p.state === 'unreadable') {
    return (
      <section className="nx-erp" aria-label="ERP change package" data-package-state="unreadable">
        <header className="nx-erp-head">
          <PackageIcon size={16} />
          <b>ERP change package</b>
          <span className="nx-fg-muted">{p.ecoNumber}</span>
        </header>
        <Flash variant="danger" className="nx-pkg-flash nx-pkg-problems">
          <AlertFillIcon size={16} /> <b>Norn could not read this ERP change package.</b> It is not empty: do not treat it as nothing to enter.
          <ul>
            <li>{p.why}</li>
            {p.rowLines > 0 && <li>The stored row counts {p.rowLines} line{p.rowLines === 1 ? '' : 's'}, {p.rowEntered} entered and {p.rowConflicts} in conflict.</li>}
          </ul>
        </Flash>
        {p.problems.length > 0 && (
          <Flash variant="danger" className="nx-pkg-flash nx-pkg-problems" aria-label="Problems">
            <b>{p.problems.length === 1 ? 'A problem' : `${p.problems.length} problems`} that could still be read</b>
            <ul>{p.problems.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </Flash>
        )}
        <footer className="nx-pkg-foot nx-fg-muted nx-small">Ask whoever runs the worker to check the package row.</footer>
      </section>
    );
  }
  const h = HEALTH[p.health];
  return (
    <section className="nx-erp" aria-label="ERP change package" data-package-health={p.health}>
      <header className="nx-erp-head">
        <PackageIcon size={16} />
        <b>ERP change package</b>
        <MockTag on={!!p.mock} title={p.mock} />
        <span className="nx-fg-muted">{p.ecoNumber} &middot; lines for a person to enter in {p.system}. Norn does not write to it.</span>
        <span className="nx-sp" />
        <Label variant={p.counts.problems || p.counts.conflicts ? 'danger' : p.counts.entered === p.counts.lines && p.counts.lines ? 'success' : 'secondary'}>
          {p.counts.entered} of {p.counts.lines} entered
        </Label>
      </header>

      <Flash variant={h.variant} className="nx-pkg-flash">
        {h.icon} <b>{p.headline}</b>
      </Flash>
      <div className="nx-pkg-counts">
        <span><b>{p.counts.lines}</b> lines</span>
        <span><b>{p.counts.entered}</b> entered</span>
        <span><b>{p.counts.toEnter}</b> to enter</span>
        <span className={p.counts.conflicts ? 'nx-fg-danger' : ''}><b>{p.counts.conflicts}</b> in conflict</span>
        <span className={p.counts.problems ? 'nx-fg-danger' : ''}><b>{p.counts.problems}</b> {p.counts.problems === 1 ? 'problem' : 'problems'}</span>
      </div>

      {p.problems.length > 0 && (
        <Flash variant="danger" className="nx-pkg-flash nx-pkg-problems" aria-label="Problems">
          <b>{p.problems.length === 1 ? 'A problem keeps' : `${p.problems.length} problems keep`} this package from being complete</b>
          <ul>{p.problems.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Flash>
      )}
      {p.warnings.length > 0 && (
        <Flash variant="warning" className="nx-pkg-flash" aria-label="Warnings">
          <b>{p.warnings.length === 1 ? 'A warning' : `${p.warnings.length} warnings`}</b>
          <ul>{p.warnings.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Flash>
      )}

      {p.groups.map(g => (
        <div key={g.id} className="nx-pkg-group">
          <div className="nx-pkg-group-head"><b>{g.title}</b> <span className="nx-fg-muted">{g.entered} of {g.lines.length} entered</span></div>
          {g.lines.map(l => <PackageLine key={l.id} l={l} />)}
        </div>
      ))}

      {p.effects.length > 0 && (
        <div className="nx-pkg-extra">
          <b>Effect on unit cost</b>
          <ul>
            {p.effects.map((e, i) => (
              <li key={i}>
                {e.program}{e.name ? `, ${e.name}` : ''}: <b className="num">{usd(e.costDelta, { cents: true, plus: true })}</b> per unit{e.basis ? <span className="nx-fg-muted"> &middot; {e.basis}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.notes.length > 0 && (
        <div className="nx-pkg-extra">
          <b>Left out of the package</b>
          <ul>{p.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      <footer className="nx-pkg-foot nx-fg-muted nx-small">
        {p.mock && <><b>Mock:</b> {p.mock} </>}Built <span>{dateTime(p.builtAt)}</span> from the assessment. Statuses checked against ERP read {p.erpRead} <span>{dateTime(p.checkedAt)}</span>.
      </footer>
    </section>
  );
}
