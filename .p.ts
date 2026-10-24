import { bowman } from './bowman/data/index.ts';
import { costCheck } from './norn/checks/src/index.ts';
import { releaseOf } from './norn/workers/src/release.ts';
const b = { programs: bowman.programs, workCenters: bowman.workCenters, items: bowman.items, bom: bowman.bom, sourcing: bowman.sourcing, stock: bowman.stock, volumePlan: bowman.volumePlan, builtAircraft: bowman.builtAircraft } as any;
const e = bowman.ecrs.find(x => x.id === 'ECR-0417')!;
console.log(releaseOf(e as any, costCheck(b, e as any, { seed: 's' }), { eco: 'E', decision: { id: 'd', url: 'u' }, releasedOn: '2026-10-24' }).notes);
