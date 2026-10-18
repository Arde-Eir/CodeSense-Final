import type { ActivityTab, HintItem, Quest } from '@/types/campaign';
import { composeHints } from './composeHints';
import { normalizeMCQList } from '@/games/normalizeMCQ';

const compact = (text: string, length: number): string => {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > length ? `${value.slice(0, length).replace(/\s+\S*$/, '')}…` : value;
};

const hideAnswers = (text: string, answers: string[]): string => answers.filter(answer => answer.trim()).reduce((value, answer) => {
  const term = answer.toLowerCase().replace(/([^s])s$/, '$1').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${term}s?(?![\\p{L}\\p{N}_])`, 'giu'), '[the missing concept]');
}, text);

const finishHints = (activity: ActivityTab, itemIndex: number, hints: HintItem[]): HintItem[] => hints
  .filter((hint, index) => hint.body.trim() && hints.findIndex(other => other.body.trim().toLowerCase() === hint.body.trim().toLowerCase()) === index)
  .slice(0, 3)
  .map(hint => ({ ...hint, activity, item_index: itemIndex }));

const itemsForProblem = <T extends { problem_id?: string }>(items: T[], index: number): T[] => {
  const ids = [...new Set(items.map(item => item.problem_id ?? 'default'))];
  return items.filter(item => (item.problem_id ?? 'default') === ids[index]);
};

/** Create progressive clues from the active question, code example, or puzzle. */
export function generateAutoHints(quest: Quest | null | undefined, activeTab: ActivityTab, currentItemIdx: number): HintItem[] {
  if (!quest) return [];

  if (activeTab === 'mc' || activeTab === 'balloon') {
    const questions = normalizeMCQList(quest.mc_questions ?? []);
    const hasMode = questions.some(question => question.mode === 'balloon' || question.mode === 'mc');
    const pool = hasMode ? questions.filter(question => activeTab === 'balloon' ? question.mode === 'balloon' : question.mode !== 'balloon') : questions;
    const question = pool[currentItemIdx];
    if (!question?.question.trim()) return [];
    const indices = [...new Set(question.correctAnswers ?? [question.correct])];
    const answers = indices.map(index => question.options[index]).filter((answer): answer is string => typeof answer === 'string' && answer.length > 0);
    const evidence = hideAnswers(question.explanation, answers);
    const authored = composeHints(null, activeTab, question.hint, currentItemIdx);
    const wrongOptions = question.options.filter((option, index) => option.trim() && !indices.includes(index));
    return finishHints(activeTab, currentItemIdx, [
      ...authored,
      { icon: '🔎', title: 'Focus on the requirement', body: evidence.trim()
        ? `Use this detail from the material: “${compact(evidence, 220)}” Compare the role or operation it describes with the choices.`
        : `Separate the requirement in “${compact(hideAnswers(question.question, answers), 160)}” into what is needed and what each option does.` },
      { icon: '🎯', title: activeTab === 'balloon' ? 'Check every required balloon' : 'Eliminate a mismatch', body: activeTab === 'balloon' && indices.length > 1
        ? `This question has ${indices.length} correct balloons. Each must independently fit the requirement; popping only one does not complete the question.`
        : wrongOptions.length >= 2 ? `You can rule out “${compact(wrongOptions[0], 65)}”. Compare the remaining choices against every detail of the source clue, rather than a single matching word.`
          : 'For each remaining option, substitute it into the question and check the complete meaning against the source explanation.' },
      { icon: '🧩', title: 'Check the complete statement', body: `Re-read “${compact(hideAnswers(question.question, answers), 180)}” with your chosen option. Every part of the statement must fit.` },
    ]);
  }

  if (activeTab === 'code_fill') {
    const item = quest.code_fill_items?.[currentItemIdx];
    if (!item) return [];
    const line = item.code_lines.find(value => value.includes('___'));
    if (!line) return [];
    let answerIndex = 0;
    const original = item.code_lines.join('\n').replace(/___/g, () => item.answers[answerIndex++] ?? '___');
    const section = quest.theory_sections?.find(value => value.code === original);
    return finishHints(activeTab, currentItemIdx, [
      ...composeHints(null, activeTab, item.hint, currentItemIdx),
      { icon: '🔎', title: 'Read the surrounding syntax', body: `Focus on this line: “${compact(line, 180)}”. Use its brackets, operators, and neighboring expressions to identify the role of the missing token.` },
      { icon: '📖', title: 'Compare with the source example', body: section?.heading
        ? `Review “${section.heading}” in the theory. Trace this same line in the example, then restore the token without changing the rest of the statement.`
        : `Use the example referenced by “${compact(item.caption ?? 'this code exercise', 100)}”. Check the statement's purpose before deciding on the missing token.` },
      { icon: '🧩', title: 'Verify each blank', body: `This item has ${item.answers.length} blank${item.answers.length === 1 ? '' : 's'}. Restore the tokens in left-to-right order and preserve the spelling and case used in the source.` },
    ]);
  }

  if (activeTab === 'drag') {
    const items = itemsForProblem(quest.game_items ?? [], currentItemIdx);
    if (!items.length) return [];
    const ids = new Set(items.map(item => item.id));
    const zones = (quest.drop_zones ?? []).filter(zone => ids.has(zone.accepted));
    const zone = zones[0];
    if (!zone) return [];
    const detail = compact(hideAnswers(zone.label, items.map(item => item.label)), 180);
    const mismatch = items.find(item => item.id !== zone.accepted);
    return finishHints(activeTab, currentItemIdx, [
      { icon: '💡', title: 'Match the role, not just a word', body: `Start with the description “${detail}”. Identify what is stored, tested, repeated, or represented before choosing a term.` },
      { icon: '🔎', title: 'Compare the possible matches', body: `Compare the roles of ${items.slice(0, 3).map(item => `“${compact(item.label, 45)}”`).join(', ')}. A valid match must explain the whole description, including any limits or conditions.` },
      { icon: '🧩', title: 'Narrow one pair', body: mismatch
        ? `For “${detail}”, rule out “${compact(mismatch.label, 55)}”. Use that term's own definition to find its appropriate description elsewhere in this ${zones.length}-pair puzzle.`
        : `Check all ${zones.length} pairs against their definitions before submitting; matching a familiar word alone is insufficient.` },
    ]);
  }

  const items = itemsForProblem(quest.ordering_items ?? [], currentItemIdx).sort((first, second) => first.correct_order - second.correct_order);
  if (!items.length) return [];
  const sourceOrder = /lesson|theory|introduced|appear|numbered|source/i.test(items[0].question ?? '');
  const middle = Math.floor(items.length / 2);
  return finishHints(activeTab, currentItemIdx, [
    { icon: '💡', title: sourceOrder ? 'Use the order in the material' : 'Trace what must happen first', body: sourceOrder
      ? `This ${items.length}-item puzzle asks for the sequence presented in the learning material. Follow that sequence rather than sorting the labels alphabetically or by familiarity.`
      : 'Trace the procedure from its starting conditions. For each step, identify what must already be available before it can happen.' },
    { icon: '🔗', title: 'Check neighboring items', body: sourceOrder
      ? 'Find these items in the theory and compare neighboring entries in that same list or topic sequence. Keep each local pair in the same relative order.'
      : 'Check adjacent steps for dependencies: data must exist before it can be used, and a condition must be tested at the point required by the procedure.' },
    { icon: '🎯', title: 'Use a sequence anchor', body: items.length > 1
      ? `In this source sequence, “${compact(items[middle - 1].label, 80)}” comes directly before “${compact(items[middle].label, 80)}”. Keep that pair together while placing the other items.`
      : 'Compare this item with the sequence in the material before submitting.' },
  ]);
}
