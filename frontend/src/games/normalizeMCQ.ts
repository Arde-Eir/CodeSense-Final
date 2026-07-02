import type { MCQ } from '@/types/campaign';

export function normalizeMCQOptions(question: MCQ): MCQ {
  const options = Array.isArray(question.options) ? question.options : [];
  const compact = options
    .map((option, originalIndex) => ({
      originalIndex,
      value: String(option ?? '').trim(),
    }))
    .filter(option => option.value.length > 0);

  const readIndices = (value: unknown): number[] => {
    const values = Array.isArray(value) ? value : [value];
    return values
      .map(v => typeof v === 'number' ? v : Number(v))
      .filter(v => Number.isInteger(v) && v >= 0);
  };

  const rawCorrectIndices = [
    ...readIndices(question.correctAnswers),
    ...readIndices(question.correct_answers),
    ...readIndices(question.correct_indices),
    ...readIndices(question.correct),
  ];
  const uniqueRawCorrectIndices = Array.from(new Set(rawCorrectIndices.length ? rawCorrectIndices : [0]));

  const correctAnswers = uniqueRawCorrectIndices
    .map(rawCorrect => {
      const correctValue = options[rawCorrect];
      const correctText = String(correctValue ?? '').trim();
      return compact.findIndex(option =>
        option.originalIndex === rawCorrect || option.value === correctText
      );
    })
    .filter((idx, pos, arr) => idx >= 0 && arr.indexOf(idx) === pos);

  const normalizedCorrectAnswers = correctAnswers.length > 0
    ? correctAnswers
    : (compact.length > 0 ? [0] : []);

  return {
    ...question,
    options: compact.map(option => option.value),
    correct: normalizedCorrectAnswers[0] ?? 0,
    correctAnswers: normalizedCorrectAnswers,
  };
}

export function normalizeMCQList(questions: MCQ[]): MCQ[] {
  return questions
    .map(normalizeMCQOptions)
    .filter(question => question.question.trim().length > 0 && question.options.length > 0);
}
