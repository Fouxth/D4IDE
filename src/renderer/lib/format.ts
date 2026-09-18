export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '$0.00';
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

/** Byte sizes for the database panel — precise at small sizes, coarse at large. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}`;
}

export function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function formatPrice(value?: number): string {
  if (value === undefined || value === null) return '—';
  if (value === 0) return 'free';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/** Human-readable reason for a provider error kind (spec §54). */
export function providerErrorLabel(kind: string | undefined, language: 'th' | 'en'): string {
  const th: Record<string, string> = {
    invalid_key: 'API key ไม่ถูกต้องหรือถูกปฏิเสธ — ตรวจสอบคีย์อีกครั้ง',
    rate_limit: 'ถูกจำกัดอัตราการเรียก (rate limit) — รอสักครู่แล้วลองใหม่',
    unavailable: 'เชื่อมต่อผู้ให้บริการไม่ได้ — ตรวจสอบอินเทอร์เน็ตหรือ Base URL',
    timeout: 'หมดเวลารอการตอบกลับ',
    model_not_found: 'ไม่พบโมเดลนี้ในผู้ให้บริการ',
    context_exceeded: 'บริบทเกินขีดจำกัดของโมเดล',
    bad_request: 'คำขอไม่ถูกต้อง',
    cancelled: 'ถูกยกเลิก',
    unknown: 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
  };
  const en: Record<string, string> = {
    invalid_key: 'API key is invalid or rejected — check the key',
    rate_limit: 'Rate limit reached — wait a moment and retry',
    unavailable: 'Provider unreachable — check your connection or Base URL',
    timeout: 'Request timed out',
    model_not_found: 'This model does not exist on the provider',
    context_exceeded: 'Context window exceeded',
    bad_request: 'The request was rejected as invalid',
    cancelled: 'Cancelled',
    unknown: 'An unknown error occurred'
  };
  const table = language === 'th' ? th : en;
  return table[kind || 'unknown'] || table.unknown;
}
