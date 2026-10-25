// Norn's seat in the conversation: its questions to the people who own a number, their replies, and
// the note when the answer is recorded. A reply box sits under a question that is still open.
import { useState, type ReactNode } from 'react';
import { CheckCircleFillIcon } from '@primer/octicons-react';
import { Button, Label, Textarea, Timeline } from '@primer/react';
import { people } from '../../../../bowman/data/company.ts';
import { SEAT_DISPLAY_PREFIX, anchorFor } from '../../../seat/src/thread.ts';
import type { ImpactAssessment } from '../assessment/types.ts';
import { Link } from '../router.tsx';
import { useNorn } from '../store.tsx';
import { CommentBox } from './Conversation.tsx';
import type { SeatItem, SeatThread } from './seatThreads.ts';

const personOf = (id?: string) => people.find((p) => p.id === id);
const SEAT = `${SEAT_DISPLAY_PREFIX}Product Cost Engineer`;

export function SeatThreads({ a, threads, others, renderEvent }: { a: ImpactAssessment; threads: SeatThread[]; others: ImpactAssessment['activity']; renderEvent: (e: ImpactAssessment['activity'][number]) => ReactNode }) {
  type Slot = { at: string; node: ReactNode };
  const slots: Slot[] = [
    ...others.map((e) => ({ at: e.at, node: renderEvent(e) })),
    ...threads.map((t) => ({ at: t.ask.e.at, node: <Thread key={t.inputId} a={a} t={t} /> })),
  ].sort((x, y) => x.at.localeCompare(y.at));
  return <>{slots.map((s) => s.node)}</>;
}

function Thread({ a, t }: { a: ImpactAssessment; t: SeatThread }) {
  const to = personOf(t.ask.a.personId);
  const base = `/ecr/${a.ecr.id}`;
  return (
    <Timeline.Item className="nx-t-comment">
      <Timeline.Body>
        <CommentBox name={SEAT} kind="norn" time={t.ask.e.at} label={to && <Label variant="secondary" size="small">Asked {to.name} · {to.department}</Label>}>
          <div style={{ whiteSpace: 'pre-wrap' }}>{t.ask.e.detail}</div>
          {t.after.map((i) => <Follow key={i.e.id} i={i} base={base} />)}
          {!t.recorded && to && <ReplyBox ecr={a.ecr.id} inputId={t.inputId} personId={to.id} personName={to.name} />}
        </CommentBox>
      </Timeline.Body>
    </Timeline.Item>
  );
}

function Follow({ i, base }: { i: SeatItem; base: string }) {
  const k = i.a.kind;
  if (k === 'record')
    return (
      <div className="nx-ev" style={{ marginTop: 12 }}>
        <span style={{ color: 'var(--fgColor-success)' }}><CheckCircleFillIcon size={16} /></span>
        <span>{i.e.detail} <Link to={`${base}/impact`}>Cost page</Link></span>
      </div>
    );
  const who = k === 'reply' ? personOf(i.a.personId)?.name ?? i.e.actor : SEAT;
  return (
    <div style={{ marginTop: 12 }}>
      <CommentBox name={who} kind={k === 'reply' ? 'person' : 'norn'} time={i.e.at} label={k === 'reply' ? <Label variant="secondary" size="small" title={`Typed by ${i.e.actor}`}>Demo sign-in</Label> : k === 'escalate' ? <Label variant="attention" size="small">Escalation</Label> : k === 'remind' ? <Label variant="secondary" size="small">Reminder</Label> : undefined}>
        <div style={{ whiteSpace: 'pre-wrap' }}>{i.e.detail}</div>
      </CommentBox>
    </div>
  );
}

/** The demo's way to answer as the person asked: the comment is anchored to the question and says whose answer it is. */
function ReplyBox({ ecr, inputId, personId, personName }: { ecr: string; inputId: string; personId: string; personName: string }) {
  const { conn, R } = useNorn();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    const pr = conn && [...conn.db.pullRequest.iter()].find((p) => p.plmEcrNumber === ecr);
    if (!pr || !R || !text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await R.addComment({ prId: pr.id, anchor: anchorFor({ kind: 'reply', personId, inputId }), body: text.trim() });
      setText('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: 16 }}>
      <div className="nx-fg-muted" style={{ marginBottom: 4 }}>Replying as <b>{personName}</b> (demo sign-in)</div>
      <Textarea block rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label={`Reply as ${personName}`} />
      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button variant="primary" size="small" disabled={busy || !text.trim()} onClick={() => void send()}>Reply</Button>
        {err && <span style={{ color: 'var(--fgColor-danger)' }}>{err}</span>}
      </div>
    </div>
  );
}
