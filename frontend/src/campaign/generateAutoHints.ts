import type { ActivityTab, HintItem, Quest } from '../types/campaign';

const fallbackByTab: Record<ActivityTab, HintItem[]> = {
  drag: [
    {
      icon: '💡',
      title: 'Start with the meaning',
      body: 'Read each description first, then match the term that explains the same idea.',
      activity: 'drag',
    },
    {
      icon: '🔎',
      title: 'Use keyword overlap',
      body: 'Look for shared words or related concepts between the draggable item and the drop zone.',
      activity: 'drag',
    },
  ],
  code_fill: [
    {
      icon: '💡',
      title: 'Read around the blank',
      body: 'Check the code before and after the blank to infer what value, operator, or keyword is missing.',
      activity: 'code_fill',
    },
    {
      icon: '🧩',
      title: 'Preserve the statement',
      body: 'The missing answer should complete the existing statement without changing its structure.',
      activity: 'code_fill',
    },
  ],
  balloon: [
    {
      icon: '💡',
      title: 'Eliminate first',
      body: 'Remove choices that describe a different concept, then compare the remaining options carefully.',
      activity: 'balloon',
    },
    {
      icon: '🎯',
      title: 'Match the exact wording',
      body: 'The correct balloon should directly answer the question, not just mention a related topic.',
      activity: 'balloon',
    },
  ],
  ordering: [
    {
      icon: '💡',
      title: 'Find the first dependency',
      body: 'Start with the step that must happen before the others can make sense.',
      activity: 'ordering',
    },
    {
      icon: '🔗',
      title: 'Follow cause and effect',
      body: 'Place each next step after the thing it depends on has already happened.',
      activity: 'ordering',
    },
  ],
  mc: [
    {
      icon: '💡',
      title: 'Focus on the concept',
      body: 'Identify the programming concept being asked about before looking at the choices.',
      activity: 'mc',
    },
    {
      icon: '🔎',
      title: 'Compare close answers',
      body: 'If two choices look similar, check which one exactly matches the rule or behavior in the question.',
      activity: 'mc',
    },
  ],
};

function withContext(hints: HintItem[], context: string | null): HintItem[] {
  if (!context) return hints;
  return [
    {
      ...hints[0],
      body: `${hints[0].body} Pay special attention to "${context}".`,
    },
    ...hints.slice(1),
  ];
}

function compactText(value: unknown, max = 72): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text;
}

export function generateAutoHints(
  quest: Quest | null | undefined,
  activeTab: ActivityTab,
  currentItemIdx = 0,
): HintItem[] {
  if (!quest) return fallbackByTab[activeTab];

  if (activeTab === 'mc' || activeTab === 'balloon') {
    const questions = quest.mc_questions ?? [];
    const hasMode = questions.some(q => q.mode === 'balloon' || q.mode === 'mc');
    const pool = hasMode
      ? questions.filter(q => activeTab === 'balloon' ? q.mode === 'balloon' : q.mode !== 'balloon')
      : questions;
    return withContext(fallbackByTab[activeTab], compactText(pool[currentItemIdx]?.question));
  }

  if (activeTab === 'code_fill') {
    const item = quest.code_fill_items?.[currentItemIdx];
    const context = compactText(item?.caption) ?? compactText(item?.code_lines?.join(' '));
    return withContext(fallbackByTab.code_fill, context);
  }

  if (activeTab === 'ordering') {
    return withContext(fallbackByTab.ordering, compactText(quest.ordering_items?.[0]?.label));
  }

  if (activeTab === 'drag') {
    return withContext(fallbackByTab.drag, compactText(quest.drop_zones?.[0]?.label));
  }

  return fallbackByTab[activeTab];
}
