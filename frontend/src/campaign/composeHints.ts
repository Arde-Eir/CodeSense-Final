// frontend/src/campaign/composeHints.ts
// Combines the per-question hint (if any) with the per-tab pool into the
// list shown by the lesson side panel.
//
// Stacking order: per-question hint FIRST (most specific), then the per-tab
// pool in author order. This way the first reveal is the most actionable.
//
// Extracted from lessonactivity.tsx for unit testing.

import type { ActivityTab, HintItem } from '../types/campaign';

/** Build the visible hint list for the current activity tab + current item.
 *
 *  @param questHints   Per-quest hints (Quest.hints). Pool for this tab is
 *                      the subset where activity is unset or equals `activeTab`.
 *  @param activeTab    The tab the player is on right now.
 *  @param itemHint     Optional per-question hint (MCQ.hint, OrderItem.hint,
 *                      CodeFillItem.hint). When present, becomes the FIRST entry.
 */
export function composeHints(
  questHints: HintItem[] | null | undefined,
  activeTab:  ActivityTab,
  itemHint?:  string | null,
): HintItem[] {
  const pool = (questHints ?? []).filter(h => !h.activity || h.activity === activeTab);
  const trimmed = (itemHint ?? '').trim();
  if (!trimmed) return pool;
  return [
    { icon: '🎯', title: 'Hint for this question', body: trimmed },
    ...pool,
  ];
}
