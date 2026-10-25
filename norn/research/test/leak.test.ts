import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bowman } from '../../../bowman/data/index.ts';
import { collectIdentifiers, findLeaks } from '../src/leak.ts';

const ids = collectIdentifiers(bowman);
const hits = (q: string) => findLeaks(q, ids).map((l) => l.identifier);

describe('leak check on Bowman\'s dataset', () => {
  it('collects identifiers of every kind', () => {
    const kinds = new Set(ids.map((i) => i.kind));
    for (const k of ['company', 'item', 'supplier', 'person', 'program', 'record']) assert.ok(kinds.has(k as never), k);
    assert.ok(ids.length > 300);
  });
  it('catches the identifiers the demo ECR is full of', () => {
    for (const q of [
      'BW-5120-210 price', 'bw5120210 bracket', '5120-210 rev c', 'Halden Precision cancellation charge', 'halden lead time',
      'Jeff Hargrove', 'Hargrove', 'Vesper V4 bracket', 'meridian m6', 'Bowman Aviation scrap', 'bowman', 'ECR-0417', 'NCR-0119', 'Q-HAL-26-1187', 'SUP-HALDEN',
    ]) assert.ok(hits(q).length > 0, q);
  });
  it('passes the generic queries the agent is meant to use', () => {
    for (const q of [
      'aluminum machine cuts scrap price per pound', '7075 aluminum scrap price', 'aerospace supplier purchase order cancellation charge typical',
      'machined aluminum bracket lead time weeks aerospace', 'NDT inspection hourly rate aircraft', 'cobalt price per pound', 'fatigue crack bracket vibration test cost',
    ]) assert.deepEqual(hits(q), [], q);
  });
  it('matches whole words only', () => {
    assert.ok(hits('halden bracket').length > 0);
    assert.deepEqual(hits('shaldenx bracket'), []);
  });
});
