import { describe, expect, it } from 'vitest';
import {
  MAX_OPTIONS,
  MAX_QUESTIONS,
  answeredCount,
  formatAnswersForModel,
  hasAnyAnswer,
  isAnswerable,
  normalizeAnswer,
  normalizeQuestions
} from '../src/shared/questions';

describe('question normalisation', () => {
  it('keeps a well-formed question exactly as asked', () => {
    const questions = normalizeQuestions([
      {
        header: 'ฐานข้อมูล',
        question: 'จะใช้ฐานข้อมูลอะไร?',
        options: [
          { label: 'PostgreSQL', description: 'มีอยู่แล้วในเครื่อง' },
          { label: 'SQLite' }
        ]
      }
    ]);

    expect(questions).toHaveLength(1);
    expect(questions[0].header).toBe('ฐานข้อมูล');
    expect(questions[0].options.map((option) => option.label)).toEqual(['PostgreSQL', 'SQLite']);
    expect(questions[0].options[0].description).toBe('มีอยู่แล้วในเครื่อง');
  });

  it('accepts plain strings as questions and as options', () => {
    // Models that skip the schema still get a usable card.
    const questions = normalizeQuestions([
      { question: 'จะทำกี่หน้า?', options: ['หนึ่งหน้า', 'ห้าหน้า'] },
      'แล้วจะใช้ภาษาอะไร?'
    ]);

    expect(questions).toHaveLength(2);
    expect(questions[0].options).toHaveLength(2);
    expect(questions[0].options[0]).toEqual({ label: 'หนึ่งหน้า' });
    expect(questions[1].options).toEqual([]);
    expect(questions[1].allowFreeText).toBe(true);
  });

  it('reads a single question object as well as a list', () => {
    const questions = normalizeQuestions({ question: 'จะเอาแบบไหน?', options: [{ label: 'A' }] });
    expect(questions).toHaveLength(1);
  });

  it('drops what cannot be asked or clicked', () => {
    const questions = normalizeQuestions([
      { question: '   ' },
      { question: 'จริง ๆ', options: [{ label: '' }, 'ใช้ได้' ] },
      null,
      42
    ]);

    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe('จริง ๆ');
    expect(questions[0].options.map((option) => option.label)).toEqual(['ใช้ได้']);
  });

  it('bounds the questions and the options', () => {
    const many = normalizeQuestions(
      Array.from({ length: 9 }, (_, index) => ({
        question: `คำถาม ${index}`,
        options: Array.from({ length: 12 }, (_, option) => ({ label: `ตัวเลือก ${option}` }))
      }))
    );

    expect(many).toHaveLength(MAX_QUESTIONS);
    expect(many[0].options).toHaveLength(MAX_OPTIONS);
  });

  it('trims and collapses whitespace, and caps runaway text', () => {
    const questions = normalizeQuestions([{ question: `  จะ  ทำ   อะไร  ${'x'.repeat(900)}` }]);
    expect(questions[0].question.startsWith('จะ ทำ อะไร')).toBe(true);
    expect(questions[0].question.length).toBeLessThanOrEqual(400);
  });

  it('a question with no options is answerable by typing, one with only bad options too', () => {
    expect(isAnswerable({ question: 'x', options: [] })).toBe(true);
    expect(isAnswerable({ question: 'x', options: [{ label: 'A' }] })).toBe(true);
    expect(isAnswerable({ question: 'x', options: [], allowFreeText: false })).toBe(false);
  });
});

describe('answers', () => {
  const questions = normalizeQuestions([
    { question: 'ฐานข้อมูล?', options: [{ label: 'Postgres' }, { label: 'SQLite' }] },
    { question: 'หน้าไหนบ้าง?', options: [{ label: 'หน้าแรก' }, { label: 'หลังบ้าน' }], multiSelect: true }
  ]);

  it('keeps only options that were really on the card', () => {
    const answer = normalizeAnswer(questions, {
      answers: [
        { selected: ['Postgres', 'ไม่มีในตัวเลือก'] },
        { selected: ['หน้าแรก', 'หลังบ้าน'] }
      ]
    });

    expect(answer.answers[0].selected).toEqual(['Postgres']);
    expect(answer.answers[1].selected).toEqual(['หน้าแรก', 'หลังบ้าน']);
  });

  it('takes one pick on a single-choice question', () => {
    const answer = normalizeAnswer(questions, {
      answers: [{ selected: ['Postgres', 'SQLite'] }, { selected: [] }]
    });
    expect(answer.answers[0].selected).toEqual(['Postgres']);
  });

  it('keeps a typed answer', () => {
    const answer = normalizeAnswer(questions, {
      answers: [{ note: 'ใช้ MySQL' }, { selected: [] }]
    });
    expect(answer.answers[0].note).toBe('ใช้ MySQL');
    expect(hasAnyAnswer(answer)).toBe(true);
  });

  it('counts answers aligned to the questions that were asked', () => {
    const answer = normalizeAnswer(questions, {
      answers: [{ selected: ['SQLite'] }, { selected: [] }]
    });
    expect(answeredCount(questions, answer)).toBe(1);
  });

  it('an empty submission is not an answer', () => {
    const answer = normalizeAnswer(questions, { answers: [] });
    expect(hasAnyAnswer(answer)).toBe(false);
    expect(answeredCount(questions, answer)).toBe(0);
  });
});

describe('what the model reads back', () => {
  const questions = normalizeQuestions([
    { question: 'ฐานข้อมูล?', options: [{ label: 'Postgres' }] },
    { question: 'ทำไม?', options: [{ label: 'เร็ว' }] }
  ]);

  it('lists every question with its answer, in Thai or English', () => {
    const answer = normalizeAnswer(questions, {
      answers: [{ selected: ['Postgres'], note: 'มีอยู่แล้ว' }, { selected: ['เร็ว'] }]
    });

    const th = formatAnswersForModel('th', questions, answer);
    expect(th).toContain('คำตอบจากผู้ใช้:');
    expect(th).toContain('1. ฐานข้อมูล?');
    expect(th).toContain('Postgres');
    expect(th).toContain('มีอยู่แล้ว');
    expect(th).toContain('อย่าถามซ้ำ');

    const en = formatAnswersForModel('en', questions, answer);
    expect(en).toContain('The user answered:');
    expect(en).toContain('do not ask the same thing again');
  });

  it('a skipped card tells the model to decide and say what it assumed', () => {
    const skipped = formatAnswersForModel('th', questions, { answers: [], skipped: true });
    expect(skipped).toContain('ข้าม');
    expect(skipped).toContain('สมมติฐาน');
  });

  it('marks a question the user left alone instead of inventing an answer', () => {
    const partial = formatAnswersForModel('en', questions, normalizeAnswer(questions, {
      answers: [{ selected: ['Postgres'] }, { selected: [] }]
    }));
    expect(partial).toContain('(no option picked)');
  });
});
