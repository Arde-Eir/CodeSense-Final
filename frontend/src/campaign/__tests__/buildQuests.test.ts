import { describe, it, expect } from 'vitest';
import { buildQuests } from '../buildQuests';
import type { Quest, MissionProgress } from '../../types/campaign';

// ─── Fixture builders ─────────────────────────────────────────────────────
// Quest fields we don't care about for gating — null/empty defaults that
// satisfy the `Quest` type without polluting test assertions.
const QUEST_DEFAULTS: Omit<Quest, 'id' | 'title' | 'sortorder' | 'basexp'> = {
  description: null, difficulty: null, level: 1, phase: 'beginner',
  mode: 'campaign', requiredxp: 0, isactive: true, question_type: null,
  objectives: null, hints: null,
  game_items: null, drop_zones: null, ordering_items: null,
  mc_questions: null, code_fill_items: null,
  tutorial_title: null, tutorial_body: null, tutorial_image: null,
  theory_sections: null,
};

const makeQuest = (id: string, sortorder: number, basexp = 100): Quest => ({
  ...QUEST_DEFAULTS,
  id, title: `Quest ${id}`, sortorder, basexp,
});

const PROGRESS_DEFAULTS: Omit<MissionProgress, 'id' | 'userid' | 'questid' | 'status'> = {
  attempts: 1, hintsused: 0, startedat: null, completedat: null,
  first_completed_at: null, updatedat: null, xp_gained: 0,
  completed_activities: null,
};

const makeProgress = (
  questid: string,
  opts: Partial<MissionProgress> = {},
): MissionProgress => ({
  ...PROGRESS_DEFAULTS,
  id: `mp-${questid}`, userid: 'u1', questid, status: 'active',
  ...opts,
});

// ─── Tests ────────────────────────────────────────────────────────────────
describe('buildQuests — gating logic', () => {
  describe('with no progress', () => {
    it('returns empty rows + zero stats for empty quest list', () => {
      const { rows, stats } = buildQuests([], []);
      expect(rows).toEqual([]);
      expect(stats).toEqual({ finished: 0, total: 0, xpEarned: 0, xpTotal: 0, streak: 0 });
    });

    it('makes the first quest active and all later quests locked', () => {
      const quests = [makeQuest('a', 1), makeQuest('b', 2), makeQuest('c', 3)];
      const { rows } = buildQuests(quests, []);
      expect(rows.map(r => r.uiStatus)).toEqual(['active', 'locked', 'locked']);
    });

    it('uses the fixed phase XP cap as xpTotal and leaves xpEarned at 0', () => {
      const quests = [makeQuest('a', 1, 100), makeQuest('b', 2, 50)];
      const { stats } = buildQuests(quests, []);
      expect(stats.xpTotal).toBe(1000);
      expect(stats.xpEarned).toBe(0);
      expect(stats.finished).toBe(0);
    });
  });

  describe('sort order', () => {
    it('sorts quests by sortorder ascending, regardless of input order', () => {
      const quests = [makeQuest('c', 3), makeQuest('a', 1), makeQuest('b', 2)];
      const { rows } = buildQuests(quests, []);
      expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('first_completed_at is the gate (not status)', () => {
    it('unlocks the next quest when previous has first_completed_at set, even if status is "active" (retake)', () => {
      // User completed quest A once, retook it, status is now "active" but
      // first_completed_at is still set — gate should stay OPEN for B.
      const quests = [makeQuest('a', 1), makeQuest('b', 2)];
      const progress = [makeProgress('a', {
        status: 'active',
        first_completed_at: '2026-01-01T00:00:00Z',
      })];
      const { rows } = buildQuests(quests, progress);
      expect(rows[0].uiStatus).toBe('active');         // currently being retaken
      expect(rows[0].everCompleted).toBe(true);
      expect(rows[0].currentlyCompleted).toBe(false);
      expect(rows[1].uiStatus).toBe('active');         // gate stays open
    });

    it('keeps the gate CLOSED when previous quest has status="active" but no first_completed_at', () => {
      // User started A but never finished. B must stay locked.
      const quests = [makeQuest('a', 1), makeQuest('b', 2)];
      const progress = [makeProgress('a', { status: 'active', first_completed_at: null })];
      const { rows } = buildQuests(quests, progress);
      expect(rows[0].everCompleted).toBe(false);
      expect(rows[1].uiStatus).toBe('locked');
    });

    it('marks status="completed" as both completed and everCompleted even without first_completed_at', () => {
      // Defensive: status='completed' alone is enough to count as everCompleted,
      // covering rows from before the v2 migration.
      const quests = [makeQuest('a', 1), makeQuest('b', 2)];
      const progress = [makeProgress('a', { status: 'completed', first_completed_at: null })];
      const { rows } = buildQuests(quests, progress);
      expect(rows[0].uiStatus).toBe('completed');
      expect(rows[0].everCompleted).toBe(true);
      expect(rows[1].uiStatus).toBe('active');
    });
  });

  describe('linear unlock chain', () => {
    it('unlocks quests one at a time as each prior quest is first-completed', () => {
      const quests = [makeQuest('a', 1), makeQuest('b', 2), makeQuest('c', 3)];
      // Only A is finished
      const progress = [makeProgress('a', { status: 'completed', first_completed_at: '2026-01-01T00:00:00Z' })];
      const { rows } = buildQuests(quests, progress);
      expect(rows.map(r => r.uiStatus)).toEqual(['completed', 'active', 'locked']);
    });

    it('unlocks all when every quest has been first-completed', () => {
      const quests = [makeQuest('a', 1), makeQuest('b', 2), makeQuest('c', 3)];
      const progress = quests.map(q => makeProgress(q.id, {
        status: 'completed',
        first_completed_at: '2026-01-01T00:00:00Z',
      }));
      const { rows, stats } = buildQuests(quests, progress);
      expect(rows.every(r => r.uiStatus === 'completed')).toBe(true);
      expect(stats.finished).toBe(3);
    });
  });

  describe('XP accounting', () => {
    it('sums xp_gained from progress into xpEarned', () => {
      const quests = [makeQuest('a', 1, 100), makeQuest('b', 2, 200)];
      const progress = [
        makeProgress('a', { xp_gained: 80 }),
        makeProgress('b', { xp_gained: 150 }),
      ];
      const { stats } = buildQuests(quests, progress);
      expect(stats.xpEarned).toBe(230);
      expect(stats.xpTotal).toBe(1000);
    });

    it('defaults missing xp_gained to 0 per quest', () => {
      const quests = [makeQuest('a', 1, 100)];
      const { rows } = buildQuests(quests, []);
      expect(rows[0].xpGained).toBe(0);
    });
  });

  describe('streak', () => {
    it('counts consecutive first-completed quests from the top', () => {
      const quests = [makeQuest('a', 1), makeQuest('b', 2), makeQuest('c', 3), makeQuest('d', 4)];
      const progress = [
        makeProgress('a', { first_completed_at: '2026-01-01T00:00:00Z' }),
        makeProgress('b', { first_completed_at: '2026-01-02T00:00:00Z' }),
        // c: not finished — breaks streak
        makeProgress('d', { first_completed_at: '2026-01-03T00:00:00Z' }),
      ];
      const { stats } = buildQuests(quests, progress);
      expect(stats.streak).toBe(2);     // a, b
      expect(stats.finished).toBe(3);   // a, b, d (total ever finished)
    });

    it('returns streak=0 when the first quest is unfinished', () => {
      const quests = [makeQuest('a', 1), makeQuest('b', 2)];
      const { stats } = buildQuests(quests, []);
      expect(stats.streak).toBe(0);
    });
  });

  describe('duplicate-progress dedupe', () => {
    it('prefers a row with first_completed_at over one without', () => {
      const quests = [makeQuest('a', 1)];
      const progress = [
        makeProgress('a', { id: 'p-old', first_completed_at: null,                    updatedat: '2026-05-01T00:00:00Z' }),
        makeProgress('a', { id: 'p-new', first_completed_at: '2026-01-01T00:00:00Z', updatedat: '2026-01-01T00:00:00Z' }),
      ];
      const { rows } = buildQuests(quests, progress);
      expect(rows[0].everCompleted).toBe(true);
    });

    it('when both rows have first_completed_at, keeps the more recent updatedat', () => {
      const quests = [makeQuest('a', 1, 100)];
      const progress = [
        makeProgress('a', { id: 'p1', first_completed_at: '2026-01-01T00:00:00Z', updatedat: '2026-01-01T00:00:00Z', xp_gained: 50 }),
        makeProgress('a', { id: 'p2', first_completed_at: '2026-01-01T00:00:00Z', updatedat: '2026-05-01T00:00:00Z', xp_gained: 90 }),
      ];
      const { rows } = buildQuests(quests, progress);
      expect(rows[0].xpGained).toBe(90);
    });
  });

  describe('replay-XP cannot grind unlocks', () => {
    it('a retaken-but-not-yet-finished prior quest still blocks later ones from being newly unlocked beyond what the first-completion permitted', () => {
      // A: first-completed long ago. B: never finished. User starts retaking A.
      // After retake, status='active' on A, first_completed_at preserved.
      // B should be active (unlocked by A's first-completion), C should remain locked.
      const quests = [makeQuest('a', 1), makeQuest('b', 2), makeQuest('c', 3)];
      const progress = [
        makeProgress('a', { status: 'active', first_completed_at: '2026-01-01T00:00:00Z' }),
        // B never touched
      ];
      const { rows } = buildQuests(quests, progress);
      expect(rows.map(r => r.uiStatus)).toEqual(['active', 'active', 'locked']);
    });
  });
});
