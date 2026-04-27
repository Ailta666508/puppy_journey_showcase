/**
 * 将可能为 json/jsonb 对象的数据库文本列安全转为界面字符串，避免 [object Object]
 */
export function coerceDbTextField(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    for (const k of ["text", "body", "message", "content", "zh", "title"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    try {
      return JSON.stringify(raw);
    } catch {
      return "";
    }
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") return raw[0]!;
  return "";
}
