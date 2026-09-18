import { describe, expect, it } from 'vitest';
import { formatMission } from '../src/main/ai/agent/mission-prompt';
import { EMPTY_MISSION, Mission } from '../src/shared/types';

/**
 * The mission is re-sent with every request, so two things matter and are tested
 * here: an empty mission must cost nothing at all, and a real mission must reach
 * the model intact — a constraint that silently fails to render is a constraint
 * the agent will violate.
 */
const mission = (patch: Partial<Mission> = {}): Mission => ({ ...EMPTY_MISSION, ...patch });

describe('formatMission', () => {
  it('contributes nothing when there is no mission', () => {
    expect(formatMission(null, 'en')).toBe('');
    expect(formatMission(undefined, 'th')).toBe('');
    expect(formatMission(EMPTY_MISSION, 'en')).toBe('');
    expect(formatMission(mission({ objective: '   ', constraints: '\n' }), 'en')).toBe('');
  });

  it('renders every field the spec lists', () => {
    const text = formatMission(
      mission({
        objective: 'Build the hotel admin app',
        constraints: 'Keep backward compatibility',
        codingStyle: 'TypeScript, no default exports',
        importantFiles: ['src/main/index.ts', 'src/shared/types.ts'],
        forbiddenActions: 'Do not change the database schema',
        effort: 'high'
      }),
      'en'
    );

    expect(text).toContain('Build the hotel admin app');
    expect(text).toContain('Keep backward compatibility');
    expect(text).toContain('TypeScript, no default exports');
    expect(text).toContain('src/main/index.ts, src/shared/types.ts');
    expect(text).toContain('Do not change the database schema');
    expect(text).toMatch(/high/);
    expect(text).toMatch(/conflicts with a constraint/i);
  });

  it('omits headings for fields the user left blank', () => {
    const text = formatMission(mission({ objective: 'Just this' }), 'en');
    expect(text).toContain('Just this');
    expect(text).not.toContain('Constraints');
    expect(text).not.toContain('Forbidden');
  });

  it('speaks the UI language', () => {
    const th = formatMission(mission({ objective: 'สร้างแอปโรงแรม' }), 'th');
    expect(th).toContain('ภารกิจ');
    expect(th).toContain('สร้างแอปโรงแรม');
    expect(formatMission(mission({ objective: 'Ship it' }), 'en')).toContain('Session mission');
  });

  it('drops blank file names and keeps the effort meaningful', () => {
    const text = formatMission(mission({ objective: 'x', importantFiles: ['a.ts', '  ', ''] }), 'en');
    expect(text).toContain('a.ts');
    expect(text).not.toContain('a.ts,');
    expect(text).toMatch(/Effort/);
  });
});
