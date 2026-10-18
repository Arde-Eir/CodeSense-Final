import { generateAutoHints } from '@/campaign/generateAutoHints'
import type { ActivityTab } from '@/types/campaign'
import type { HintFormRow } from './adminHelpers'
import { questPreviewFromForm, selectedTabsForForm, tabHasContent, type QuestFormState } from './adminPanelModel'

/** Use the same question-specific hints for generated PDF drafts and the builder's hint action. */
export const generateQuestHintRows = (form: QuestFormState, idPrefix: string): HintFormRow[] => {
  const preview = questPreviewFromForm(form)
  const counts: Record<ActivityTab, number> = {
    mc: form.mc_questions.length, balloon: form.balloon_questions.length,
    drag: form.drag_problems.length, ordering: form.ordering_problems.length, code_fill: form.code_fill_items.length,
  }
  return selectedTabsForForm(form).filter(tab => tabHasContent(form, tab)).flatMap(tab =>
    Array.from({ length: counts[tab] }, (_, itemIndex) => generateAutoHints(preview, tab, itemIndex).map((hint, hintIndex) => ({
      id: `${idPrefix}_${tab}_${itemIndex}_${hintIndex}`, title: hint.title, body: hint.body,
      icon: hint.icon ?? '', activity: tab, _extra: { item_index: itemIndex },
    }))).flat()
  )
}
