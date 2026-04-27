import type { AchievementTask } from "@/components/achievements/types";

const ALLOWED_SCORES = new Set([5, 10, 20]);

/** 兼容 title 为 text / jsonb 对象 / 多语言结构 */
export function normalizeAchievementTitle(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    for (const k of ["zh_CN", "zh", "title", "text", "label", "value", "name"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    for (const v of Object.values(o)) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  if (Array.isArray(raw)) {
    const first = raw.find((x) => typeof x === "string" && x.trim());
    if (typeof first === "string") return first.trim();
  }
  return "";
}

export function normalizeAchievementScore(raw: unknown): 5 | 10 | 20 {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : Number(raw);
  const floor = Number.isFinite(n) ? Math.floor(n) : 5;
  return ALLOWED_SCORES.has(floor as 5 | 10 | 20) ? (floor as 5 | 10 | 20) : 5;
}

type BlindBoxJson = AchievementTask["blindBox"];

/** 兼容 DB jsonb 的 camelCase / snake_case 及残缺字段 */
export function normalizeBlindBoxFromDb(raw: unknown): BlindBoxJson {
  const empty: BlindBoxJson = {
    isAttached: false,
    isOpened: false,
    voucher: null,
    voiceUrl: null,
  };
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;
  const isAttached = Boolean(o.isAttached ?? o.is_attached);
  const isOpened = Boolean(o.isOpened ?? o.is_opened);
  const v = o.voucher ?? o.voucher_type;
  const voucher =
    v === "milktea" || v === "film" || v === "massage" || v === "shield" ? v : null;
  const voiceRaw = o.voiceUrl ?? o.voice_url;
  const voiceUrl = typeof voiceRaw === "string" ? voiceRaw : voiceRaw == null ? null : String(voiceRaw);
  return {
    isAttached,
    isOpened,
    voucher,
    voiceUrl,
  };
}
