import { mkdir, open, readFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EventSink, NornEvent } from './types.ts';

export type ClosableSink = EventSink & { close(): Promise<void> };

/**
 * Appends every event as one JSON line. Lines of different jobs interleave in arrival order;
 * within a job, `seq` gives the order. The file is opened on the first event and kept open until
 * `close()`.
 */
export function jsonlFileSink(path: string): ClosableSink {
  let handle: Promise<FileHandle> | null = null;
  // Jobs run concurrently and share the file: open it once, and write one line at a time.
  let tail: Promise<unknown> = Promise.resolve();
  const sink = (event: NornEvent): Promise<void> => {
    handle ??= mkdir(dirname(path), { recursive: true }).then(() => open(path, 'a'));
    const file = handle;
    const line = `${JSON.stringify(event)}\n`;
    const written = tail.then(async () => {
      await (await file).write(line);
    });
    tail = written.catch(() => {});
    return written;
  };
  return Object.assign(sink, {
    async close() {
      await tail;
      const file = handle;
      handle = null;
      await (await file?.catch(() => null))?.close();
    },
  });
}

/** Keeps events in memory. For tests and for callers that want the whole log afterwards. */
export function memorySink(): EventSink & { events: NornEvent[] } {
  const events: NornEvent[] = [];
  return Object.assign(
    (event: NornEvent) => {
      events.push(event);
    },
    { events },
  );
}

/** Sends each event to every sink, in order. */
export function teeSink(...sinks: EventSink[]): EventSink {
  return async (event) => {
    for (const sink of sinks) await sink(event);
  };
}

/** Reads a JSONL event log back. */
export async function readJsonl(path: string): Promise<NornEvent[]> {
  const text = await readFile(path, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as NornEvent);
}
