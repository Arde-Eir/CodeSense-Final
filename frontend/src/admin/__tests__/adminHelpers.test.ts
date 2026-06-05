import { describe, it, expect } from 'vitest';
import {
  computeUserStats, filterUsers, levelToPhase,
  fixPopLanguageInQuestion, patchMCQuestions, splitMCQuestions,
  normalizeMCQuestionOptions, normalizeMCQuestions,
  parseCodeFillAnswers,
  loadHintsForEdit, serializeHints,
  type AdminUserLite, type MCQuestionLite, type HintFormRow,
} from '../adminHelpers';

// ─── Fixtures ─────────────────────────────────────────────────────────────
const makeUser = (overrides: Partial<AdminUserLite> = {}): AdminUserLite => ({
  id:         overrides.id         ?? 'u1',
  playername: overrides.playername ?? 'player_one',
  email:      overrides.email      ?? 'one@example.com',
  is_admin:   overrides.is_admin   ?? false,
  is_banned:  overrides.is_banned  ?? false,
});

// ─── computeUserStats ─────────────────────────────────────────────────────
describe('computeUserStats', () => {
  it('returns zeros for an empty list', () => {
    expect(computeUserStats([])).toEqual({ total: 0, active: 0, banned: 0, admins: 0 });
  });

  it('counts total, active (not banned), banned, and admins', () => {
    const users = [
      makeUser({ id: '1' }),
      makeUser({ id: '2', is_banned: true }),
      makeUser({ id: '3', is_admin: true }),
      makeUser({ id: '4', is_admin: true, is_banned: true }),
    ];
    expect(computeUserStats(users)).toEqual({
      total: 4, active: 2, banned: 2, admins: 2,
    });
  });

  it('counts a banned admin as both banned and admin', () => {
    const users = [makeUser({ is_admin: true, is_banned: true })];
    const s = computeUserStats(users);
    expect(s.banned).toBe(1);
    expect(s.admins).toBe(1);
    expect(s.active).toBe(0);
  });
});

// ─── filterUsers ──────────────────────────────────────────────────────────
describe('filterUsers', () => {
  const users = [
    makeUser({ id: '1', playername: 'alice',  email: 'alice@x.com' }),
    makeUser({ id: '2', playername: 'bob',    email: 'bob@x.com',   is_banned: true }),
    makeUser({ id: '3', playername: 'carol',  email: 'carol@x.com', is_admin: true }),
    makeUser({ id: '4', playername: 'dave',   email: 'dave@x.com',  is_admin: true, is_banned: true }),
  ];

  it('returns all users when filter=all and search empty', () => {
    expect(filterUsers(users, 'all', '')).toHaveLength(4);
  });

  it('"active" filter drops banned users', () => {
    const r = filterUsers(users, 'active', '');
    expect(r.map(u => u.id).sort()).toEqual(['1', '3']);
  });

  it('"banned" filter keeps only banned users', () => {
    const r = filterUsers(users, 'banned', '');
    expect(r.map(u => u.id).sort()).toEqual(['2', '4']);
  });

  it('"admin" filter keeps only admin users (including banned admins)', () => {
    const r = filterUsers(users, 'admin', '');
    expect(r.map(u => u.id).sort()).toEqual(['3', '4']);
  });

  it('search matches playername (case-insensitive)', () => {
    expect(filterUsers(users, 'all', 'ALICE')).toHaveLength(1);
  });

  it('search matches email (case-insensitive)', () => {
    expect(filterUsers(users, 'all', 'bob@')).toEqual([users[1]]);
  });

  it('combines filter and search (e.g. only active users matching "a")', () => {
    const r = filterUsers(users, 'active', 'a');
    // active = alice (id 1), carol (id 3). Both contain "a".
    expect(r.map(u => u.id).sort()).toEqual(['1', '3']);
  });

  it('trims whitespace from search', () => {
    expect(filterUsers(users, 'all', '   alice   ')).toHaveLength(1);
  });

  it('returns empty list when nothing matches', () => {
    expect(filterUsers(users, 'all', 'zzz_nobody')).toEqual([]);
  });

  it('preserves the input element type (generic)', () => {
    type Big = AdminUserLite & { extra: number };
    const big: Big[] = [{ ...users[0], extra: 42 }];
    const r = filterUsers(big, 'all', '');
    // TypeScript-level: r[0].extra is accessible without cast
    expect(r[0].extra).toBe(42);
  });
});

// ─── levelToPhase ─────────────────────────────────────────────────────────
describe('levelToPhase', () => {
  it('maps 1 → beginner', () => {
    expect(levelToPhase(1)).toBe('beginner');
  });
  it('maps 2 → intermediate', () => {
    expect(levelToPhase(2)).toBe('intermediate');
  });
  it('maps 3 → advanced', () => {
    expect(levelToPhase(3)).toBe('advanced');
  });
  it('maps custom levels to stable generated phase keys', () => {
    expect(levelToPhase(4)).toBe('level_4');
    expect(levelToPhase(8)).toBe('level_8');
  });
});

// ─── fixPopLanguageInQuestion ─────────────────────────────────────────────
describe('fixPopLanguageInQuestion', () => {
  it('rewrites "Pop the item that…" → "Which item…"', () => {
    expect(fixPopLanguageInQuestion('Pop the item that is a pointer'))
      .toBe('Which item is a pointer');
  });

  it('rewrites plural "Pop the items that…" → "Which items…"', () => {
    expect(fixPopLanguageInQuestion('Pop the items that are valid'))
      .toBe('Which items are valid');
  });

  it('rewrites "Pop the item …" (no "that") → "Select the item …"', () => {
    expect(fixPopLanguageInQuestion('Pop the item with the highest XP'))
      .toBe('Select the item with the highest XP');
  });

  it('rewrites bare "Pop …" → "Select …"', () => {
    expect(fixPopLanguageInQuestion('Pop the correct answer'))
      .toBe('Select the correct answer');
  });

  it('is case-insensitive on the leading "Pop"', () => {
    expect(fixPopLanguageInQuestion('pop THE item that fits'))
      .toBe('Which item fits');
  });

  it('leaves non-pop questions untouched', () => {
    const q = 'What is the output of this program?';
    expect(fixPopLanguageInQuestion(q)).toBe(q);
  });

  it('does not rewrite "Pop" in the middle of a sentence', () => {
    const q = 'When do we Pop the stack?';
    expect(fixPopLanguageInQuestion(q)).toBe(q);
  });
});

// ─── patchMCQuestions ─────────────────────────────────────────────────────
describe('patchMCQuestions', () => {
  it('returns changed=0 and an equivalent array when nothing matches', () => {
    const qs: MCQuestionLite[] = [
      { question: 'What is a variable?' },
      { question: 'Define recursion.' },
    ];
    const r = patchMCQuestions(qs);
    expect(r.changed).toBe(0);
    expect(r.patched).toEqual(qs);
  });

  it('counts only questions that actually changed', () => {
    const qs: MCQuestionLite[] = [
      { question: 'Pop the item that fits' },        // changes
      { question: 'Pick a value' },                  // unchanged
      { question: 'Pop the correct one' },           // changes
    ];
    const r = patchMCQuestions(qs);
    expect(r.changed).toBe(2);
    expect(r.patched[0].question).toBe('Which item fits');
    expect(r.patched[1].question).toBe('Pick a value');
    expect(r.patched[2].question).toBe('Select the correct one');
  });

  it('preserves non-question fields on patched items', () => {
    const qs: MCQuestionLite[] = [
      { question: 'Pop the correct one', mode: 'mc', explanation: 'because' } as MCQuestionLite,
    ];
    const r = patchMCQuestions(qs);
    expect(r.patched[0]).toMatchObject({
      mode: 'mc',
      explanation: 'because',
      question: 'Select the correct one',
    });
  });

  it('returns a fresh array (does not mutate input)', () => {
    const qs: MCQuestionLite[] = [{ question: 'Pop the correct one' }];
    const before = JSON.stringify(qs);
    patchMCQuestions(qs);
    expect(JSON.stringify(qs)).toBe(before);
  });
});

// ─── splitMCQuestions ─────────────────────────────────────────────────────
describe('splitMCQuestions', () => {
  it('routes by `mode` when any item has a mode field (new rows)', () => {
    const all: MCQuestionLite[] = [
      { question: 'a', mode: 'mc' },
      { question: 'b', mode: 'balloon' },
      { question: 'c', mode: 'mc' },
    ];
    const r = splitMCQuestions(all, 'multiple_choice');
    expect(r.mc.map(q => q.question)).toEqual(['a', 'c']);
    expect(r.balloon.map(q => q.question)).toEqual(['b']);
  });

  it('treats items without `mode` as NOT balloon when partial mode is present', () => {
    // Mixed rows: one tagged 'mc', one untagged. Untagged is filtered out of
    // the balloon bucket (mode !== 'balloon' is true for undefined).
    const all: MCQuestionLite[] = [
      { question: 'tagged-mc',  mode: 'mc' },
      { question: 'untagged' },
    ];
    const r = splitMCQuestions(all, 'multiple_choice');
    expect(r.mc.map(q => q.question).sort()).toEqual(['tagged-mc', 'untagged']);
    expect(r.balloon).toEqual([]);
  });

  it('legacy: with no mode field, question_type=pop_balloon routes everything to balloon', () => {
    const all: MCQuestionLite[] = [{ question: 'a' }, { question: 'b' }];
    const r = splitMCQuestions(all, 'pop_balloon');
    expect(r.balloon).toHaveLength(2);
    expect(r.mc).toEqual([]);
  });

  it('legacy: with no mode field, non-balloon question_type routes everything to mc', () => {
    const all: MCQuestionLite[] = [{ question: 'a' }, { question: 'b' }];
    const r = splitMCQuestions(all, 'multiple_choice');
    expect(r.mc).toHaveLength(2);
    expect(r.balloon).toEqual([]);
  });

  it('returns two empty buckets when input array is empty', () => {
    expect(splitMCQuestions([], 'pop_balloon')).toEqual({ mc: [], balloon: [] });
  });
});

// ─── normalizeMCQuestionOptions ─────────────────────────────────────────────
describe('normalizeMCQuestionOptions', () => {
  it('drops blank options without padding back to four choices', () => {
    const q = normalizeMCQuestionOptions({
      question: 'Pick one',
      options: ['Alpha', 'Beta', 'Gamma', ''],
      correct: 1,
    });

    expect(q.options).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(q.correct).toBe(1);
  });

  it('moves the correct index when blanks before the answer are removed', () => {
    const q = normalizeMCQuestionOptions({
      question: 'Pick one',
      options: ['Alpha', '', 'Gamma', 'Delta'],
      correct: 2,
    });

    expect(q.options).toEqual(['Alpha', 'Gamma', 'Delta']);
    expect(q.correct).toBe(1);
  });

  it('falls back to the first option when the selected correct answer was blank', () => {
    const q = normalizeMCQuestionOptions({
      question: 'Pick one',
      options: ['Alpha', 'Beta', '', ''],
      correct: 2,
    });

    expect(q.options).toEqual(['Alpha', 'Beta']);
    expect(q.correct).toBe(0);
  });

  it('keeps multiple correct answers and remaps them after blank options are removed', () => {
    const q = normalizeMCQuestionOptions({
      question: 'Pick all valid types',
      options: ['int', '', 'float', 'double'],
      correct: 0,
      correctAnswers: [0, 2, 3],
    });

    expect(q.options).toEqual(['int', 'float', 'double']);
    expect(q.correct).toBe(0);
    expect(q.correctAnswers).toEqual([0, 1, 2]);
  });
});

describe('normalizeMCQuestions', () => {
  it('drops completely empty template rows', () => {
    const qs = normalizeMCQuestions([
      { question: '', options: ['', '', '', ''], correct: 0 },
      { question: 'Real question', options: ['A', 'B', 'C', ''], correct: 2 },
    ]);

    expect(qs).toHaveLength(1);
    expect(qs[0].options).toEqual(['A', 'B', 'C']);
  });
});

// ─── loadHintsForEdit ─────────────────────────────────────────────────────
describe('loadHintsForEdit', () => {
  it('returns [] for null/undefined/non-array input', () => {
    expect(loadHintsForEdit(null)).toEqual([]);
    expect(loadHintsForEdit(undefined)).toEqual([]);
    expect(loadHintsForEdit('not an array')).toEqual([]);
    expect(loadHintsForEdit({ title: 'a' })).toEqual([]);
  });

  it('loads title/body/icon directly into form rows', () => {
    const r = loadHintsForEdit([{ title: 'T', body: 'B', icon: '⭐' }]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: 'T', body: 'B', icon: '⭐', activity: 'all' });
  });

  it('maps known activity values straight through', () => {
    const r = loadHintsForEdit([
      { title: 'a', body: '', activity: 'drag' },
      { title: 'b', body: '', activity: 'code_fill' },
      { title: 'c', body: '', activity: 'mc' },
    ]);
    expect(r.map(h => h.activity)).toEqual(['drag', 'code_fill', 'mc']);
  });

  it('coerces missing or unknown activity to "all"', () => {
    const r = loadHintsForEdit([
      { title: 'untagged', body: '' },
      { title: 'garbage', body: '', activity: 'nonsense' },
    ]);
    expect(r.map(h => h.activity)).toEqual(['all', 'all']);
  });

  it('stashes unknown fields into _extra (preserves SQL-set extras)', () => {
    const r = loadHintsForEdit([
      { title: 't', body: 'b', image: true, custom: 42 },
    ]);
    expect(r[0]._extra).toEqual({ image: true, custom: 42 });
  });

  it('does NOT put known fields into _extra', () => {
    const r = loadHintsForEdit([{ title: 't', body: 'b', icon: '💡', activity: 'mc' }]);
    expect(r[0]._extra).toEqual({});
  });

  it('gives each row a unique stable id', () => {
    const r = loadHintsForEdit([{ title: 'a', body: '' }, { title: 'b', body: '' }]);
    expect(r[0].id).not.toBe(r[1].id);
  });

  it('coerces non-string title/body/icon to empty string', () => {
    const r = loadHintsForEdit([{ title: 123, body: null, icon: false }]);
    expect(r[0]).toMatchObject({ title: '', body: '', icon: '' });
  });
});

// ─── serializeHints ───────────────────────────────────────────────────────
const makeHint = (overrides: Partial<HintFormRow> = {}): HintFormRow => ({
  id: 'h1', title: 'Title', body: 'Body', icon: '', activity: 'all', _extra: {},
  ...overrides,
});

describe('serializeHints', () => {
  it('returns null when no hints are populated', () => {
    expect(serializeHints([])).toBeNull();
    expect(serializeHints([makeHint({ title: '', body: '' })])).toBeNull();
  });

  it('drops empty rows (no title AND no body) but keeps title-only or body-only', () => {
    const out = serializeHints([
      makeHint({ title: '', body: '' }),         // dropped
      makeHint({ title: 'Just title', body: '' }),
      makeHint({ title: '', body: 'Just body' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('writes title and body as plain strings, trimmed', () => {
    const out = serializeHints([makeHint({ title: '  T  ', body: '  B  ' })]);
    expect(out![0]).toMatchObject({ title: 'T', body: 'B' });
  });

  it('omits icon when blank, includes when set', () => {
    const a = serializeHints([makeHint({ icon: '' })])!;
    const b = serializeHints([makeHint({ icon: '⭐' })])!;
    expect(a[0]).not.toHaveProperty('icon');
    expect(b[0]).toHaveProperty('icon', '⭐');
  });

  it('omits activity key when scope is "all" (encodes untagged hint)', () => {
    const out = serializeHints([makeHint({ activity: 'all' })])!;
    expect(out[0]).not.toHaveProperty('activity');
  });

  it('writes activity key when scope is specific', () => {
    const out = serializeHints([makeHint({ activity: 'code_fill' })])!;
    expect(out[0].activity).toBe('code_fill');
  });

  it('merges _extra back into the serialized object (preserves SQL extras)', () => {
    const out = serializeHints([
      makeHint({ title: 't', body: 'b', _extra: { image: true, custom: 42 } }),
    ])!;
    expect(out[0]).toMatchObject({ title: 't', body: 'b', image: true, custom: 42 });
  });

  it('edited fields take precedence over _extra (no shadowing)', () => {
    // If somehow `_extra` contained title/body/icon/activity (it shouldn't,
    // because loadHintsForEdit filters them out), the edited fields win.
    const out = serializeHints([
      makeHint({
        title: 'edited',
        body:  'edited',
        _extra: { title: 'stale', body: 'stale', extra: 'kept' },
      }),
    ])!;
    expect(out[0].title).toBe('edited');
    expect(out[0].body).toBe('edited');
    expect(out[0].extra).toBe('kept');
  });

  it('round-trips a full hint through load → serialize without losing data', () => {
    const original = [
      { title: 'Hint A', body: 'Body A', icon: '💡', activity: 'mc' },
      { title: 'Hint B', body: 'Body B', image: true },  // untagged + extra field
    ];
    const rows = loadHintsForEdit(original);
    const out  = serializeHints(rows)!;
    expect(out[0]).toEqual({ title: 'Hint A', body: 'Body A', icon: '💡', activity: 'mc' });
    expect(out[1]).toEqual({ title: 'Hint B', body: 'Body B', image: true });
  });
});

// ─── parseCodeFillAnswers ─────────────────────────────────────────────────
describe('parseCodeFillAnswers', () => {
  it('splits a simple comma-separated list', () => {
    expect(parseCodeFillAnswers('int,main,return')).toEqual(['int', 'main', 'return']);
  });

  it('trims whitespace around each token', () => {
    expect(parseCodeFillAnswers('  int ,   main, return ')).toEqual(['int', 'main', 'return']);
  });

  it('drops empty entries (trailing comma, double comma, all-whitespace token)', () => {
    expect(parseCodeFillAnswers('int,,main, ,return,')).toEqual(['int', 'main', 'return']);
  });

  it('returns an empty array for an empty / whitespace-only string', () => {
    expect(parseCodeFillAnswers('')).toEqual([]);
    expect(parseCodeFillAnswers('   ')).toEqual([]);
    expect(parseCodeFillAnswers(',,,')).toEqual([]);
  });

  it('preserves single answers without commas', () => {
    expect(parseCodeFillAnswers('printf')).toEqual(['printf']);
  });
});
