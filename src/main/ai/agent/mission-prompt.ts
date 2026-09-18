import { Mission } from '../../../shared/types';

/**
 * Renders a session mission into the system prompt (spec §40).
 *
 * Kept pure and separate for two reasons: it is the part of mission handling
 * worth testing, and it is the only place that decides how much of the mission
 * the model sees. A mission with every field empty contributes nothing at all —
 * an empty heading would just spend tokens and confuse the model.
 */
export function formatMission(mission: Mission | null | undefined, language: 'th' | 'en'): string {
  if (!mission) return '';

  const objective = mission.objective?.trim();
  const constraints = mission.constraints?.trim();
  const codingStyle = mission.codingStyle?.trim();
  const forbidden = mission.forbiddenActions?.trim();
  const files = (mission.importantFiles ?? []).map((file) => file.trim()).filter(Boolean);

  if (!objective && !constraints && !codingStyle && !forbidden && files.length === 0) return '';

  const labels =
    language === 'th'
      ? {
          title: 'ภารกิจของเซสชันนี้ (ต้องยึดถือตลอดงาน)',
          objective: 'เป้าหมาย',
          constraints: 'ข้อจำกัด',
          style: 'สไตล์โค้ด',
          files: 'ไฟล์สำคัญ',
          forbidden: 'สิ่งที่ห้ามทำ',
          effort: 'ระดับความละเอียด',
          effortValue: { low: 'ต่ำ — ทำตรงไปตรงมา ไม่ต้องสำรวจมาก', medium: 'ปานกลาง', high: 'สูง — ตรวจสอบให้ละเอียดก่อนสรุป' } as Record<string, string>,
          obey: 'ทำตามภารกิจนี้อย่างเคร่งครัด ถ้าคำขอขัดกับข้อจำกัด ให้บอกผู้ใช้ก่อนลงมือ'
        }
      : {
          title: 'Session mission (bind for the whole task)',
          objective: 'Objective',
          constraints: 'Constraints',
          style: 'Coding style',
          files: 'Important files',
          forbidden: 'Forbidden',
          effort: 'Effort',
          effortValue: {
            low: 'low — act directly, minimal exploration',
            medium: 'medium',
            high: 'high — verify thoroughly before reporting'
          } as Record<string, string>,
          obey: 'Follow this mission strictly. If a request conflicts with a constraint, say so before acting.'
        };

  const lines = ['', `## ${labels.title}`];
  if (objective) lines.push(`- ${labels.objective}: ${objective}`);
  if (constraints) lines.push(`- ${labels.constraints}: ${constraints}`);
  if (codingStyle) lines.push(`- ${labels.style}: ${codingStyle}`);
  if (files.length > 0) lines.push(`- ${labels.files}: ${files.join(', ')}`);
  if (forbidden) lines.push(`- ${labels.forbidden}: ${forbidden}`);
  lines.push(`- ${labels.effort}: ${labels.effortValue[mission.effort] ?? mission.effort}`);
  lines.push('', labels.obey);

  return lines.join('\n');
}
