import { describe, expect, it } from 'vitest';
import { isAnswerOnlyDraft, isSmallTalkOnly } from '../src/shared/small-talk';
import * as styleRecommender from '../src/main/project/style-recommender';

/**
 * The verdict has two consumers that must never disagree.
 *
 * The runtime uses it to withhold every tool and to keep the run out of the
 * build/plan shapes; the composer uses it to stop offering Build/Plan at all.
 * If the two drifted, the composer would promise a mode the run would not
 * honour — or hide the pills on real work.
 */
describe('the small-talk verdict is one rule, shared', () => {
  it('is the very same function the main process re-exports', () => {
    // Not "equivalent behaviour" but the same object: a copy would pass a table
    // of examples today and diverge on the next edit.
    expect(styleRecommender.isSmallTalkOnly).toBe(isSmallTalkOnly);
  });

  it.each(['สวัสดีครับ', 'หวัดดี', 'ขอบคุณค่ะ', 'โอเค', 'hi', 'Hello there', 'thanks!', 'good morning'])(
    'reads a message that asks for nothing: %s',
    (text) => {
      expect(isSmallTalkOnly(text)).toBe(true);
    }
  );

  it.each([
    'ทดสอบ',
    'เทสต์',
    'รันเทสต์ทั้งชุด',
    'แก้บั๊กใน API',
    'สวัสดีครับ ช่วยทำหน้าโปรไฟล์ใหม่',
    'summarise this project',
    'continue'
  ])('does not swallow a request: %s', (text) => {
    expect(isSmallTalkOnly(text)).toBe(false);
  });

  it('treats an empty box as nothing to answer', () => {
    expect(isSmallTalkOnly('')).toBe(false);
    expect(isSmallTalkOnly('   ')).toBe(false);
  });
});

describe('what the composer offers for the draft', () => {
  it('stops offering Build/Plan for a message that asks for nothing', () => {
    expect(isAnswerOnlyDraft({ text: 'สวัสดีครับ', hasAttachedInstruction: false })).toBe(true);
  });

  it('keeps the mode pills for real work', () => {
    expect(isAnswerOnlyDraft({ text: 'แก้บั๊กใน provider-usability.ts', hasAttachedInstruction: false })).toBe(false);
  });

  it('keeps the mode pills when a command or skill chip will expand into an instruction', () => {
    // The runtime classifies what it sends, and a chip turns "สวัสดีครับ" into an
    // instruction — so the composer must not treat the box as an answer either.
    expect(isAnswerOnlyDraft({ text: 'สวัสดีครับ', hasAttachedInstruction: true })).toBe(false);
  });

  it('offers the pills again as soon as a greeting turns into an order', () => {
    expect(isAnswerOnlyDraft({ text: 'สวัสดีครับ', hasAttachedInstruction: false })).toBe(true);
    expect(isAnswerOnlyDraft({ text: 'สวัสดีครับ ช่วยทำหน้าโปรไฟล์ใหม่', hasAttachedInstruction: false })).toBe(
      false
    );
  });
});
