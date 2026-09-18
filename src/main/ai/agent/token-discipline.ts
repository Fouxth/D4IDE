import { ChatMessage, ToolCall } from '../../../shared/types';

/**
 * Token discipline: think first, never repeat work, never loop (spec §39).
 *
 * A long run burns most of its budget on three things, none of which is the
 * actual work: re-reading the same file, re-running the same command, and
 * carrying an ever-growing conversation into every request. This module is the
 * cheap, deterministic counterweight to all three — it does not ask the model to
 * behave, it makes the wasteful path unavailable:
 *
 *   · `tokenDisciplineRules` is always in the system prompt, so the intent is
 *     stated before the first tool call rather than after a bad one.
 *   · `RunLedger` remembers which calls already ran in this run. A second
 *     identical read is answered from the ledger; the third is refused with an
 *     explanation, which is a cheaper way to break a loop than paying for
 *     another round trip and hoping.
 *   · `trimConversation` keeps the prompt bounded: the oldest tool payloads are
 *     shortened and the oldest exchanges dropped, always in a shape the provider
 *     accepts (never a tool result without the call that produced it).
 *
 * Everything here is pure so it can be tested without a provider.
 */

/** Consecutive identical non-read calls allowed before the run blocks them. */
export const MAX_IDENTICAL_CALLS = 3;

/** How many identical read-only calls may be answered from the ledger. */
export const MAX_LEDGER_REUSES = 5;

/** Tools whose result cannot change during a run, so repeating them is waste. */
export const REPEATABLE_TOOLS = new Set([
  'read_file',
  'list_directory',
  'get_project_tree',
  'search_files',
  'grep',
  'find_symbol',
  'git_status',
  'git_diff',
  'git_log',
  'git_branch'
]);

/**
 * The always-on rules. Written as constraints rather than advice, and in the
 * order that saves the most money: plan, read narrowly, act once, verify, stop.
 */
export function tokenDisciplineRules(language: 'th' | 'en'): string {
  if (language === 'th') {
    return `วินัยการทำงาน (บังคับ):
1. คิดก่อนทำ: ก่อนเรียกเครื่องมือทุกครั้ง ให้ตัดสินใจสั้น ๆ ว่าจะทำอะไร ทำไม และต้องได้อะไร ถ้าไม่จำเป็นก็ไม่ต้องเรียก
2. อ่านเท่าที่ต้องใช้: อ่านเฉพาะช่วงบรรทัดหรือไฟล์ที่เกี่ยวข้อง อย่าเปิดทั้งโปรเจกต์ และอย่าอ่านไฟล์เดิมซ้ำด้วยเหตุผลเดิม
3. ห้ามทำซ้ำ: คำสั่งหรือการอ่านที่เคยทำไปแล้วในงานนี้ ให้ใช้ผลลัพธ์เดิมได้เลย ถ้าคำสั่งเดิมถูกเรียกซ้ำหลายครั้ง ระบบจะตัดและแจ้งเตือน — ให้เปลี่ยนวิธีแทน (ทุกครั้งที่รันซ้ำคือโทเคนที่จ่ายไปเปล่า)
4. ห้ามวน: ถ้าพยายามแก้แล้วไม่สำเร็จเกิน 2 ครั้ง ให้หยุดและรายงานสาเหตุที่แท้จริงพร้อมทางเลือก แทนที่จะลองแบบเดิมซ้ำ
5. ลงมือให้จบ: งานต้องเสร็จสมบูรณ์ในรอบเดียว ไม่ทิ้งงานครึ่ง ๆ กลาง ๆ ถ้าติดข้อจำกัดจริง (สิทธิ์ แพ็กเกจ เน็ต) ให้ทำให้ได้มากที่สุดแล้วบอกชัดว่าติดอะไร
6. ตรวจผลก่อนบอกว่าเสร็จ: รันบิลด์/เทสต์/เปิดหน้าเว็บจริงยืนยัน แล้วรายงานหลักฐาน ไม่ใช่รายงานความหวัง
7. สรุปสั้น: รายงานผลครั้งเดียว ตรงประเด็น ไม่ทวนทั้งบทสนทนา และไม่แปะโค้ดยาวที่ไม่จำเป็น`;
  }
  return `Working discipline (required):
1. Think before acting: before every tool call, decide in one short line what you are doing, why, and what it must return. If a call is not needed, do not make it.
2. Read only what the task needs: targeted line ranges or the specific file, never the whole project, and never the same file twice for the same reason.
3. Never repeat work: if a command or read already ran in this task, reuse its result. If an identical call is repeated, the runtime will refuse or reuse it and tell you so — change your approach instead of retrying it.
4. Never loop: if two attempts at the same fix fail, stop, report the actual cause and the options, rather than trying the same thing again.
5. Finish the job: complete the task in this run instead of leaving it half done. If something is genuinely blocked (permissions, a missing package, the network), do everything else and say exactly what was blocked.
6. Prove it before calling it done: run the build, the tests, or the real app and report the evidence — not the intention.
7. Spend tokens only on progress: every tool call, every re-read and every pasted line is paid for, so report once, briefly, with no restating of the conversation and no unnecessary pasted code.`;
}

/**
 * A stable identity for a tool call: same tool, same arguments, in any key
 * order, is the same call.
 */
export function toolSignature(call: ToolCall): string {
  const args = call.args && typeof call.args === 'object' ? call.args : {};
  const normalized = Object.keys(args)
    .sort()
    .map((key) => `${key}=${stableValue((args as Record<string, unknown>)[key])}`)
    .join('&');
  return `${call.name}(${normalized})`;
}

const stableValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const json = JSON.stringify(value);
    return json.length > 200 ? `${json.slice(0, 200)}…` : json;
  } catch {
    return '[unserializable]';
  }
};

export type LoopAction = 'run' | 'reuse' | 'blocked';

export interface LoopVerdict {
  action: LoopAction;
  /** How many times this exact call has now been seen in the run. */
  count: number;
  /** The earlier result, when the action is `reuse`. */
  cached?: string;
}

/**
 * Remembers what already happened in a run and decides whether the next call is
 * work, a repeat, or a loop. Read-only repeats are answered from memory; a call
 * that keeps coming back — including writes, which never repeat harmlessly — is
 * blocked so the model has to change strategy instead of retrying.
 */
export class RunLedger {
  private calls = new Map<string, number>();
  private results = new Map<string, string>();
  private lastAssistantTexts: string[] = [];

  reset(): void {
    this.calls.clear();
    this.results.clear();
    this.lastAssistantTexts = [];
  }

  count(signature: string): number {
    return this.calls.get(signature) ?? 0;
  }

  /** Registers the call and says how it should be handled. */
  inspect(call: ToolCall): LoopVerdict {
    const signature = toolSignature(call);
    const count = (this.calls.get(signature) ?? 0) + 1;
    this.calls.set(signature, count);

    if (count === 1) return { action: 'run', count };

    if (REPEATABLE_TOOLS.has(call.name) && count <= MAX_LEDGER_REUSES) {
      const cached = this.results.get(signature);
      if (cached !== undefined) return { action: 'reuse', count, cached };
      // First call is still in flight or produced nothing: let it run again
      // rather than answering with an empty result.
      return { action: 'run', count };
    }

    if (count >= MAX_IDENTICAL_CALLS) return { action: 'blocked', count };
    return { action: 'run', count };
  }

  /** Stores a read-only result so a repeat can be answered without a re-run. */
  remember(call: ToolCall, output: string): void {
    if (!REPEATABLE_TOOLS.has(call.name)) return;
    this.results.set(toolSignature(call), output);
  }

  /**
   * True when the assistant has now said the same thing several times in a row —
   * the textual version of a loop, and just as expensive.
   */
  isRepeatingText(text: string): boolean {
    const normalized = text.trim().replace(/\s+/g, ' ').slice(0, 400);
    if (!normalized) return false;
    this.lastAssistantTexts.push(normalized);
    if (this.lastAssistantTexts.length > 3) this.lastAssistantTexts.shift();
    const recent = this.lastAssistantTexts;
    return recent.length === 3 && recent[0] === recent[1] && recent[1] === recent[2];
  }
}

/** The message that tells the model its call was reused rather than re-run. */
export function reuseNotice(language: 'th' | 'en', count: number): string {
  return language === 'th'
    ? `ผลลัพธ์เดิมถูกนำมาใช้ซ้ำ (คำสั่งนี้เคยรันไปแล้ว ${count - 1} ครั้งในงานนี้) ไม่ได้รันใหม่เพื่อประหยัดโทเคน — ถ้าต้องการข้อมูลใหม่จริง ๆ ให้เปลี่ยนพารามิเตอร์หรือใช้เครื่องมืออื่น`
    : `Reused the earlier result (this exact call already ran ${count - 1} time(s) in this task). It was not run again, to avoid burning tokens — change the arguments or use a different tool if you really need fresh data.`;
}

/** The nudge for an assistant that keeps repeating itself instead of finishing. */
export function repetitionNotice(language: 'th' | 'en'): string {
  return language === 'th'
    ? 'คุณพูดเดิมซ้ำติดกันหลายรอบแล้ว หยุดทวน ให้ลงมือทำงานที่เหลือให้จบ แล้วสรุปสั้น ๆ ครั้งเดียว'
    : 'You have repeated the same thing several turns in a row. Stop restating it, do the remaining work, and report once.';
}

/** The message that refuses a call that keeps coming back. */
export function loopNotice(language: 'th' | 'en', call: ToolCall, count: number): string {
  return language === 'th'
    ? `ปฏิเสธการเรียกซ้ำ: ${call.name} ด้วยพารามิเตอร์เดิมถูกเรียกมาแล้ว ${count} ครั้งในงานนี้ ถือว่าวนซ้ำ ให้หยุดลองวิธีเดิม และรายงานสาเหตุที่แท้จริงหรือเปลี่ยนแนวทาง`
    : `Refused as a loop: ${call.name} with identical arguments has now been called ${count} times in this task. Stop retrying it, report the real cause, or change the approach.`;
}

export interface TrimResult {
  messages: ChatMessage[];
  dropped: number;
  truncated: number;
}

export interface BudgetResult extends TrimResult {
  /** Characters removed from file-sized tool arguments. */
  argumentCharsSaved: number;
  /** The size the request would have had, and the size it now has. */
  tokensBefore: number;
  tokensAfter: number;
}

/** Keeps a tool message short: enough to reason about, not the whole file. */
const compress = (content: string, limit: number): string =>
  content.length <= limit ? content : `${content.slice(0, limit)}\n…[${content.length - limit} characters trimmed to save tokens]`;

/**
 * A cheap, provider-independent size estimate, used only for budgeting.
 *
 * Latin text averages ~4 characters per token; Thai and other non-ASCII script
 * costs noticeably more per character, so it is counted at a higher rate. Being
 * slightly pessimistic is the right error for a budget: the request should come
 * in under the limit, not near it.
 */
export function estimateTokens(content: string): number {
  let ascii = 0;
  let other = 0;
  for (const char of content) {
    if (char.charCodeAt(0) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 4 + other / 1.5);
}

/**
 * Arguments that carry a whole file are the expensive part of a long run: a
 * `create_file` call the model made thirty turns ago is resent in full — at the
 * model's expense — on every single request that follows. Older turns keep a
 * marker with the size instead, so the model still knows what it wrote and to
 * where, without paying for the bytes again.
 */
const BIG_ARG_KEYS = new Set([
  'content',
  'newContent',
  'new_content',
  'newString',
  'new_string',
  'oldContent',
  'oldString',
  'old_string',
  'fileContent',
  'replacement',
  'text',
  'body'
]);

const ARG_KEEP_CHARS = 240;

/** Replaces the long string values of a tool call with a short marker. */
export function compressToolArguments(args: unknown, keepChars = ARG_KEEP_CHARS): { args: unknown; saved: number } {
  if (!args || typeof args !== 'object') return { args, saved: 0 };
  let saved = 0;
  const walk = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string') {
      const isBig = (key && BIG_ARG_KEYS.has(key)) || value.length > 2000;
      if (!isBig || value.length <= keepChars) return value;
      saved += value.length - keepChars;
      return `${value.slice(0, keepChars)}\n…[${value.length - keepChars} characters not repeated here to save tokens]`;
    }
    if (Array.isArray(value)) return value.map((entry) => walk(entry));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        out[childKey] = walk(childValue, childKey);
      }
      return out;
    }
    return value;
  };
  const out = walk(args);
  return { args: out, saved };
}

/**
 * Bounds the prompt before it is sent.
 *
 * Two independent savings: old tool payloads are shortened, and the oldest
 * exchanges are dropped. Both cuts are shaped so the request stays valid — a
 * window that would begin with a tool result drops it, and if the last kept
 * message is an assistant turn whose tool calls were cut, that turn goes too.
 * A dangling `tool_calls` without its results is rejected by every provider.
 */
function promptSize(messages: ChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') total += estimateTokens(message.content);
    if (message.toolCalls?.length) {
      for (const call of message.toolCalls) {
        try {
          total += estimateTokens(JSON.stringify(call.args ?? {}));
        } catch {
          // Unserializable args cannot be measured; ignore them here.
        }
      }
    }
  }
  return total;
}

/**
 * Compresses a conversation down to a token budget, cheapest work last.
 *
 * This is the version of trimming that matches where the money actually goes.
 * On a real run measured from the app's own database, a single build session
 * sent 7.8M input tokens in 80 calls, with the last forty calls each resending
 * ~150K: the conversation was being paid for over and over, and most of that
 * weight was the *files the agent had already written* — assistant tool-call
 * arguments, which the older message-count trimmer never touched.
 *
 * The order matters and is deliberate:
 *   1. file-sized arguments in older turns are replaced by size markers,
 *   2. older tool results are shortened,
 *   3. only then are the oldest exchanges dropped, and only if still over budget.
 */
export function compressForBudget(
  messages: ChatMessage[],
  options: { maxTokens: number; maxToolChars?: number; keepRecent?: number }
): BudgetResult {
  const maxToolChars = options.maxToolChars ?? 1200;
  const keepRecent = Math.max(2, options.keepRecent ?? 6);
  const tokensBefore = promptSize(messages);
  const recentFrom = messages.length - keepRecent;

  let truncated = 0;
  let argumentCharsSaved = 0;
  let working: ChatMessage[] = messages.map((message, index) => {
    if (index >= recentFrom) return message;

    if (message.toolCalls?.length) {
      let changed = false;
      const toolCalls = message.toolCalls.map((call) => {
        const { args, saved } = compressToolArguments(call.args);
        if (saved > 0) {
          argumentCharsSaved += saved;
          changed = true;
          return { ...call, args: args as Record<string, unknown> };
        }
        return call;
      });
      return changed ? { ...message, toolCalls } : message;
    }

    if (message.role === 'tool') {
      const content = typeof message.content === 'string' ? message.content : '';
      if (content.length > maxToolChars) {
        truncated += 1;
        return { ...message, content: compress(content, maxToolChars) };
      }
    }
    return message;
  });

  // Still too big: drop oldest exchanges, never breaking a tool-call/result pair.
  let dropped = 0;

  while (working.length > 4 && promptSize(working) > options.maxTokens) {
    const head = working[0];
    let start = 1;
    while (start < working.length && working[start].role === 'tool') start += 1;
    if (start >= working.length) break;
    // Drop through the end of the turn that produced those tool results, so an
    // assistant message never loses the results it is paired with.
    let end = start;
    while (end + 1 < working.length && working[end + 1].role === 'tool') end += 1;
    const removed = end - start + 1;
    if (removed <= 0) break;
    working = [head, ...working.slice(end + 1)];
    dropped += removed;
  }

  return {
    messages: working,
    dropped,
    truncated,
    argumentCharsSaved,
    tokensBefore,
    tokensAfter: promptSize(working)
  };
}

export function trimConversation(
  messages: ChatMessage[],
  options: { maxMessages: number; maxToolChars: number; keepRecent?: number }
): TrimResult {
  const maxMessages = Math.max(4, options.maxMessages);
  const keepRecent = Math.max(2, options.keepRecent ?? 6);

  // Newest first, so "recent" is decided by position in the original list.
  const indexed = messages.map((message, index) => ({ message, index }));
  const recentFrom = messages.length - keepRecent;

  let truncated = 0;
  const compressed = indexed.map(({ message, index }) => {
    if (message.role !== 'tool' || index >= recentFrom) return message;
    const content = typeof message.content === 'string' ? message.content : '';
    if (content.length <= options.maxToolChars) return message;
    truncated++;
    return { ...message, content: compress(content, options.maxToolChars) };
  });

  if (compressed.length <= maxMessages) return { messages: compressed, dropped: 0, truncated };

  const head = compressed[0]; // the system prompt always stays
  const keep = Math.max(1, maxMessages - 1); // room for the system prompt
  let start = compressed.length - keep;

  // Never start on a tool result: its request is outside the window.
  while (start < compressed.length && compressed[start].role === 'tool') start++;

  // Never end on an assistant turn whose tool results were cut away.
  let end = compressed.length;
  while (end - 1 > start && compressed[end - 1].role === 'assistant' && (compressed[end - 1].toolCalls?.length ?? 0) > 0) {
    end--;
  }

  const window = compressed.slice(start, end);
  if (window.length === 0) return { messages: compressed, dropped: 0, truncated };

  const dropped = start + (compressed.length - end);
  return { messages: [head, ...window], dropped, truncated };
}
