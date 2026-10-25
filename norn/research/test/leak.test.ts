import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bowman } from '../../../bowman/data/index.ts';
import { collectIdentifiers, DEFAULT_ALLOW, findLeaks, findUrlLeaks } from '../src/leak.ts';

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
  it('catches every identifier it collected, as written and inside a longer query, except the one deliberately allowed (cobalt)', () => {
    const missed = ids.filter((i) => findLeaks(i.text, ids).length === 0).map((i) => `${i.kind}: ${i.text}`);
    assert.ok(ids.length >= 600, `collected ${ids.length}`);
    assert.deepEqual(missed, ['supplier: COBALT']);
    assert.deepEqual(DEFAULT_ALLOW, ['cobalt']);
    for (const i of ids) {
      if (i.text.toLowerCase() === 'cobalt') continue;
      assert.ok(findLeaks(`price of ${i.text.toLowerCase()} per unit`, ids).length > 0, i.text);
    }
  });
  it('catches ordinary and invisible variants (review finding 3)', () => {
    for (const q of [
      '5120210', '5120210 bracket', 'part 5120 210', 'bw5120210', 'BW-5120-210', 'BW​-5120-210', '5120‑210',
      'JeffHargrove', 'jeff_hargrove', 'Jeff​Hargrove', 'Jeff Hargrove', 'JEFF.HARGROVE',
      'Bow​man Aviation', 'Bow­man', 'Bowman‎', '⁠Bowman', 'BowmanAviation', 'ＢＯＷＭＡＮ',
      'Hald​en Precision', 'Halden​Precision', 'HaldenPrecision', 'Hàlden Precision', 'Hal‪de‬n',
      'vesperv4 bracket', 'Vesper​ V4', 'ECR0417', 'ECR​-0417', 'ecr 0417',
    ]) assert.ok(hits(q).length > 0, JSON.stringify(q));
  });
  it('does not take a number inside a longer number for a part number', () => {
    for (const q of ['15120210 units', '$15,120,210 total', '51202100 pieces', 'order 25120210', '5120 2100']) assert.deepEqual(hits(q), [], q);
    assert.ok(hits('year 2025 5120 210').length > 0, 'a part number after another number is still a part number');
  });
  it('passes the generic queries the agent is meant to use', () => {
    for (const q of [
      'aluminum machine cuts scrap price per pound', '7075 aluminum scrap price', 'aerospace supplier purchase order cancellation charge typical',
      'machined aluminum bracket lead time weeks aerospace', 'NDT inspection hourly rate aircraft', 'cobalt price per pound', 'fatigue crack bracket vibration test cost',
    ]) assert.deepEqual(hits(q), [], q);
  });
  it('checks a URL\'s host, path, query and fragment, as written and percent-decoded', () => {
    for (const u of [
      'https://example.test/BW-5120-210?company=Bowman',
      'https://example.test/BW-5120-210',
      'https://example.test/search?q=Halden%20Precision',
      'https://example.test/search?q=Halden%2520Precision',
      'https://example.test/a/5120210',
      'https://example.test/p#Jeff-Hargrove',
      'https://bowman.example.test/p',
      'https://user:Hargrove@example.test/p',
      'https://example.test/Bow%E2%80%8Bman',
    ]) assert.ok(findUrlLeaks(u, ids).length > 0, u);
    for (const u of ['https://example.test/scrap-prices', 'https://rockawayrecycling.com/metal/al-machine-cuts/', 'https://example.test/item?id=15120210&page=2']) assert.deepEqual(findUrlLeaks(u, ids), [], u);
  });
  it('decodes percent-escapes (up to 3 passes) and + as a space before it looks (review round 2)', () => {
    for (const q of ['%48%61%6C%64%65%6E', 'https://example.test/%48%61%6C%64%65%6E', '%2548%2561%256C%2564%2565%256E', 'Jeff+Hargrove', 'Jeff%20Hargrove', 'Bow%E2%80%8Bman', '%35%31%32%30%32%31%30']) {
      assert.ok(hits(q).length > 0, q);
    }
    for (const q of ['aluminum+scrap+price', '5%25 recovery', '100% of cost', 'fifty%20percent', '%E0%A4%A']) assert.deepEqual(hits(q), [], q);
  });
  it('matches whole words only', () => {
    assert.ok(hits('halden bracket').length > 0);
    assert.deepEqual(hits('shaldenx bracket'), []);
  });
});
