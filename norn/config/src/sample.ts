// Which actions an `approve_sampled` rule sends for a blind second check, decided the same way every
// time. The draw is a pure function of the deployment's seed, the ECR id and the action, so replaying
// an ECR samples the same actions, and no state or random number generator is involved.
//
// The algorithm is written out so any other implementation, such as the state-layer module, can
// reproduce it exactly and be checked against the pinned values in test/sample.test.ts:
//   1. text  = JSON.stringify([seed, ecrId, action])
//   2. h     = 32-bit FNV-1a over the UTF-8 bytes of text
//   3. h     = murmur3's 32-bit finalizer applied to h (FNV-1a alone mixes its last bytes poorly)
//   4. value = h / 2^32, a number from 0 up to but not including 1
//   5. sampled when value < rate

const encoder = new TextEncoder();

/** 32-bit FNV-1a of the UTF-8 bytes of `text`, then murmur3's finalizer. An unsigned integer. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of encoder.encode(text)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface SampleKey {
  /** The deployment's `seed` setting. */
  seed: string;
  ecrId: string;
  /** The action id, such as 'approve_fast_track_ecr'. */
  action: string;
}

/** Where this ECR and action fall in [0, 1). The same inputs always give the same number. */
export function sampleValue({ seed, ecrId, action }: SampleKey): number {
  return hash32(JSON.stringify([seed, ecrId, action])) / 2 ** 32;
}

/** Whether this ECR's action is one of the share `rate` (0 to 1) that wait for a blind second check. */
export function isSampled({ rate, ...key }: SampleKey & { rate: number }): boolean {
  if (!(rate >= 0 && rate <= 1)) throw new RangeError(`sample rate must be from 0 to 1, got ${rate}`);
  return sampleValue(key) < rate;
}
