import { describe, it, expect } from 'vitest';
import {
  computeActivityXP,
  persistedXpGained,
  isRetakeRun,
  levelXpCapForPhase,
  FIRST_COMPLETION_XP,
  RETAKE_COMPLETION_XP,
  LEVEL_XP_CAP_BY_PHASE,
} from '../retakeXp';

describe('computeActivityXP', () => {
  it('awards exactly 200 XP for first full quest completion', () => {
    expect(computeActivityXP({
      isCompleted: false,
      isFullCompletion: true,
      levelRemaining: 999,
    })).toBe(FIRST_COMPLETION_XP);
  });

  it('awards exactly 20 XP for retake full quest completion', () => {
    expect(computeActivityXP({
      isCompleted: true,
      isFullCompletion: true,
      levelRemaining: 999,
    })).toBe(RETAKE_COMPLETION_XP);
  });

  it('awards 0 XP before the full quest is complete', () => {
    expect(computeActivityXP({
      isCompleted: false,
      isFullCompletion: false,
      levelRemaining: 999,
    })).toBe(0);
  });

  it('awards 0 XP when the level cap is already reached', () => {
    expect(computeActivityXP({
      isCompleted: false,
      isFullCompletion: true,
      levelRemaining: 0,
    })).toBe(0);
  });

  it('clamps first-time XP to remaining level cap', () => {
    expect(computeActivityXP({
      isCompleted: false,
      isFullCompletion: true,
      levelRemaining: 75,
    })).toBe(75);
  });

  it('clamps retake XP to remaining level cap', () => {
    expect(computeActivityXP({
      isCompleted: true,
      isFullCompletion: true,
      levelRemaining: 7,
    })).toBe(7);
  });
});

describe('persistedXpGained', () => {
  it('adds credited XP to the prior row value', () => {
    expect(persistedXpGained({
      levelCap: 1000,
      priorXpGained: 0,
      xpDelta: FIRST_COMPLETION_XP,
    })).toBe(FIRST_COMPLETION_XP);
  });

  it('persists retake bonuses above first-completion XP', () => {
    expect(persistedXpGained({
      levelCap: 1000,
      priorXpGained: FIRST_COMPLETION_XP,
      xpDelta: RETAKE_COMPLETION_XP,
    })).toBe(220);
  });

  it('keeps the row monotonic and caps at levelCap', () => {
    expect(persistedXpGained({
      levelCap: 1000,
      priorXpGained: 995,
      xpDelta: RETAKE_COMPLETION_XP,
    })).toBe(1000);
  });

  it('does not decrease the row for zero-XP capped completions', () => {
    expect(persistedXpGained({
      levelCap: 1000,
      priorXpGained: 220,
      xpDelta: 0,
    })).toBe(220);
  });
});

describe('level XP caps', () => {
  it('sets fixed caps per campaign tier', () => {
    expect(LEVEL_XP_CAP_BY_PHASE.beginner).toBe(1000);
    expect(LEVEL_XP_CAP_BY_PHASE.intermediate).toBe(2000);
    expect(LEVEL_XP_CAP_BY_PHASE.advanced).toBe(3000);
  });

  it('returns 0 without a known phase', () => {
    expect(levelXpCapForPhase(null)).toBe(0);
    expect(levelXpCapForPhase(undefined)).toBe(0);
  });
});

describe('isRetakeRun', () => {
  it('returns false when nothing was previously completed', () => {
    expect(isRetakeRun(['mc'], [])).toBe(false);
  });

  it('returns true if any newly-completed tab was ever completed before', () => {
    expect(isRetakeRun(['mc', 'drag'], ['mc'])).toBe(true);
  });

  it('returns false when newly-completed tabs are all new', () => {
    expect(isRetakeRun(['code_fill'], ['mc'])).toBe(false);
  });
});
