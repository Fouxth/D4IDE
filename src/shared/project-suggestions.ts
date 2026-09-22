/**
 * Conversation-starter chips for an empty transcript (spec §5).
 *
 * The static four buttons said the same thing in every project, which made them
 * wallpaper. These are built from what is actually on disk — the working tree's
 * uncommitted changes, TODO/FIXME comments waiting in the code, the files a
 * session last touched — so the first chip is the project's own "you were
 * here". A clean repository with no markers falls back to structure/propose,
 * which is the honest answer for a project with nothing pending.
 *
 * Pure on purpose: the main process gathers the inputs, so every branch can be
 * tested without a repository on disk. Like the end-of-run chips, labels are
 * written here because the suggestion crosses IPC as a finished thing — the
 * chip shows `label`, and clicking it sends `prompt` verbatim.
 */

export interface ProjectSuggestion {
  id: string;
  label: string;
  prompt: string;
}

export interface ProjectSuggestionInput {
  language: 'th' | 'en';
  /** Uncommitted files from `git status --porcelain`, with their column class. */
  workingTree: {
    staged: string[];
    unstaged: string[];
    untracked: string[];
  };
  /** Whether the folder is a git repository at all. */
  isRepo: boolean;
  /** Project-relative paths of the most recently modified files, newest first. */
  recentFiles: string[];
  /** TODO/FIXME markers found in source, project-relative, e.g. `src/a.ts:12`. */
  todoMarkers: string[];
  /** The names of the last session's transcripts' projects, for continuity. */
  recentProjectNames?: string[];
}

const MAX_SUGGESTIONS = 4;

export function buildProjectSuggestions(input: ProjectSuggestionInput): ProjectSuggestion[] {
  const { language, workingTree, isRepo, recentFiles, todoMarkers } = input;
  const th = language === 'th';

  const suggestions: ProjectSuggestion[] = [];

  const dirty = [...workingTree.staged, ...workingTree.unstaged];
  const untrackedCount = workingTree.untracked.length;

  // 1. Uncommitted work: the strongest signal — the user was here, mid-change.
  if (dirty.length > 0) {
    const file = dirty[0];
    suggestions.push({
      id: 'review-changes',
      label: th ? `ดูงานที่ยังไม่ได้ commit (${dirty.length} ไฟล์)` : `Review uncommitted work (${dirty.length} files)`,
      prompt: th
        ? `อธิบาย diff ที่ยังไม่ได้ commit ทั้งหมดในโปรเจกต์นี้ ทีละไฟล์ แล้วบอกว่าแต่ละส่วนเสี่ยงอะไรบ้าง ไฟล์แรกคือ ${file}`
        : `Explain the uncommitted diff in this project file by file, and what each part risks. Start with ${file}.`
    });
    suggestions.push({
      id: 'commit-changes',
      label: th ? 'เขียน commit ให้งานนี้' : 'Commit this work',
      prompt: th
        ? 'รีวิวการเปลี่ยนแปลงทั้งหมดที่ยังไม่ได้ commit แล้วเขียน commit message ที่สรุปดีที่สุด และ commit ให้หน่อย (แค่ commit อย่างเดียว ยังไม่ต้อง push)'
        : 'Review all uncommitted changes, write the commit message that best summarises them, and commit (commit only, do not push).'
    });
  } else if (untrackedCount > 0) {
    suggestions.push({
      id: 'untracked',
      label: th ? `มีไฟล์ใหม่ ${untrackedCount} ไฟล์ที่ git ยังไม่จับ` : `${untrackedCount} untracked files`,
      prompt: th
        ? `มีไฟล์ที่ git ยังไม่ติดตาม ${untrackedCount} ไฟล์ ช่วยดูว่าแต่ละไฟล์คืออะไร ควร commit, เพิ่มใน .gitignore, หรือลบทิ้ง`
        : `There are ${untrackedCount} untracked files. Look at each and say whether it should be committed, gitignored, or deleted.`
    });
  }

  // 2. TODO/FIXME markers: work the codebase itself is asking for.
  if (todoMarkers.length > 0) {
    const first = todoMarkers[0];
    suggestions.push({
      id: 'todos',
      label: th ? `ทำ TODO ในโค้ดต่อ (${todoMarkers.length})` : `Work through TODOs (${todoMarkers.length})`,
      prompt: th
        ? `ในโค้ดมี TODO/FIXME อยู่ ${todoMarkers.length} จุด เริ่มจาก ${first} ช่วยสำรวจทั้งหมด จัดกลุ่มว่าอันไหนสำคัญ แล้วเสนอลำดับที่ควรทำ`
        : `The code has ${todoMarkers.length} TODO/FIXME markers, starting with ${first}. Survey all of them, group by importance, and propose an order to tackle them.`
    });
  }

  // 3. Recently modified files: "you were here" even without git.
  if (dirty.length === 0 && recentFiles.length > 0) {
    const file = recentFiles[0];
    suggestions.push({
      id: 'recent-file',
      label: th ? 'ตรวจงานล่าสุดที่แก้' : 'Review the latest changes',
      prompt: th
        ? `ไฟล์ที่แก้ล่าสุดในโปรเจกต์คือ ${file} ช่วยรีวิวไฟล์นั้น หาบั๊ก เคสขอบ และจุดที่ควรปรับปรุง`
        : `The most recently modified file is ${file}. Review it for bugs, edge cases and improvements.`
    });
  }

  // 4. Honest fallbacks when the project has nothing pending.
  if (suggestions.length === 0 && !isRepo) {
    suggestions.push({
      id: 'start-repo',
      label: th ? 'ตั้ง git ให้โปรเจกต์' : 'Set up git here',
      prompt: th
        ? 'โปรเจกต์นี้ยังไม่มี git ช่วยเริ่มต้น repository ให้หน่อย พร้อมไฟล์ .gitignore ที่เหมาะกับสแตกของโปรเจกต์นี้'
        : 'This project has no git yet. Initialise a repository with a .gitignore suited to this project\'s stack.'
    });
  }
  suggestions.push({
    id: 'structure',
    label: th ? 'อธิบายโครงสร้างโปรเจกต์' : 'Explain this project',
    prompt: th
      ? 'อธิบายโครงสร้างโปรเจกต์นี้ ส่วนสำคัญ และจุดที่ควรรู้ก่อนแก้โค้ด'
      : 'Explain this project\'s structure, its important parts, and what to know before changing code.'
  });
  suggestions.push({
    id: 'propose',
    label: th ? 'เสนองานถัดไป' : 'Suggest next tasks',
    prompt: th
      ? 'เสนอ 3 งานที่ควรทำต่อในโปรเจกต์นี้ พร้อมเหตุผลสั้น ๆ ว่าทำไมงานนั้นสำคัญ'
      : 'Propose 3 tasks worth doing next in this project, with a short reason for each.'
  });

  const seen = new Set<string>();
  return suggestions
    .filter((suggestion) => {
      if (seen.has(suggestion.id)) return false;
      seen.add(suggestion.id);
      return true;
    })
    .slice(0, MAX_SUGGESTIONS);
}
