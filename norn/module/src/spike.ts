// Spike-only reducers for the error-behaviour check (NOTES.md, spike 1). Delete before the demo
// freeze. They exist to compare how a SenderError, an ordinary Error and a rolled-back partial
// write look to a client.
import { SenderError, t } from 'spacetimedb/server';
import spacetimedb from './schema';
import { authorize, logAction, resolveActor } from './core';

export const spikeFail = spacetimedb.reducer({ mode: t.string() }, (ctx, { mode }) => {
  const actor = resolveActor(ctx);
  // A write that must disappear again if the reducer throws afterwards.
  logAction(ctx, actor, authorize(ctx, actor, 'spike_fail', mode), 'spike_fail', {
    entity: 'spike',
    summary: `spike_fail mode=${mode} (this row must exist only when mode=ok)`,
  });
  if (mode === 'sender') throw new SenderError('spike: SenderError after a write');
  if (mode === 'internal') throw new Error('spike: plain Error after a write');
  if (mode === 'type') (null as unknown as { x: number }).x = 1;
});
