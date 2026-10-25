// "Ask Norn": a person asks why a number is what it is, and gets a short answer that cites only Norn's
// stored assessment of this ECR. The answer is made by the Ask Norn server (a Claude session with
// Norn's read-only tools) and checked there; this panel only asks and shows. Each citation chip opens
// the same "why" panel as the numbers on the page.
import { useEffect, useRef, useState } from 'react';
import { AlertIcon, CommentDiscussionIcon, LinkIcon } from '@primer/octicons-react';
import { Button, Flash, Label, Spinner, Textarea } from '@primer/react';
import { askNorn, askStatus, type AskAnswer, type AskCitation, type AskResponse } from '../ask/client.ts';
import { RECORDED_QUESTION, recordedAnswer } from '../ask/recorded.ts';
import { resolveTraceId } from '../ask/trace-id.ts';
import { source } from '../assessment/source.ts';
import type { ImpactAssessment } from '../assessment/types.ts';
import { MockTag, Person } from '../ui/Bits.tsx';
import { useWhy } from '../ui/Evidence.tsx';
import './ask.css';

const MAX = 500;
const SAVED_REASON = "Ask Norn answers from Norn's live database, and this page is showing saved runs.";

interface Exchange {
  id: number;
  question: string;
  response?: AskResponse;
}

type Availability = { state: 'checking' } | { state: 'ready' } | { state: 'unavailable'; reason: string };

export function AskNorn({ a }: { a: ImpactAssessment }) {
  const ecr = a.ecr.id;
  const [avail, setAvail] = useState<Availability>(source.isMock ? { state: 'unavailable', reason: SAVED_REASON } : { state: 'checking' });
  const [text, setText] = useState('');
  const [thread, setThread] = useState<Exchange[]>([]);
  const next = useRef(1);
  const busy = thread.some(x => !x.response);

  useEffect(() => {
    setThread([]);
    if (source.isMock) return setAvail({ state: 'unavailable', reason: SAVED_REASON });
    let live = true;
    setAvail({ state: 'checking' });
    void askStatus().then(s => live && setAvail(s.available ? { state: 'ready' } : { state: 'unavailable', reason: s.reason ?? 'Ask Norn is unavailable.' }));
    return () => {
      live = false;
    };
  }, [ecr]);

  const submit = async () => {
    const question = text.trim();
    if (!question || busy || avail.state !== 'ready') return;
    const id = next.current++;
    setThread(t => [...t, { id, question }]);
    setText('');
    const response = await askNorn(ecr, question);
    if (!response.ok && response.kind === 'unavailable') setAvail({ state: 'unavailable', reason: response.message });
    setThread(t => t.map(x => (x.id === id ? { ...x, response } : x)));
  };

  const showRecorded = () => {
    const id = next.current++;
    setThread(t => [...t, { id, question: RECORDED_QUESTION, response: recordedAnswer() }]);
  };

  const can = avail.state === 'ready';
  return (
    <section className="nx-ask" aria-label="Ask Norn" data-testid="ask-norn">
      <div className="nx-comment">
        <div className="nx-comment-head">
          <span className="nx-ask-head-title"><CommentDiscussionIcon size={16} /> Ask Norn</span>
          <span className="nx-fg-muted">about the numbers on {ecr}</span>
        </div>
        <div className="nx-comment-body">
          {avail.state === 'unavailable' && (
            <Flash variant="warning" className="nx-ask-flash" style={{ marginTop: 0, marginBottom: 12 }}>
              <b>Ask Norn is unavailable.</b> {avail.reason.replace(/^Ask Norn is unavailable:?\s*/i, '')}
            </Flash>
          )}
          <form
            className="nx-ask-form"
            onSubmit={ev => {
              ev.preventDefault();
              void submit();
            }}
          >
            <Textarea
              block
              rows={2}
              resize="vertical"
              maxLength={MAX}
              value={text}
              disabled={!can}
              aria-label="Your question"
              placeholder="Why is the one-time cost what it is? Where does the cancellation charge come from?"
              onChange={ev => setText(ev.target.value)}
              onKeyDown={ev => {
                if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
                  ev.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="nx-ask-foot">
              <Button type="submit" variant="primary" disabled={!can || busy || !text.trim()}>Ask</Button>
              {source.isMock && <Button type="button" onClick={showRecorded}>Show a recorded example</Button>}
              <span className="nx-ask-hint">Answers use only Norn&rsquo;s stored data for this ECR.</span>
            </div>
          </form>

          {(thread.length > 0 || avail.state === 'checking') && (
            <div className="nx-ask-thread">
              {avail.state === 'checking' && <div className="nx-ask-busy"><Spinner size="small" /> Checking that Norn can answer</div>}
              {thread.map(x => <ExchangeView key={x.id} a={a} x={x} />)}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ExchangeView({ a, x }: { a: ImpactAssessment; x: Exchange }) {
  return (
    <div>
      <div className="nx-ask-q"><b>You</b> asked: {x.question}</div>
      <div style={{ marginTop: 8 }}>
        <div className="nx-comment">
          <div className="nx-comment-head">
            <Person name="Norn" kind="norn" size={20} />
            <b>Norn</b>
            <Label variant="secondary" size="small">Bot</Label>
            {x.response?.ok && x.response.recorded && <Label variant="attention" size="small" className="nx-ask-recorded">RECORDED</Label>}
            {x.response?.ok && <MockTag on={x.response.mock} title="Mock: some numbers in this answer are placeholders from a mock check" />}
          </div>
          <div className="nx-comment-body">{x.response ? <ResponseView a={a} r={x.response} /> : <div className="nx-ask-busy"><Spinner size="small" /> Norn is reading the assessment</div>}</div>
        </div>
      </div>
    </div>
  );
}

function ResponseView({ a, r }: { a: ImpactAssessment; r: AskResponse }) {
  if (!r.ok) return <Flash variant={r.kind === 'unavailable' ? 'warning' : 'danger'}>{r.message}</Flash>;
  return <AnswerView a={a} r={r} />;
}

function AnswerView({ a, r }: { a: ImpactAssessment; r: AskAnswer }) {
  const why = useWhy();
  const bad = r.unverifiedNumbers.length;
  return (
    <>
      {r.recorded && (
        <p className="nx-small nx-fg-muted" style={{ margin: '0 0 8px' }}>
          RECORDED example from the saved ECR-0417 run, not a live answer.
        </p>
      )}
      <p className="nx-ask-answer">
        {r.segments.map((s, i) =>
          s.unverified ? <mark key={i} className="nx-ask-unverified" title="Not found in Norn's data">{s.text}</mark> : <span key={i}>{s.text}</span>
        )}
      </p>
      {bad > 0 && (
        <Flash variant="danger" className="nx-ask-flash">
          <AlertIcon size={16} /> <b>Not found in Norn&rsquo;s data:</b> {r.unverifiedNumbers.join(', ')}. Do not rely on {bad === 1 ? 'this number' : 'these numbers'}; ask the cost accountant.
        </Flash>
      )}
      {r.citations.length > 0 && (
        <div className="nx-ask-cites" aria-label="Sources">
          {r.citations.map((c, i) => <Chip key={`${c.refId}-${i}`} c={c} traceId={c.verified ? resolveTraceId(c.refId, a.traces) : null} open={why.open} />)}
        </div>
      )}
    </>
  );
}

function Chip({ c, traceId, open }: { c: AskCitation; traceId: string | null; open: (id: string) => void }) {
  const body = (
    <>
      {c.verified ? <LinkIcon size={12} /> : <AlertIcon size={12} />}
      <span>{c.label}</span>
      {c.value && <b>{c.value}</b>}
    </>
  );
  if (!c.verified) return <span className="nx-ask-chip unverified" title="Not found in Norn's data">{body}</span>;
  if (!traceId) return <span className="nx-ask-chip" title={c.refId}>{body}</span>;
  return <button type="button" className="nx-ask-chip" title={`Open why: ${c.refId}`} aria-haspopup="dialog" onClick={() => open(traceId)}>{body}</button>;
}
