// frontend/src/campaign/retakeXp.ts
// Pure XP-accounting for campaign quests.
//
// Contract:
//   • First full quest completion: 200 XP.
//   • Retake full quest completion: 20 XP.
//   • Partial activity completion: 0 XP. This prevents tab-by-tab farming.
//   • Phase XP caps are fixed per tier and clamp rewards to 0 once full.
//   • `isCompleted` is the durable "has this quest ever been completed"
//     flag. In the DB-backed UI it is derived from first_completed_at.

import type { ActivityTab, Phase } from '../types/campaign';

export const FIRST_COMPLETION_XP = 200;
export const RETAKE_COMPLETION_XP = 20;

export const LEVEL_XP_CAP_BY_PHASE: Record<Phase, number> = {
  beginner: 1000,
  intermediate: 2000,
  advanced: 3000,
};

export function levelXpCapForPhase(phase: Phase | null | undefined): number {
  return phase ? LEVEL_XP_CAP_BY_PHASE[phase] : 0;
}

export interface RetakeXpInputs {
  /** Durable quest completion flag. true means this completion is a retake. */
  isCompleted:      boolean;
  /** True only when all required quest activities are now complete. */
  isFullCompletion: boolean;
  /** Remaining headroom on the phase's XP cap. 0 means cap is hit. */
  levelRemaining:   number;
}

/** XP for the current completion event. */
export function computeActivityXP(inp: RetakeXpInputs): number {
  if (!inp.isFullCompletion || inp.levelRemaining <= 0) return 0;
  const reward = inp.isCompleted ? RETAKE_COMPLETION_XP : FIRST_COMPLETION_XP;
  return Math.min(reward, inp.levelRemaining);
}

export interface PersistXpInputs {
  /** Max campaign XP that can be credited within the phase. */
  levelCap:         number;
  /** mission_progress.xp_gained for this quest, BEFORE this completion. */
  priorXpGained:    number;
  /** XP credited by this completion event. */
  xpDelta:          number;
}

/** Decide what to write to mission_progress.xp_gained.
 *  The row is monotonic and capped so reloads cannot reopen cap headroom. */
export function persistedXpGained(inp: PersistXpInputs): number {
  const cap = Math.max(0, inp.levelCap);
  return Math.min(cap, Math.max(inp.priorXpGained, inp.priorXpGained + Math.max(0, inp.xpDelta)));
}

/** True when at least one tab in `newFinished` was previously completed —
 *  i.e. this completion run is a retake rather than a first attempt. */
export function isRetakeRun(
  newFinished:    ActivityTab[],
  everCompleted:  ActivityTab[],
): boolean {
  return newFinished.some(t => everCompleted.includes(t));
}
