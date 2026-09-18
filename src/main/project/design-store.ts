import fs from 'fs';
import path from 'path';
import { DesignStyle, DESIGN_PROFILES, isDesignStyle } from '../../shared/design-profiles';

/**
 * The screen style for one project, kept next to the project's memory.
 *
 * It is stored per project because the choice is about *that* product: a
 * dashboard for accountants and a shop's landing page should not be forced into
 * the same look. Keeping it in `.d4ide/design.json` means it travels with the
 * repository and the agent can read it without asking the app.
 */

export interface ProjectDesign {
  style: DesignStyle;
  /** Free-text additions the user wants on top of the profile. */
  notes: string;
  /** When the agent asked and the user answered. */
  chosenAt: number | null;
}

const EMPTY: ProjectDesign = { style: 'ask', notes: '', chosenAt: null };

const designFile = (projectPath: string): string => path.join(projectPath, '.d4ide', 'design.json');

export function readProjectDesign(projectPath: string): ProjectDesign {
  if (!projectPath) return { ...EMPTY };
  try {
    const raw = JSON.parse(fs.readFileSync(designFile(projectPath), 'utf8')) as Partial<ProjectDesign>;
    return {
      style: isDesignStyle(raw.style) ? raw.style : 'ask',
      notes: typeof raw.notes === 'string' ? raw.notes : '',
      chosenAt: typeof raw.chosenAt === 'number' ? raw.chosenAt : null
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writeProjectDesign(projectPath: string, update: Partial<ProjectDesign>): ProjectDesign {
  const current = readProjectDesign(projectPath);
  const next: ProjectDesign = {
    style: isDesignStyle(update.style) ? update.style : current.style,
    notes: typeof update.notes === 'string' ? update.notes : current.notes,
    chosenAt: update.style && update.style !== 'ask' ? Date.now() : current.chosenAt
  };
  try {
    const file = designFile(projectPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch {
    // A project we cannot write to (read-only checkout) still works: the choice
    // simply does not persist, which is better than failing the user's click.
  }
  return next;
}

/** The label shown in the UI for a stored style. */
export function designStyleLabel(style: DesignStyle, language: 'th' | 'en'): string {
  if (style === 'ask') {
    return language === 'th' ? 'ให้ AI ถามก่อน (ยังไม่เลือก)' : 'Ask me first (not chosen yet)';
  }
  return DESIGN_PROFILES[style].label[language];
}
