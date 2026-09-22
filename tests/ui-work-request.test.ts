import { describe, expect, it } from 'vitest';
import { isSmallTalkOnly, isUiWorkRequest } from '../src/main/project/style-recommender';

/**
 * When the style chooser is allowed to interrupt a run.
 *
 * The card stops the agent and asks a question, so the bar is "would the answer
 * change what is about to be built?" — an order to build or change a screen, or
 * a product brief that will produce one. Everything else has to pass through
 * untouched: greetings, questions, continuations, and work with no interface in
 * it at all. Reading the *project* instead of the prompt is what made the card
 * appear after "สวัสดีครับ", and the first block below is exactly that case.
 */
describe('isUiWorkRequest', () => {
  const asks: string[] = [
    'สร้างหน้า landing page ใหม่',
    'ทำ UI หน้า dashboard ให้สวย ๆ',
    'เพิ่มหน้ารายงานยอดค้างชำระ',
    'ช่วยออกแบบหน้าแรกของเว็บให้หน่อย',
    'แก้ฟอร์มสมัครสมาชิกให้กรอกง่ายขึ้น',
    'ปรับธีมสีของหน้าตั้งค่า',
    'ทำโปรแกรมอสังหาไว้ขายบ้าน',
    'อยากได้เว็บขายของออนไลน์',
    'build a settings page with tabs',
    'make the landing page prettier',
    'add a dark mode toggle to the navbar',
    'style the checkout card on mobile'
  ];

  const passes: string[] = [
    'สวัสดีครับ',
    'hi',
    'ขอบคุณครับ',
    'hello, are you there?',
    'สรุปโปรเจกต์นี้ให้ฟังหน่อย',
    'อธิบายโครงสร้างโปรเจกต์นี้',
    'what does the auth module do?',
    'explain how the cache works',
    'แก้บั๊กใน API ที่คืนค่า 500',
    'fix the SQL query that sums overdue invoices',
    'รันเทสต์ทั้งชุดแล้วรายงานผล',
    'เพิ่ม index ให้ตาราง orders',
    'commit this work',
    'review the current diff',
    'ทำต่อ',
    'continue',
    'finish it'
  ];

  it.each(asks)('asks for interface work: %s', (prompt) => {
    expect(isUiWorkRequest(prompt)).toBe(true);
  });

  it.each(passes)('leaves it alone: %s', (prompt) => {
    expect(isUiWorkRequest(prompt)).toBe(false);
  });

  it('treats an empty prompt as nothing to ask about', () => {
    expect(isUiWorkRequest('')).toBe(false);
    expect(isUiWorkRequest('   ')).toBe(false);
  });

  it('lets a greeting that carries a real order through', () => {
    // Small talk is only refused when the message *opens* with it; the request
    // that follows is still a request.
    expect(isUiWorkRequest('สวัสดีครับ ช่วยทำหน้าโปรไฟล์ใหม่ให้หน่อย')).toBe(true);
  });
});

/**
 * The other half of the same judgement: is there anything to do at all?
 *
 * "สวัสดีครับ" used to come back as a survey of the project plus a list of jobs
 * on offer, because the prompt tells the agent to update the project memory at
 * the end of every task and a greeting does not look like an exception. This is
 * the check that lets the runtime say so out loud.
 */
describe('isSmallTalkOnly', () => {
  it.each(['สวัสดีครับ', 'สวัสดี', 'หวัดดีครับ', 'ขอบคุณครับ', 'โอเค', 'thanks!', 'hi', 'Hello', 'hey there']) (
    'reads a message with no request in it: %s',
    (prompt) => {
      expect(isSmallTalkOnly(prompt)).toBe(true);
    }
  );

  it.each([
    'สรุปโครงสร้างโปรเจกต์ให้หน่อย',
    'มีอะไรให้ทำต่อไหม',
    'สวัสดีครับ ช่วยทำหน้าโปรไฟล์ใหม่',
    'แก้บั๊กใน API ให้หน่อย',
    'review the current diff',
    'ทำต่อ',
    // Short, but an order in this app: the tools are withheld on this verdict,
    // so misreading "ทดสอบ" as a greeting would answer the request and never do
    // it. The bare verb has to reach the agent as work.
    'ทดสอบ',
    'เทสต์'
  ])('does not swallow a message that asks something: %s', (prompt) => {
    expect(isSmallTalkOnly(prompt)).toBe(false);
  });

  it('treats an empty prompt as nothing to answer', () => {
    expect(isSmallTalkOnly('')).toBe(false);
    expect(isSmallTalkOnly('   ')).toBe(false);
  });

  it('gives a long message the benefit of the doubt', () => {
    // A paragraph that opens with a greeting is a message with something in it.
    const long = `สวัสดีครับ ${'รายละเอียดของงานที่อยากให้ช่วย '.repeat(8)}`;
    expect(isSmallTalkOnly(long)).toBe(false);
  });
});
