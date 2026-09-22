/**
 * The one verdict on "is there anything to do in this message?".
 *
 * It lives in `shared/` because two very different places have to agree on it:
 *
 *   - the runtime, which answers such a message without offering any tool and
 *     without dressing the run up as build work, and
 *   - the composer, which must not present Build/Plan as a choice for a message
 *     that will not build or plan anything.
 *
 * A second copy under `renderer/` would be a second opinion, and the two would
 * drift apart on the first edit — the composer would offer Build for a message
 * the runtime answers, or worse, hide the pills for real work.
 */

/**
 * The whole vocabulary of a message that asks for nothing: greetings, thanks,
 * apologies, acknowledgements, and the polite particles Thai puts after them
 * ("สวัสดี**ครับ**", "ขอบคุณ**ค่ะ**").
 *
 * Kept separate from the UI-work vocabulary on purpose: that one strips small
 * talk only from the front of an order, so widening this list would quietly
 * change how working requests are read. Nothing here needs a word boundary — a
 * Latin word matched too eagerly ("hi" inside "hint: fix the bug") leaves a
 * remainder, and the remainder is what decides.
 *
 * Two words that read like pleasantries and are not, here: "ทดสอบ" and "เทสต์"
 * are how this app's users ask for the test suite to be run. They were in this
 * list only because they are short, and two decisions now depend on this verdict
 * (the tools are withheld, and the composer stops offering Build/Plan), so a
 * request misread as a greeting is a request answered but never done. "รันเทสต์"
 * was already safe; the bare verb is now too.
 */
const SMALL_TALK =
  /^(สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|ดีจ้า|ขอบคุณ|ขอบใจ|ขอโทษ|โอเคเลย|โอเค|ครับผม|ครับ|ค่ะ|คะ|จ้า|จ๊ะ|นะครับ|นะคะ|ยินดี|thank you|thanks|thx|good morning|good evening|good afternoon|what's up|how are you|hello|hey|hi|yo|sup|there|everyone|folks|guys|okay|ok)/i;

/** Punctuation left behind when a recognised word is removed from the front. */
const SMALL_TALK_TRIM = /^[\s,.;:!?'"“”–—-]+/;

/**
 * Is this message only small talk — a hello, a thank you, an acknowledgement?
 *
 * A greeting asks for nothing, so the agent should answer in a sentence rather
 * than open the project and report on it. "สวัสดีครับ" in a folder the agent had
 * never read was answered with a full survey of the codebase, because the upkeep
 * rule ("end every task by updating `.d4ide/project.md`") read as an order to go
 * and gather facts for a file nobody had asked for.
 *
 * Recognised by *removing* every word that carries no request and seeing what is
 * left — the same shape as the order check, and for the same reason: "สวัสดีครับ
 * ช่วยทำหน้าโปรไฟล์ใหม่" is a hello *and* an order, and the order is what counts.
 * A paragraph gets the benefit of the doubt; messages this short are the only
 * ones where "nothing left" means anything.
 */
export function isSmallTalkOnly(prompt: string): boolean {
  const text = (prompt || '').trim();
  if (!text) return false;
  if (text.length > 120) return false;

  // "สวัสดีครับ" is two words, "hi, how are you?" is three: each pass removes one
  // recognised word, and the loop stops as soon as nothing more comes off.
  let rest = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = rest.replace(SMALL_TALK, '').replace(SMALL_TALK_TRIM, '').trim();
    if (next === rest) break;
    rest = next;
  }
  return rest.length < 2;
}

/**
 * Input to the composer's version of the verdict.
 *
 * The composer holds one piece of state the message does not: whether a command
 * or skill chip is attached. Such a chip expands into a full instruction before
 * it is sent — the runtime classifies what it sends, not what was typed — so the
 * two sides have to weigh that the same way.
 */
export interface DraftModeInput {
  /** What is typed in the box. */
  text: string;
  /** True when an attached command/skill will expand into an instruction. */
  hasAttachedInstruction: boolean;
}

/**
 * Should the composer stop offering Build/Plan for what is in the box?
 *
 * Asked so the choice is not presented where it does not apply: the runtime
 * answers such a message with no tools, so offering "Plan" would promise a plan
 * card that never comes. The pills come back the moment the text becomes an
 * order, including "สวัสดีครับ ช่วย…", which carries both.
 */
export function isAnswerOnlyDraft(input: DraftModeInput): boolean {
  if (input.hasAttachedInstruction) return false;
  return isSmallTalkOnly(input.text);
}
