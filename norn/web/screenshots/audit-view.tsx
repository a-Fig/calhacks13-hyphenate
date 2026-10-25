// Component capture harness, served only by Vite during audit.mjs; no application route imports it.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BaseStyles, ThemeProvider } from '@primer/react';
// Absolute Vite URLs deliberately select the server being compared, including the baseline server.
import { buildAssessment } from '/src/assessment/live/build.ts';
import { Shell } from '/src/screens/Shell.tsx';
import { Impact } from '/src/screens/Impact.tsx';
import { Conversation } from '/src/screens/Conversation.tsx';
import { WhyContext } from '/src/ui/Evidence.tsx';
import { WhyPanel } from '/src/ui/WhyPanel.tsx';
import { usePath } from '/src/router.tsx';

let root;
export function render(fixture, check) {
  window.history.replaceState({}, '', `/audit/${check}`);
  const { ecr, rows } = fixture;
  const stamp = { microsSinceUnixEpoch: 1792886400000000n, toDate: () => new Date('2026-10-25T00:00:00Z') };
  const identity = { toHexString: () => 'aa' };
  const pr = { id: 1n, plmEcrNumber: ecr.id, title: ecr.title, description: ecr.description, status: 'approved', revision: 1, createdBy: identity, createdAt: stamp, updatedAt: stamp };
  const stages = ['s1_bom_delta', 's2_cost', 's3_timeline', 's4_supply'];
  const runs = stages.map((stage, i) => ({ id: BigInt(i + 1), prId: 1n, stage, status: 'done', note: '', createdAt: stamp, finishedAt: stamp }));
  const results = rows.flatMap((rs, i) => rs.map((row, k) => ({ ...row, id: BigInt(i * 1000 + k), checkRunId: BigInt(i + 1), prId: 1n, mock: false })));
  const snapshot = { prs: [pr], revisions: [{ id: 1n, prId: 1n, seq: 1, changeRequestJson: JSON.stringify(ecr), source: 'offline fixture', current: true, createdBy: identity, createdAt: stamp }],
    runs, results, statements: [], comments: [], actions: [], events: [], principals: [], approvals: [], recommendations: [] };
  const assessment = buildAssessment(snapshot, pr);
  assessment.source = 'saved';
  if (!root) {
    document.getElementById('root').style.display = 'none';
    const host = document.createElement('div'); host.id = 'audit-component'; document.body.append(host);
    root = createRoot(host);
  }
  root.render(<ThemeProvider colorMode="day" dayScheme="light"><BaseStyles><Audit key={check} assessment={assessment} check={check} /></BaseStyles></ThemeProvider>);
}

function Audit({ assessment, check }) {
  const [stack, setStack] = useState([]);
  const selected = /\/impact\/(\w+)$/.exec(usePath())?.[1] ?? check;
  const open = id => setStack(s => [...s, id]);
  return <Shell><div className="nx-container" style={{ paddingTop: 24 }}>
    <h1>{assessment.ecr.title}</h1>
    <p>Offline verification fixture · computed checks · overall status approved · no individual approval records</p>
    <WhyContext.Provider value={{ open, current: stack.at(-1) ?? null }}>
      {selected === 'conversation' ? <Conversation a={assessment} /> : <Impact a={assessment} check={selected} />}
      {stack.length > 0 && <WhyPanel a={assessment} stack={stack} onOpen={open} onBack={() => setStack(s => s.slice(0, -1))} onClose={() => setStack([])} />}
    </WhyContext.Provider>
  </div></Shell>;
}
