// frontend/src/campaign/composeHints.ts
// Combines the per-question hint (if any) with the per-tab pool into the
// list shown by the lesson side panel.
//
// Stacking order: per-question hint FIRST (most specific), then the per-tab
// pool in author order. This way the first reveal is the most actionable.
//
// Extracted from lessonactivity.tsx for unit testing.

import type { ActivityTab, HintItem } from '@/types/campaign';

export type ItemHintInput = string | string[] | HintItem | HintItem[] | null | undefined;

function normalizeItemHints(itemHint: ItemHintInput): HintItem[] {
  if (!itemHint) return [];
  const values = Array.isArray(itemHint) ? itemHint : [itemHint];
  return values.flatMap((hint, index) => {
    if (typeof hint === 'string') {
      const body = hint.trim();
      return body ? [{ icon: '🎯', title: index === 0 ? 'Hint for this question' : `Hint ${index + 1} for this question`, body }] : [];
    }

    if (!hint || typeof hint !== 'object') return [];
    const title = String(hint.title ?? '').trim() || (index === 0 ? 'Hint for this question' : `Hint ${index + 1} for this question`);
    const body = String(hint.body ?? '').trim();
    if (!body) return [];
    return [{ ...hint, icon: hint.icon ?? '🎯', title, body }];
  });
}

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
  itemHint?:  ItemHintInput,
): HintItem[] {
  const pool = (questHints ?? []).filter(h => !h.activity || h.activity === activeTab);
  return [...normalizeItemHints(itemHint), ...pool];
}
