import type { Provenance } from './types.ts';

/** Fictional by default: the whole company is invented. */
export const INV: Provenance = { basis: 'invented' };

/** Traces to the research docs. `ref` names doc and section, e.g. 'archer-public-data.md §1'. */
export const src = (ref: string, note?: string): Provenance => ({ basis: 'sourced', ref, ...(note ? { note } : {}) });

/** Invented, with a note on what it is anchored to. */
export const inv = (note: string): Provenance => ({ basis: 'invented', note });

export const ARCHER = 'docs/research/archer-public-data.md';
export const PRACTICE = 'docs/IN-PRACTICE.md';
export const IMPACT = 'docs/research/practice-impact-assessment.md';
