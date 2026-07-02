import { describe, it, expect } from 'vitest';
import { generateAutoHints } from '@/campaign/generateAutoHints';
import type { Quest } from '@/types/campaign';

const baseQuest: Quest = {
  id: 'q1',
  title: 'Loops',
  description: null,
  difficulty: 'easy',
  level: 1,
  phase: 'beginner',
  mode: 'campaign',
  basexp: 200,
  requiredxp: 0,
  sortorder: 1,
  isactive: true,
  question_type: 'multiple_choice',
  objectives: null,
  hints: null,
  game_items: null,
  drop_zones: null,
  ordering_items: null,
  mc_questions: null,
  code_fill_items: null,
  tutorial_title: null,
  tutorial_body: null,
  tutorial_image: null,
  theory_sections: null,
};

describe('generateAutoHints', () => {
  it('creates a generic hint ladder for each campaign activity', () => {
    expect(generateAutoHints(baseQuest, 'mc')).toHaveLength(2);
    expect(generateAutoHints(baseQuest, 'drag')[0]).toMatchObject({ activity: 'drag' });
    expect(generateAutoHints(baseQuest, 'code_fill')[0]).toMatchObject({ activity: 'code_fill' });
    expect(generateAutoHints(baseQuest, 'ordering')[0]).toMatchObject({ activity: 'ordering' });
    expect(generateAutoHints(baseQuest, 'balloon')[0]).toMatchObject({ activity: 'balloon' });
  });

  it('adds current multiple-choice question context without revealing the answer', () => {
    const quest: Quest = {
      ...baseQuest,
      mc_questions: [{
        id: 'm1',
        question: 'Which loop runs at least once?',
        options: ['for', 'while', 'do while', 'if'],
        correct: 2,
        explanation: 'do while checks after running.',
      }],
    };

    const hints = generateAutoHints(quest, 'mc', 0);
    expect(hints[0].body).toContain('Which loop runs at least once?');
    expect(hints[0].body).not.toContain('do while checks after running.');
  });

  it('uses code-fill caption as context when available', () => {
    const quest: Quest = {
      ...baseQuest,
      code_fill_items: [{
        id: 'c1',
        code_lines: ['int total = ___;'],
        answers: ['0'],
        caption: 'Initialize the accumulator',
      }],
    };

    expect(generateAutoHints(quest, 'code_fill', 0)[0].body).toContain('Initialize the accumulator');
  });
});
