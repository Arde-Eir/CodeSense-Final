import { describe, it, expect } from 'vitest';
import { composeHints } from '@/campaign/composeHints';
import type { HintItem } from '@/types/campaign';

const tabA: HintItem = { title: 'A-only',     body: 'a',    activity: 'mc' };
const tabB: HintItem = { title: 'B-only',     body: 'b',    activity: 'drag' };
const all : HintItem = { title: 'Universal',  body: 'u' };  // untagged

describe('composeHints', () => {
  describe('per-tab filtering', () => {
    it('returns [] for null/empty pool and no item hint', () => {
      expect(composeHints(null,      'mc')).toEqual([]);
      expect(composeHints(undefined, 'mc')).toEqual([]);
      expect(composeHints([],        'mc')).toEqual([]);
    });

    it('keeps hints tagged for the active tab', () => {
      const r = composeHints([tabA, tabB], 'mc');
      expect(r.map(h => h.title)).toEqual(['A-only']);
    });

    it('always keeps untagged hints as fallback', () => {
      const r = composeHints([tabA, tabB, all], 'mc');
      expect(r.map(h => h.title)).toEqual(['A-only', 'Universal']);
    });

    it('falls back to only untagged hints when nothing is tagged for this tab', () => {
      const r = composeHints([tabA, all], 'drag');
      expect(r.map(h => h.title)).toEqual(['Universal']);
    });
  });

  describe('per-question hint stacking', () => {
    it('prepends item hint as the first entry', () => {
      const r = composeHints([tabA, all], 'mc', 'Look at the loop boundary.');
      expect(r).toHaveLength(3);
      expect(r[0]).toMatchObject({
        title: 'Hint for this question',
        body:  'Look at the loop boundary.',
        icon:  '🎯',
      });
      expect(r[1].title).toBe('A-only');
      expect(r[2].title).toBe('Universal');
    });

    it('ignores empty / whitespace-only item hints', () => {
      const r = composeHints([tabA], 'mc', '   ');
      expect(r.map(h => h.title)).toEqual(['A-only']);
    });

    it('trims surrounding whitespace from item hint body', () => {
      const r = composeHints([], 'mc', '   trim me   ');
      expect(r[0].body).toBe('trim me');
    });

    it('item hint alone produces a single-entry list (no pool needed)', () => {
      const r = composeHints([], 'mc', 'only-hint');
      expect(r).toHaveLength(1);
      expect(r[0].body).toBe('only-hint');
    });

    it('accepts multiple per-question hints', () => {
      const r = composeHints([all], 'mc', ['First clue', 'Second clue']);
      expect(r.map(h => h.body)).toEqual(['First clue', 'Second clue', 'u']);
      expect(r[1].title).toBe('Hint 2 for this question');
    });

    it('accepts rich per-question hint objects', () => {
      const r = composeHints([], 'mc', { title: 'Watch the condition', body: 'Look for ==.', icon: '🔎' });
      expect(r[0]).toMatchObject({ title: 'Watch the condition', body: 'Look for ==.', icon: '🔎' });
    });
  });

  describe('purity', () => {
    it('does not mutate the input pool', () => {
      const pool: HintItem[] = [tabA, all];
      const snapshot = JSON.stringify(pool);
      composeHints(pool, 'mc', 'x');
      expect(JSON.stringify(pool)).toBe(snapshot);
    });
  });
});
