// Writes Bowman's open ECRs, one JSON file each, as the test feed the ingest loop reads with
// NORN_INGEST_SOURCE=stub:  node web/scripts/make-stub-feed.ts <dir>  (from norn/)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bowman } from '../../../bowman/data/index.ts';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node web/scripts/make-stub-feed.ts <dir>');
mkdirSync(dir, { recursive: true });
for (const e of bowman.ecrs) writeFileSync(join(dir, `${e.id}.json`), JSON.stringify(e));
console.log(`wrote ${bowman.ecrs.length} change requests to ${dir}`);
