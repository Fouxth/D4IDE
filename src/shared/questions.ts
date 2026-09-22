/**
 * Questions, and the answer that goes back to the model.
 *
 * A model asking the user something is only useful if the ask is answerable: a
 * question with no options is a chat message, and a question with twenty options
 * is a menu nobody reads. Everything here is pure and bounded, so the tool
 * arguments a model invented are shaped into something the card can render, and
 * the runtime can be tested without an Electron window.
 *
 * The module is shared on purpose: the runtime turns tool arguments into
 * questions, the renderer renders the very same objects, and the text the model
 * reads back is produced here too — one definition, three consumers.
 */

import { AgentQuestion, QuestionAnswer, QuestionAnswerEntry, QuestionOption } from './types';

/** Caps that keep a question card readable. */
export const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 6;
export const MAX_QUESTION_CHARS = 400;
export const MAX_LABEL_CHARS = 90;
export const MAX_HEADER_CHARS = 48;

const text = (value: unknown, limit: number): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
};

const optionsOf = (raw: unknown): QuestionOption[] => {
  if (!Array.isArray(raw)) return [];
  const options: QuestionOption[] = [];
  for (const entry of raw) {
    // A model that writes plain strings instead of objects still gets a usable
    // card — that shape is common enough to be worth accepting.
    if (typeof entry === 'string') {
      const label = text(entry, MAX_LABEL_CHARS);
      if (label) options.push({ label });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as Record<string, unknown>;
    const label = text(value.label ?? value.value ?? value.title, MAX_LABEL_CHARS);
    if (!label) continue;
    const description = text(value.description ?? value.hint ?? value.detail, 200);
    // The AI's own recommendation: either a boolean flag on the option or a
    // bare string naming it. A recommendation nobody can see is worthless, so
    // the flag travels with the option to the card.
    const flag = value.recommended === true || value.suggested === true;
    const reason = text(value.reason ?? value.why ?? value.because, 140);
    options.push({
      label,
      ...(description ? { description } : {}),
      ...(flag ? { recommended: true } : {}),
      ...(reason ? { reason } : {})
    });
    if (options.length >= MAX_OPTIONS) break;
  }
  return options;
};

/**
 * Turns whatever the model passed to `ask_question` into renderable questions.
 *
 * Unusable material is dropped rather than guessed at: a question with no text
 * cannot be asked, and an option with no label cannot be clicked. A question
 * that lost all its options is kept as a free-text ask instead of disappearing —
 * the user can still answer it, which is more useful than a hole in the card.
 */
export function normalizeQuestions(raw: unknown): AgentQuestion[] {
  const source = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const questions: AgentQuestion[] = [];

  for (const entry of source) {
    if (questions.length >= MAX_QUESTIONS) break;

    if (typeof entry === 'string') {
      const question = text(entry, MAX_QUESTION_CHARS);
      if (question) questions.push({ question, options: [], allowFreeText: true });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;

    const value = entry as Record<string, unknown>;
    const question = text(value.question ?? value.text ?? value.prompt, MAX_QUESTION_CHARS);
    if (!question) continue;

    const options = optionsOf(value.options ?? value.choices);
    const header = text(value.header ?? value.topic ?? value.title, MAX_HEADER_CHARS);
    const multiSelect = value.multiSelect === true || value.multiple === true;
    const allowFreeText = value.allowFreeText === true || value.freeText === true || options.length === 0;
    // The AI's lean when it has one: a sentence naming its suggestion and why,
    // shown once under the options. Aliases cover the shapes models actually
    // emit (suggestion / recommend / aiRecommend).
    const aiSuggestion = text(
      value.aiSuggestion ?? value.suggestion ?? value.recommendation ?? value.aiRecommend,
      220
    );

    questions.push({
      ...(header ? { header } : {}),
      question,
      options,
      ...(multiSelect ? { multiSelect: true } : {}),
      ...(allowFreeText ? { allowFreeText: true } : {}),
      ...(aiSuggestion ? { aiSuggestion } : {})
    });
  }

  return questions;
}

/** True when a question can be answered at all. */
export function isAnswerable(question: AgentQuestion): boolean {
  if (question.options.length > 0) return true;
  return question.allowFreeText !== false;
}

/**
 * How many questions the user must answer before the primary button means
 * anything: every question needs a pick or a line of their own.
 */
export function answeredCount(questions: AgentQuestion[], answer: Partial<QuestionAnswer> | null): number {
  if (!answer?.answers?.length) return 0;
  let count = 0;
  questions.forEach((question, index) => {
    const entry = answer.answers?.[index];
    if (!entry) return;
    if (entry.selected.length > 0 || (entry.note || '').trim()) count += 1;
  });
  return count;
}

/** The answer, aligned to the questions that were asked. */
export function normalizeAnswer(questions: AgentQuestion[], raw: unknown): QuestionAnswer {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawAnswers = Array.isArray(source.answers) ? (source.answers as Record<string, unknown>[]) : [];

  const answers: QuestionAnswerEntry[] = questions.map((question, index) => {
    const entry = rawAnswers[index] ?? {};
    const selected = Array.isArray(entry.selected)
      ? (entry.selected as unknown[])
          .map((value) => text(value, MAX_LABEL_CHARS))
          .filter((label) => !!label && question.options.some((option) => option.label === label))
      : [];
    const note = text(entry.note ?? entry.freeText, 600);
    return {
      question: question.question,
      selected: question.multiSelect ? selected : selected.slice(0, 1),
      ...(note ? { note } : {})
    };
  });

  return { answers, ...(source.skipped === true ? { skipped: true } : {}) };
}

/** Whether the user actually decided anything on the card. */
export function hasAnyAnswer(answer: QuestionAnswer): boolean {
  return answer.answers.some((entry) => entry.selected.length > 0 || !!entry.note?.trim());
}

/**
 * The tool result the model reads. It has to say two things plainly: which
 * question got which answer, and — when the card was dismissed — that it is on
 * its own and must state the assumption it makes instead of asking again.
 */
export function formatAnswersForModel(
  language: 'th' | 'en',
  questions: AgentQuestion[],
  answer: QuestionAnswer
): string {
  const header = language === 'th' ? 'คำตอบจากผู้ใช้:' : 'The user answered:';

  if (answer.skipped || !hasAnyAnswer(answer)) {
    return language === 'th'
      ? `${header} ผู้ใช้ปิดการ์ดคำถามโดยไม่ตอบ (ข้าม)\nไปต่อด้วยทางเลือกที่สมเหตุสมผลที่สุด พร้อมระบุสมมติฐานที่ใช้ และห้ามถามซ้ำในเรื่องเดิม`
      : `${header} the user dismissed the questions without answering (skipped).\nProceed with the most reasonable default, state the assumption you made, and do not ask the same thing again.`;
  }

  const lines = questions.map((question, index) => {
    const entry = answer.answers[index];
    const chosen = entry?.selected?.length
      ? entry.selected.join(', ')
      : language === 'th'
        ? '(ไม่ได้เลือกตัวเลือก)'
        : '(no option picked)';
    const note = entry?.note ? `\n   ${language === 'th' ? 'เพิ่มเติม' : 'note'}: ${entry.note}` : '';
    return `${index + 1}. ${question.question}\n   → ${chosen}${note}`;
  });

  const closing =
    language === 'th'
      ? 'ใช้คำตอบเหล่านี้เป็นข้อกำหนดตายตัว อย่าเดาแทน และอย่าถามซ้ำในเรื่องเดิม'
      : 'Treat these as requirements, do not invent a different answer, and do not ask the same thing again.';

  return [header, ...lines, closing].join('\n');
}

/** Card title, in the language the session is using. */
export function questionCardTitle(language: 'th' | 'en'): string {
  return language === 'th' ? 'ขอคำตอบก่อนเริ่มงาน' : 'A few questions before I start';
}
