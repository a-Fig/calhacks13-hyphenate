// A reducer that writes a log row and then fails in each way a reducer can, to see what a caller
// gets and whether the write is undone (spike 1, `npm run spike:errors`).
import { SenderError, t } from 'spacetimedb/server';
import { write } from '../../module/src/core';

export const failAfterWrite = write('fail_after_write', { mode: t.string() }, (_ctx, a, call) => {
  call.log({ entity: 'test', summary: `fail_after_write mode=${a.mode} (this row exists only when mode=ok)` });
  if (a.mode === 'sender') throw new SenderError('test: SenderError after a write');
  if (a.mode === 'internal') throw new Error('test: plain Error after a write');
  if (a.mode === 'type') (null as unknown as { x: number }).x = 1;
  return null;
});
