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

/** Place the current item's hints before shared and activity-specific quest hints. */
export function composeHints(
  questHints: HintItem[] | null | undefined,
  activeTab:  ActivityTab,
  itemHint?:  ItemHintInput,
): HintItem[] {
  const pool = (questHints ?? []).filter(h => !h.activity || h.activity === activeTab);
  return [...normalizeItemHints(itemHint), ...pool];
}
